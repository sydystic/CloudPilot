// middleware/rateLimiter.js - Express API rate limiting
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Standard error response generator for rate limiting
 */
function createRateLimitHandler(windowMinutes) {
  return (req, res, next, options) => {
    const retrySecs = Math.ceil(options.windowMs / 1000);
    res.setHeader('Retry-After', retrySecs);
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Please wait ${windowMinutes} minute(s) before trying again.`,
      retryAfter: retrySecs,
      limit: options.max,
    });
  };
}

/**
 * Key generator that combines verified user ID (if authenticated) with safe IPv4/IPv6 IP
 */
function keyGenerator(req) {
  const userId = req.user?.id || req.userId;
  if (userId) return `user_${userId}`;
  return ipKeyGenerator(req);
}

/**
 * 1. General API rate limiter
 * Allows 150 requests per minute for normal dashboard navigation and fetching.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  validate: { keyGeneratorIpFallback: false },
  handler: createRateLimitHandler(1),
  skip: (req) => process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-rate-limit'] === 'true',
});

/**
 * 2. Strict limiter for sensitive credential and security mutations
 * 25 requests per 15 minutes per user/IP.
 */
export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  validate: { keyGeneratorIpFallback: false },
  handler: createRateLimitHandler(15),
  skip: (req) => process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-rate-limit'] === 'true',
});

/**
 * 3. Workflow Run Limiter
 * 60 executions per minute — permits legitimate batch/automation runs
 * without enabling denial-of-service against the n8n backend.
 */
export const workflowRunLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  validate: { keyGeneratorIpFallback: false },
  handler: createRateLimitHandler(1),
  skip: (req) => process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-rate-limit'] === 'true',
});

/**
 * 4. Dedicated test limiter for automated test verification
 */
export const testLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-test-client-id'] || ipKeyGenerator(req),
  validate: { keyGeneratorIpFallback: false },
  handler: createRateLimitHandler(1),
});
