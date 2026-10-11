// middleware/auth.js - Supabase JWT verification middleware
import { getSupabase } from '../utils/supabase.js';

/**
 * Validates basic JWT structure (3 base64url segments separated by dots)
 */
function isValidJwtStructure(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  return parts.every(part => part.length > 0);
}

/**
 * Middleware that cryptographically verifies the Supabase JWT from Authorization header
 * Sets req.user = { id, email, ... } on success
 */
export async function requireAuth(req, res, next) {
  // Prevent demo mode from silently bypassing authentication in production environments
  if (process.env.DEMO_MODE === 'true') {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Demo mode is not permitted in production environment',
      });
    }
    req.user = { id: 'demo-user-id', email: 'demo@cloudpilot.dev', role: 'authenticated' };
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || typeof authHeader !== 'string') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing Authorization header. Expected Bearer <token>',
    });
  }

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid Authorization header format. Expected Bearer <token>',
    });
  }

  const token = authHeader.slice(7).trim();

  if (!token || !isValidJwtStructure(token)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Malformed or invalid JWT format',
    });
  }

  try {
    const supabase = getSupabase();
    // Cryptographically verify token signature, expiration, and validity with Supabase Auth
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: error?.message || 'Invalid or expired token',
      });
    }

    // Attach authenticated user identity (server verified)
    req.user = user;
    req.userId = user.id;
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Token verification failed',
    });
  }
}

/**
 * Optional auth - sets req.user if valid token present, continues otherwise
 */
export async function optionalAuth(req, res, next) {
  if (process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production') {
    req.user = { id: 'demo-user-id', email: 'demo@cloudpilot.dev', role: 'authenticated' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7).trim();
  if (!token || !isValidJwtStructure(token)) {
    return next();
  }

  try {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) {
      req.user = user;
      req.userId = user.id;
      req.token = token;
    }
  } catch (_) {
    // Continue unauthenticated
  }

  next();
}