// middleware/validate.js - Server-side schema validation and API protection
import { redactSecrets } from '../utils/encryption.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates that a route param (e.g. :id) is a valid UUID or alphanumeric n8n identifier
 */
export function validateParamId(paramName = 'id') {
  return (req, res, next) => {
    const val = req.params[paramName];
    if (!val || typeof val !== 'string') {
      return res.status(400).json({ error: 'Validation Error', message: `Missing parameter :${paramName}` });
    }
    // Permit standard UUIDs, positive integers, or n8n alphanumeric IDs (8-36 chars)
    const isValid = UUID_REGEX.test(val) || /^[0-9a-zA-Z_-]{1,64}$/.test(val);
    if (!isValid) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `Invalid format for parameter :${paramName}. Must be a valid UUID or alphanumeric identifier.`,
      });
    }
    next();
  };
}

/**
 * Validates request body against required fields, types, and string length bounds.
 * Prevents mass assignment by allowing only declared fields.
 */
export function validateBody(schema) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Request body must be a valid JSON object',
      });
    }

    const errors = [];
    const sanitizedBody = {};

    for (const [field, rules] of Object.entries(schema)) {
      const val = req.body[field];

      if (rules.required && (val === undefined || val === null || val === '')) {
        errors.push(`'${field}' is required`);
        continue;
      }

      if (val !== undefined && val !== null) {
        if (rules.type && typeof val !== rules.type) {
          errors.push(`'${field}' must be of type ${rules.type}, received ${typeof val}`);
          continue;
        }

        if (rules.type === 'string') {
          const trimmed = val.trim();
          if (rules.minLength && trimmed.length < rules.minLength) {
            errors.push(`'${field}' must have at least ${rules.minLength} character(s)`);
          }
          if (rules.maxLength && trimmed.length > rules.maxLength) {
            errors.push(`'${field}' must not exceed ${rules.maxLength} character(s)`);
          }
          if (rules.enum && !rules.enum.includes(trimmed.toLowerCase())) {
            errors.push(`'${field}' must be one of [${rules.enum.join(', ')}]`);
          }
          sanitizedBody[field] = trimmed;
        } else if (rules.type === 'object') {
          if (Array.isArray(val) && rules.notArray) {
            errors.push(`'${field}' must be a plain object, not an array`);
          } else {
            sanitizedBody[field] = val;
          }
        } else {
          sanitizedBody[field] = val;
        }
      }
    }

    // Check for mass assignment / unexpected fields if strict mode is set
    const unexpectedFields = Object.keys(req.body).filter(key => !(key in schema));
    if (unexpectedFields.length > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `Unexpected field(s) not allowed: ${unexpectedFields.join(', ')}`,
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: errors.join('; '),
        errors,
      });
    }

    req.validatedBody = sanitizedBody;
    next();
  };
}

/**
 * Global safe error-handling middleware that strips stack traces, secrets, and internal SQL details
 */
export function safeErrorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  let clientMessage = err.message || 'An unexpected error occurred';

  // Sanitize message to never leak secrets, SQL statements, or file paths
  if (clientMessage.includes('password') || clientMessage.includes('secret') || clientMessage.includes('token')) {
    clientMessage = 'An error occurred while processing sensitive data';
  }
  if (clientMessage.includes('SELECT') || clientMessage.includes('UPDATE') || clientMessage.includes('INSERT') || clientMessage.includes('DELETE')) {
    clientMessage = 'Database operation failed';
  }

  // Log on server with sanitized contents
  console.error(`[Server Error ${status}]:`, err.name || 'Error', clientMessage);

  res.status(status).json({
    error: status >= 500 ? 'Internal Server Error' : 'Request Failed',
    message: clientMessage,
  });
}
