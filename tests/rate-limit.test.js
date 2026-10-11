// tests/rate-limit.test.js - Rate limiting test suite
import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config();

import { app } from '../server.js';
import http from 'http';

console.log('🧪 Running Rate Limiting Tests...');

const TEST_PORT = 4099;
const server = app.listen(TEST_PORT);

try {
  const clientId = `test-client-${Date.now()}`;
  let lastStatus = 0;
  let lastBody = null;
  let retryAfterHeader = null;

  // testLimiter allows 3 requests per minute
  for (let i = 1; i <= 4; i++) {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/test-rate-limit`, {
      headers: { 'X-Test-Client-Id': clientId },
    });
    lastStatus = res.status;
    retryAfterHeader = res.headers.get('retry-after');
    lastBody = await res.json().catch(() => ({}));

    if (i <= 3) {
      assert.strictEqual(lastStatus, 200, `Request ${i} should be permitted (200 OK)`);
    } else {
      assert.strictEqual(lastStatus, 429, 'Request 4 must be rate-limited with HTTP 429');
    }
  }

  assert.ok(lastBody.error === 'Too Many Requests', 'Error field must specify Too Many Requests');
  assert.ok(lastBody.message.includes('Rate limit exceeded'), 'Message must inform user of rate limit');
  assert.ok(typeof lastBody.retryAfter === 'number', 'Must specify retryAfter in seconds');
  assert.ok(retryAfterHeader, 'Must set Retry-After HTTP header');

  console.log('  ✅ 1. Rate limit threshold enforcement (HTTP 429): PASSED');
  console.log('  ✅ 2. Standardized non-sensitive error body: PASSED');
  console.log('  ✅ 3. Presence of Retry-After HTTP header: PASSED');

  console.log('🎉 All Rate Limiting Tests Passed!\n');
} finally {
  server.close();
}
