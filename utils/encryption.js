// utils/encryption.js - AES-256-GCM credential encryption vault
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Validates the server encryption key format and operational readiness.
 * Throws an explicit error if the key is missing, wrong length, or corrupted.
 */
export function validateEncryptionKey(customKey = null) {
  const key = customKey || process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable must be set (32-byte / 64-hex char string)');
  }
  if (typeof key !== 'string' || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Found ${typeof key === 'string' ? key.length : typeof key} chars.`);
  }
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to exactly 32 bytes. Decoded to ${buf.length} bytes.`);
  }

  // Quick sanity self-test to verify crypto operations work
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, buf, iv);
    const testEncrypted = Buffer.concat([cipher.update('healthcheck', 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const decipher = crypto.createDecipheriv(ALGORITHM, buf, iv);
    decipher.setAuthTag(tag);
    const testDecrypted = decipher.update(testEncrypted, null, 'utf8') + decipher.final('utf8');
    if (testDecrypted !== 'healthcheck') {
      throw new Error('Encryption self-test verification failed');
    }
  } catch (err) {
    throw new Error(`Encryption key self-test failed: ${err.message}`);
  }

  return buf;
}

export function getEncryptionKey() {
  return validateEncryptionKey();
}

/**
 * Encrypts a credentials object using AES-256-GCM
 * Returns { encrypted, iv, authTag } - all hex strings
 */
export function encryptCredential(credentialData, customKeyBuf = null) {
  if (!credentialData || (typeof credentialData !== 'object' && typeof credentialData !== 'string')) {
    throw new Error('Cannot encrypt empty or non-object credential data');
  }

  const key = customKeyBuf || getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plaintext = typeof credentialData === 'string' ? credentialData : JSON.stringify(credentialData);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypts a credential object using AES-256-GCM
 * Input: { encrypted, iv, authTag } - all hex strings
 * Returns the original credential data object
 * Rejects tampered ciphertext or invalid authentication tags
 */
export function decryptCredential(encryptedData, customKeyBuf = null) {
  if (!encryptedData || typeof encryptedData !== 'object') {
    throw new Error('Invalid encrypted data payload: must be an object');
  }

  const { encrypted, iv, authTag } = encryptedData;

  if (!encrypted || typeof encrypted !== 'string') {
    throw new Error('Invalid encrypted data: missing or non-string ciphertext');
  }
  if (!iv || typeof iv !== 'string' || !/^[0-9a-fA-F]+$/.test(iv) || iv.length !== IV_LENGTH * 2) {
    throw new Error(`Invalid IV: must be ${IV_LENGTH * 2} hex characters`);
  }
  if (!authTag || typeof authTag !== 'string' || !/^[0-9a-fA-F]+$/.test(authTag) || authTag.length !== AUTH_TAG_LENGTH * 2) {
    throw new Error(`Invalid auth tag: must be ${AUTH_TAG_LENGTH * 2} hex characters`);
  }

  const key = customKeyBuf || getEncryptionKey();

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  } catch (err) {
    throw new Error('Decryption failed: tampered ciphertext or invalid authentication tag');
  }
}

/**
 * Redact sensitive fields from objects before logging or API serialization
 */
export function redactSecrets(data) {
  if (!data || typeof data !== 'object') return data;

  const SENSITIVE_KEYS = [
    'password', 'secret', 'token', 'key', 'apikey', 'api_key',
    'accesskey', 'secretkey', 'privatekey', 'private_key', 'auth',
    'authorization', 'bearer', 'sessiontoken', 'session_token'
  ];

  if (Array.isArray(data)) {
    return data.map(item => redactSecrets(item));
  }

  const redacted = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some(s => lowerKey.includes(s));

    if (isSensitive && typeof value === 'string') {
      redacted[key] = value.length > 4 ? `••••••••${value.slice(-4)}` : '••••••••';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSecrets(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * Generate a random 32-byte encryption key (for setup scripts)
 */
export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}