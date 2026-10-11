// utils/n8n.js - n8n API Adapter with robust error & status code handling
import fetch from 'node-fetch';

let _workingBasePath = null;
let _detectionPromise = null;

function getN8nUrl() {
  return (process.env.N8N_URL || 'http://localhost:5680').replace(/\/$/, '');
}

function getN8nApiKey() {
  return process.env.N8N_API_KEY || '';
}

export function getN8nHeaders() {
  const h = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  const key = getN8nApiKey();
  if (key) h['X-N8N-API-KEY'] = key;
  return h;
}

// ─────────────────────────────────────────────
// Auto-detect which base path n8n uses
// /api/v1  →  n8n ≥ 0.166 (public API)
// /rest    →  older n8n or self-hosted without public API enabled
// ─────────────────────────────────────────────
export async function detectBasePath() {
  if (_workingBasePath) return _workingBasePath;
  if (_detectionPromise) return _detectionPromise;

  _detectionPromise = (async () => {
    const candidates = ['/api/v1', '/rest'];
    const n8nUrl = getN8nUrl();

    for (const basePath of candidates) {
      try {
        const url = `${n8nUrl}${basePath}/workflows?limit=1`;
        console.log(`🔍 Testing n8n path: ${url}`);
        const res = await fetch(url, {
          method: 'GET',
          headers: getN8nHeaders(),
          signal: AbortSignal.timeout(5000),
        });
        console.log(`   ↳ ${res.status}`);

        if (res.status !== 404 && res.status !== 302) {
          if (res.status === 401) {
            console.warn(`⚠️  n8n at ${basePath}: 401 — check N8N_API_KEY`);
          } else {
            console.log(`✅ n8n base path: ${basePath} (${res.status})`);
          }
          _workingBasePath = basePath;
          _detectionPromise = null;
          return basePath;
        }
      } catch (err) {
        console.log(`   ↳ ${basePath} unreachable: ${err.message}`);
      }
    }

    console.warn('⚠️  Defaulting to /api/v1');
    _workingBasePath = '/api/v1';
    _detectionPromise = null;
    return '/api/v1';
  })();

  return _detectionPromise;
}

export function resetBasePath() {
  _workingBasePath = null;
  _detectionPromise = null;
}

// ─────────────────────────────────────────────
// Core request — surfaces status-code specific n8n error messages
// ─────────────────────────────────────────────
export async function n8nRequest(path, method = 'GET', body = null) {
  const basePath = await detectBasePath();
  const url = `${getN8nUrl()}${basePath}${path}`;

  console.log(`📡 n8n ${method} ${url}`);

  const options = {
    method,
    headers: getN8nHeaders(),
    signal: AbortSignal.timeout(15000),
  };

  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new Error(`n8n request timed out (15s) at ${getN8nUrl()}`);
    }
    if (err.code === 'ECONNREFUSED') {
      throw new Error(`n8n connection refused at ${getN8nUrl()} — is n8n running?`);
    }
    throw new Error(`n8n unreachable at ${getN8nUrl()} — ${err.message}`);
  }

  console.log(`   ↳ HTTP ${res.status}`);

  if (!res.ok) {
    let errorText = '';
    let errorJson = null;
    try {
      errorText = await res.text();
      errorJson = JSON.parse(errorText);
    } catch (_) {}

    const detailedMessage = errorJson?.message || errorJson?.error || errorText;
    console.error(`   ↳ Error response:`, errorText.slice(0, 300));

    // Handle 404 retry if base path was cached
    if (res.status === 404 && _workingBasePath) {
      console.log('   ↳ 404 — resetting base path cache and retrying...');
      resetBasePath();
      const newBase = await detectBasePath();
      const retryUrl = `${getN8nUrl()}${newBase}${path}`;
      let retryRes;
      try {
        retryRes = await fetch(retryUrl, options);
      } catch (err) {
        throw new Error(`n8n unreachable: ${err.message}`);
      }
      if (retryRes.ok) {
        const ct = retryRes.headers.get('content-type') || '';
        return ct.includes('json') ? retryRes.json() : { success: true };
      }
      const retryText = await retryRes.text().catch(() => '');
      let retryJson = null;
      try { retryJson = JSON.parse(retryText); } catch (_) {}
      const retryMsg = retryJson?.message || retryJson?.error || retryText;
      throw buildFormattedN8nError(retryRes.status, retryMsg);
    }

    throw buildFormattedN8nError(res.status, detailedMessage);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) {
    return res.json();
  }
  return { success: true };
}

function buildFormattedN8nError(status, detail) {
  let prefix = `n8n HTTP ${status}`;
  if (status === 401) prefix = 'n8n Unauthorized (401) — check N8N_API_KEY in .env';
  else if (status === 403) prefix = 'n8n Access Forbidden (403) — check API key permissions';
  else if (status === 404) prefix = 'n8n Resource Not Found (404)';
  else if (status === 409) prefix = 'n8n Resource Conflict (409)';
  else if (status === 422) prefix = 'n8n Validation Error (422)';
  else if (status === 429) prefix = 'n8n Rate Limit Exceeded (429)';
  else if (status >= 500) prefix = `n8n Server Error (${status})`;

  const detailText = detail && detail.trim() ? `: ${detail.trim()}` : '';
  return new Error(`${prefix}${detailText}`);
}

// ─────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────
export async function checkN8nHealth() {
  try {
    const basePath = await detectBasePath();
    const url = `${getN8nUrl()}${basePath}/workflows?limit=1`;
    const res = await fetch(url, { method: 'GET', headers: getN8nHeaders(), signal: AbortSignal.timeout(5000) });
    return {
      connected: res.ok,
      status: res.status,
      basePath,
      url: getN8nUrl(),
      apiKeySet: !!getN8nApiKey(),
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message,
      url: getN8nUrl(),
      apiKeySet: !!getN8nApiKey(),
    };
  }
}