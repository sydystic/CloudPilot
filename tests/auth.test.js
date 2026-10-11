// tests/auth.test.js - Secure JWT authentication middleware test suite
import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config();

import { requireAuth } from '../middleware/auth.js';

console.log('🧪 Running JWT Authentication Tests...');

function createMockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

// 1. Missing Authorization header
{
  const req = { headers: {} };
  const res = createMockRes();
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });
  assert.strictEqual(res.statusCode, 401, 'Must return 401 on missing Authorization header');
  assert.strictEqual(nextCalled, false, 'Next must not be called');
  assert.strictEqual(res.body.error, 'Unauthorized');
  console.log('  ✅ 1. Rejection of missing Authorization header: PASSED');
}

// 2. Non-Bearer token scheme
{
  const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
  const res = createMockRes();
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });
  assert.strictEqual(res.statusCode, 401, 'Must return 401 on non-Bearer scheme');
  assert.strictEqual(nextCalled, false);
  console.log('  ✅ 2. Rejection of non-Bearer authorization scheme: PASSED');
}

// 3. Malformed token structure (not 3 dot-separated segments)
{
  const req = { headers: { authorization: 'Bearer this-is-not-a-valid-jwt' } };
  const res = createMockRes();
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });
  assert.strictEqual(res.statusCode, 401, 'Must return 401 on malformed token');
  assert.strictEqual(nextCalled, false);
  assert.ok(res.body.message.includes('JWT format') || res.body.message.includes('Invalid'));
  console.log('  ✅ 3. Rejection of structurally malformed tokens: PASSED');
}

// 4. Forged / invalid signature token
{
  // A forged token with arbitrary payload that fails cryptographic signature verification
  const forgedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkZvcmdlZCJ9.invalidsignaturehere1234567890abcdef';
  const req = { headers: { authorization: `Bearer ${forgedToken}` } };
  const res = createMockRes();
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });
  assert.strictEqual(res.statusCode, 401, 'Must return 401 on forged signature');
  assert.strictEqual(nextCalled, false);
  console.log('  ✅ 4. Cryptographic rejection of forged/invalid signatures: PASSED');
}

// 5. Demo mode cannot bypass auth in production
{
  const prevNodeEnv = process.env.NODE_ENV;
  const prevDemoMode = process.env.DEMO_MODE;
  process.env.NODE_ENV = 'production';
  process.env.DEMO_MODE = 'true';

  const req = { headers: {} };
  const res = createMockRes();
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });
  assert.strictEqual(res.statusCode, 403, 'Must return 403 when demo mode is attempted in production');
  assert.strictEqual(nextCalled, false);

  process.env.NODE_ENV = prevNodeEnv;
  process.env.DEMO_MODE = prevDemoMode;
  console.log('  ✅ 5. Production guard against demo mode bypass: PASSED');
}

console.log('🎉 All JWT Authentication Tests Passed!\n');
