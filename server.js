// server.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';

dotenv.config();

import { checkN8nHealth, detectBasePath, getN8nHeaders } from './utils/n8n.js';
import { validateEncryptionKey, redactSecrets } from './utils/encryption.js';
import { apiLimiter, sensitiveLimiter, testLimiter } from './middleware/rateLimiter.js';
import { safeErrorHandler } from './middleware/validate.js';
import { requireAuth } from './middleware/auth.js';

import workflowsRouter   from './routes/workflows.js';
import credentialsRouter from './routes/credentials.js';
import templatesRouter   from './routes/templates.js';
import executionsRouter  from './routes/executions.js';

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────
const execAsync = promisify(exec);
const app       = express();
const PORT      = process.env.PORT || 4000;
const DEMO_MODE = process.env.DEMO_MODE === 'true';

// Validate 256-bit AES encryption key at startup
try {
  if (!DEMO_MODE || process.env.ENCRYPTION_KEY) {
    validateEncryptionKey();
    console.log('✅ AES-256-GCM encryption key validated (256 bits).');
  }
} catch (err) {
  console.error('❌ Encryption key validation failed at startup:', err.message);
  if (!DEMO_MODE) {
    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// Security Middleware & Proxy Settings
// ─────────────────────────────────────────────
// Safe client IP extraction behind trusted reverse proxies
app.set('trust proxy', 1);

// Security Headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://*.supabase.co", "http://localhost:*", "http://127.0.0.1:*"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Strict CORS with explicit allowed origins
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4000',
  'http://localhost:8000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:8000',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server or same-origin requests with no Origin header
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Test-Client-Id', 'X-Test-Bypass-Rate-Limit'],
}));

// Payload size limit to prevent oversized request DOS attacks
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

// Rate Limiting
app.use('/api/', apiLimiter);
app.use('/api/credentials', sensitiveLimiter);

// ─────────────────────────────────────────────
// Public routes (strictly non-sensitive info)
// ─────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  const supabaseUrl    = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!DEMO_MODE && (!supabaseUrl || !supabaseAnonKey)) {
    return res.status(500).json({
      error: 'Server misconfigured',
      message: 'SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env',
    });
  }

  res.json({
    supabase: { url: supabaseUrl || '', anonKey: supabaseAnonKey || '' },
    demoMode: DEMO_MODE,
    version: '2.0.0',
  });
});

app.get('/api/health', async (req, res) => {
  if (DEMO_MODE) {
    return res.json({
      status: 'demo',
      demo: true,
      services: {
        backend: 'healthy',
        n8n: 'mocked',
        supabase: 'mocked'
      },
      timestamp: new Date().toISOString(),
    });
  }

  const n8nHealth = await checkN8nHealth();
  const n8nConnected = n8nHealth.connected;
  const supabaseConfigured = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY;

  const status = (n8nConnected && supabaseConfigured) ? 'healthy' : 'degraded';

  res.status(n8nConnected ? 200 : 503).json({
    status,
    services: {
      backend: 'healthy',
      n8n: n8nConnected ? 'connected' : 'disconnected',
      supabase: supabaseConfigured ? 'configured' : 'not configured',
    },
    n8n: n8nHealth,
    timestamp: new Date().toISOString(),
  });
});

// Dedicated test rate-limit endpoint (used by automated rate limit verification tests)
app.get('/api/test-rate-limit', testLimiter, (req, res) => {
  res.json({ status: 'ok', message: 'Request within rate limit' });
});

// ─────────────────────────────────────────────
// Diagnostic route (requires authenticated session, redacts secrets)
// ─────────────────────────────────────────────
app.get('/api/n8n-debug', requireAuth, async (req, res) => {
  const n8nBase = (process.env.N8N_URL || 'http://localhost:5680').replace(/\/$/, '');
  const headers = getN8nHeaders();

  const result = {
    config: {
      n8n_url:         n8nBase,
      api_key_set:     !!process.env.N8N_API_KEY,
      container_name: process.env.N8N_CONTAINER_NAME || 'n8n (default)',
    },
    endpoint_tests: [],
    docker_test:    null,
    instructions:   [],
  };

  const tests = [
    { method: 'GET',  path: '/api/v1/workflows?limit=1',  note: 'Public API — list/toggle/delete' },
    { method: 'GET',  path: '/rest/workflows?limit=1',    note: 'Internal REST — needs session cookie' },
  ];

  for (const { method, path, note } of tests) {
    const url = `${n8nBase}${path}`;
    try {
      const r = await fetch(url, { method, headers, signal: AbortSignal.timeout(5000) });
      const text = await r.text().catch(() => '');
      result.endpoint_tests.push({ method, url, note, status: r.status, ok: r.ok, response: text.slice(0, 100) });
    } catch (err) {
      result.endpoint_tests.push({ method, url, note, error: err.message });
    }
  }

  res.json(redactSecrets(result));
});

// ─────────────────────────────────────────────
// Protected API routes
// ─────────────────────────────────────────────
app.use('/api/workflows',   workflowsRouter);
app.use('/api/credentials', credentialsRouter);
app.use('/api/templates',   templatesRouter);
app.use('/api/executions',  executionsRouter);

// ─────────────────────────────────────────────
// Global safe error handler (prevents information disclosure)
// ─────────────────────────────────────────────
app.use(safeErrorHandler);

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
if (!DEMO_MODE) {
  detectBasePath().catch(err => console.warn('n8n base path detection failed:', err.message));
}

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Health:  /api/health`);
  console.log(`Config:  /api/config`);
  if (DEMO_MODE) console.log('Demo mode active.');
});

export { app, server };