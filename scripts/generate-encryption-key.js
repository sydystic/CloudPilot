// scripts/generate-encryption-key.js
// Generates a random 32-byte (64 hex characters) key for AES-256-GCM encryption

import crypto from 'crypto';

const key = crypto.randomBytes(32).toString('hex');

console.log('\n=============================================================');
console.log('🔑 Generated AES-256-GCM Encryption Key (32 bytes / 64 hex chars)');
console.log('=============================================================\n');
console.log(`ENCRYPTION_KEY=${key}\n`);
console.log('Add the line above to your .env file.\n');
