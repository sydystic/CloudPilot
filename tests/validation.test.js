// tests/validation.test.js - Input validation and API protection test suite
import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config();

import { validateParamId, validateBody, safeErrorHandler } from '../middleware/validate.js';

console.log('🧪 Running Input Validation & Protection Tests...');

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

// 1. Parameter Validation (:id)
{
  const validUUIDReq = { params: { id: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d' } };
  const res = createMockRes();
  let nextCalled = false;
  validateParamId('id')(validUUIDReq, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'Valid UUID should be accepted');

  const validAlphaReq = { params: { id: 'workflow_123_abc' } };
  nextCalled = false;
  validateParamId('id')(validAlphaReq, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'Valid alphanumeric ID should be accepted');

  const maliciousReq = { params: { id: '../../../etc/passwd' } };
  nextCalled = false;
  validateParamId('id')(maliciousReq, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false, 'Path traversal param must be rejected');
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, 'Validation Error');
  console.log('  ✅ 1. Parameter format validation & path traversal defense: PASSED');
}

// 2. Request Body Schema Validation
{
  const testSchema = {
    name: { type: 'string', required: true, minLength: 2, maxLength: 50 },
    type: { type: 'string', required: true, enum: ['aws', 'gcp', 'slack'] },
    config: { type: 'object', required: true, notArray: true },
  };

  // Missing required field
  const missingFieldReq = { body: { type: 'aws', config: {} } };
  const res1 = createMockRes();
  let nextCalled = false;
  validateBody(testSchema)(missingFieldReq, res1, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res1.statusCode, 400);
  assert.ok(res1.body.message.includes("'name' is required"));

  // Disallowed enum value
  const badEnumReq = { body: { name: 'Valid Name', type: 'unsupported_type', config: {} } };
  const res2 = createMockRes();
  nextCalled = false;
  validateBody(testSchema)(badEnumReq, res2, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res2.statusCode, 400);
  assert.ok(res2.body.message.includes("must be one of [aws, gcp, slack]"));

  // Array passed where object expected
  const arrayConfigReq = { body: { name: 'Valid Name', type: 'aws', config: [1, 2, 3] } };
  const res3 = createMockRes();
  nextCalled = false;
  validateBody(testSchema)(arrayConfigReq, res3, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res3.statusCode, 400);

  // Valid payload passes
  const validReq = { body: { name: 'Valid Credential', type: 'aws', config: { key: 'val' } } };
  nextCalled = false;
  validateBody(testSchema)(validReq, createMockRes(), () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'Valid payload must be accepted');
  console.log('  ✅ 2. Schema field, type, and enum validation: PASSED');
}

// 3. Mass Assignment Prevention
{
  const strictSchema = {
    name: { type: 'string', required: true },
  };
  const massAssignmentReq = {
    body: {
      name: 'Normal User',
      is_admin: true,
      role: 'superuser',
    },
  };
  const res = createMockRes();
  let nextCalled = false;
  validateBody(strictSchema)(massAssignmentReq, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false, 'Unexpected fields must be rejected');
  assert.strictEqual(res.statusCode, 400);
  assert.ok(res.body.message.includes('Unexpected field(s) not allowed'));
  console.log('  ✅ 3. Mass assignment / unexpected fields rejection: PASSED');
}

// 4. Safe Error Handler (Leakage Prevention)
{
  const leakedSecretErr = new Error('Database connection failed at postgres://user:super_secret_password@db.internal.cloud:5432');
  const res = createMockRes();
  safeErrorHandler(leakedSecretErr, {}, res, () => {});
  assert.strictEqual(res.statusCode, 500);
  assert.strictEqual(res.body.error, 'Internal Server Error');
  assert.ok(!res.body.message.includes('super_secret_password'), 'Must not leak database password');
  assert.ok(!res.body.stack, 'Must not return stack traces to clients');

  const sqlErr = new Error('Syntax error in SQL: SELECT * FROM credentials WHERE token = 123');
  const res2 = createMockRes();
  safeErrorHandler(sqlErr, {}, res2, () => {});
  assert.ok(!res2.body.message.includes('SELECT'), 'Must not leak raw SQL query');
  console.log('  ✅ 4. Information disclosure defense (no SQL/secrets/stack traces): PASSED');
}

console.log('🎉 All Input Validation & Protection Tests Passed!\n');
