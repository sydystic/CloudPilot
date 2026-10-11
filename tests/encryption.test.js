// tests/encryption.test.js - AES-256-GCM vault test suite
import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config();

import {
  encryptCredential,
  decryptCredential,
  validateEncryptionKey,
  generateEncryptionKey,
  redactSecrets,
} from '../utils/encryption.js';

console.log('🧪 Running AES-256-GCM Encryption Tests...');

// 1. Validate key at startup
try {
  const keyBuf = validateEncryptionKey();
  assert.strictEqual(keyBuf.length, 32, 'Key buffer must be exactly 32 bytes');
  console.log('  ✅ 1. Encryption key validation (32 bytes / 256 bits): PASSED');
} catch (err) {
  assert.fail(`Key validation failed: ${err.message}`);
}

// 2. Encryption and Decryption Round Trip
const sampleCreds = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
};

const encryptedPayload = encryptCredential(sampleCreds);
assert.ok(encryptedPayload.encrypted, 'Must return ciphertext');
assert.ok(encryptedPayload.iv, 'Must return IV');
assert.ok(encryptedPayload.authTag, 'Must return auth tag');
assert.strictEqual(encryptedPayload.iv.length, 32, 'IV hex must be 32 chars (16 bytes)');
assert.strictEqual(encryptedPayload.authTag.length, 32, 'Auth tag hex must be 32 chars (16 bytes)');

const decrypted = decryptCredential(encryptedPayload);
assert.deepStrictEqual(decrypted, sampleCreds, 'Decrypted object must match original');
console.log('  ✅ 2. Round-trip AES-256-GCM encryption & decryption: PASSED');

// 3. Cryptographic Nonce/IV Uniqueness
const encrypted1 = encryptCredential(sampleCreds);
const encrypted2 = encryptCredential(sampleCreds);
assert.notStrictEqual(encrypted1.iv, encrypted2.iv, 'Two encryptions must have distinct IVs');
assert.notStrictEqual(encrypted1.encrypted, encrypted2.encrypted, 'Ciphertexts must differ due to unique IV');
console.log('  ✅ 3. Nonce/IV cryptographic uniqueness per operation: PASSED');

// 4. Reject Tampered Ciphertext
const tamperedCiphertext = {
  ...encryptedPayload,
  encrypted: encryptedPayload.encrypted.slice(0, -2) + (encryptedPayload.encrypted.slice(-2) === 'aa' ? 'bb' : 'aa'),
};
assert.throws(
  () => decryptCredential(tamperedCiphertext),
  /Decryption failed: tampered ciphertext or invalid authentication tag/,
  'Must reject tampered ciphertext'
);
console.log('  ✅ 4. Rejection of tampered ciphertext: PASSED');

// 5. Reject Tampered Auth Tag
const tamperedTag = {
  ...encryptedPayload,
  authTag: '00' + encryptedPayload.authTag.slice(2),
};
assert.throws(
  () => decryptCredential(tamperedTag),
  /Decryption failed: tampered ciphertext or invalid authentication tag/,
  'Must reject tampered authentication tag'
);
console.log('  ✅ 5. Rejection of tampered authentication tag: PASSED');

// 6. Reject Wrong Encryption Key
const differentKey = Buffer.from(generateEncryptionKey(), 'hex');
assert.throws(
  () => decryptCredential(encryptedPayload, differentKey),
  /Decryption failed: tampered ciphertext or invalid authentication tag/,
  'Must reject decryption attempt with incorrect key'
);
console.log('  ✅ 6. Rejection of decryption with incorrect key: PASSED');

// 7. Secret Redaction
const sensitiveData = {
  user: 'john_doe',
  awsSecretKey: 'super-secret-aws-key-12345',
  password: 'Password123!',
  nested: {
    apiKey: 'sk-abcdef1234567890',
    publicInfo: 'visible',
  },
};
const redacted = redactSecrets(sensitiveData);
assert.strictEqual(redacted.user, 'john_doe');
assert.ok(redacted.awsSecretKey.includes('••••••••'), 'Secret key must be masked');
assert.ok(redacted.password.includes('••••••••'), 'Password must be masked');
assert.ok(redacted.nested.apiKey.includes('••••••••'), 'API key must be masked');
assert.strictEqual(redacted.nested.publicInfo, 'visible');
console.log('  ✅ 7. Deep secret redaction in data objects: PASSED');

console.log('🎉 All AES-256-GCM Encryption Tests Passed!\n');
