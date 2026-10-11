// tests/credentials-sync.test.js - End-to-end credential sync with CloudPilot n8n (port 5680)
import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config();

import { app } from '../server.js';
import { getSupabaseAdmin, getSupabase } from '../utils/supabase.js';
import { decryptCredential } from '../utils/encryption.js';
import { n8nRequest } from '../utils/n8n.js';

console.log('🧪 Running End-to-End Credential Synchronization Tests...');

const TEST_PORT = 4097;
const server = app.listen(TEST_PORT);

const supabaseAdmin = getSupabaseAdmin();
const supabaseAnon = getSupabase();

let userA = null;
let userB = null;
let tokenA = null;
let tokenB = null;
let testN8nCredId = null;

try {
  // 1. Setup isolated test users in Supabase Auth
  const emailA = `test-user-a-${Date.now()}@cloudpilot.test`;
  const emailB = `test-user-b-${Date.now()}@cloudpilot.test`;
  const password = 'TestSecurePassword123!';

  const { data: createA, error: errA } = await supabaseAdmin.auth.admin.createUser({
    email: emailA,
    password,
    email_confirm: true,
  });
  if (errA) throw errA;
  userA = createA.user;

  const { data: createB, error: errB } = await supabaseAdmin.auth.admin.createUser({
    email: emailB,
    password,
    email_confirm: true,
  });
  if (errB) throw errB;
  userB = createB.user;

  // 2. Sign in to obtain genuine Supabase access tokens
  const { data: loginA, error: loginErrA } = await supabaseAnon.auth.signInWithPassword({
    email: emailA,
    password,
  });
  if (loginErrA) throw loginErrA;
  tokenA = loginA.session.access_token;

  const { data: loginB, error: loginErrB } = await supabaseAnon.auth.signInWithPassword({
    email: emailB,
    password,
  });
  if (loginErrB) throw loginErrB;
  tokenB = loginB.session.access_token;

  console.log('  ✅ 1. Real user signup & login with Supabase Auth: PASSED');

  // 3. Rejection of unauthenticated request
  const unauthRes = await fetch(`http://localhost:${TEST_PORT}/api/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-Bypass-Rate-Limit': 'true' },
    body: JSON.stringify({
      credential_type: 'aws',
      credential_name: 'Unauth AWS',
      credentials: { awsAccessKey: 'KEY', awsSecretKey: 'SECRET', awsRegion: 'us-east-1' },
    }),
  });
  assert.strictEqual(unauthRes.status, 401, 'Must reject unauthenticated request with 401');
  console.log('  ✅ 2. Rejection of unauthenticated request (401): PASSED');

  // 4. Rejection of unsupported credential type
  const badTypeRes = await fetch(`http://localhost:${TEST_PORT}/api/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenA}`,
      'X-Test-Bypass-Rate-Limit': 'true',
    },
    body: JSON.stringify({
      credential_type: 'unsupported_service',
      credential_name: 'Test Bad',
      credentials: { foo: 'bar' },
    }),
  });
  assert.strictEqual(badTypeRes.status, 400);
  const badTypeJson = await badTypeRes.json();
  assert.ok(badTypeJson.error.includes('Unsupported credential type'));
  console.log('  ✅ 3. Rejection of unsupported credential type: PASSED');

  // 5. User A creates an AWS credential -> Encrypted + Synced to CloudPilot n8n on port 5680
  const createRes = await fetch(`http://localhost:${TEST_PORT}/api/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenA}`,
      'X-Test-Bypass-Rate-Limit': 'true',
    },
    body: JSON.stringify({
      credential_type: 'aws',
      credential_name: 'Production AWS',
      credentials: {
        awsAccessKey: 'AKIAIOSFODNN7EXAMPLE',
        awsSecretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        awsRegion: 'us-east-1',
      },
    }),
  });
  assert.strictEqual(createRes.status, 201, `Creation must return 201 Created: ${createRes.status}`);
  const createData = await createRes.json();
  assert.strictEqual(createData.success, true);
  assert.strictEqual(createData.sync_status, 'synced');
  assert.strictEqual(createData.n8n_synced, true);
  assert.ok(createData.credential.n8n_credential_id, 'Must return n8n credential ID');
  const credentialId = createData.credential.id;
  testN8nCredId = createData.credential.n8n_credential_id;

  // Verify no plaintext secrets returned
  assert.strictEqual(createData.credential.credentials, undefined);
  assert.strictEqual(createData.credential.encrypted_data, undefined);
  console.log(`  ✅ 4. Credential creation & automatic sync to n8n (port 5680) [n8n ID: ${testN8nCredId}]: PASSED`);

  // 6. Verify encryption in database
  const { data: dbRecord } = await supabaseAdmin
    .from('user_credentials')
    .select('*')
    .eq('id', credentialId)
    .single();

  assert.ok(dbRecord.encrypted_data, 'Must store encrypted payload in DB');
  assert.ok(!dbRecord.encrypted_data.includes('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'), 'No plaintext secret in DB');
  const decrypted = decryptCredential(JSON.parse(dbRecord.encrypted_data));
  assert.strictEqual(decrypted.awsAccessKey, 'AKIAIOSFODNN7EXAMPLE');
  assert.strictEqual(decrypted.awsSecretKey, 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  console.log('  ✅ 5. AES-256-GCM encrypted persistence in Supabase: PASSED');

  // 7. Verify listing credentials for User A
  const listResA = await fetch(`http://localhost:${TEST_PORT}/api/credentials`, {
    headers: { 'Authorization': `Bearer ${tokenA}`, 'X-Test-Bypass-Rate-Limit': 'true' },
  });
  const listDataA = await listResA.json();
  assert.ok(listDataA.credentials.some(c => c.id === credentialId));
  console.log('  ✅ 6. User A lists own credentials with synced status: PASSED');

  // 8. Cross-User Resource Isolation: User B cannot see or access User A's credential
  const listResB = await fetch(`http://localhost:${TEST_PORT}/api/credentials`, {
    headers: { 'Authorization': `Bearer ${tokenB}`, 'X-Test-Bypass-Rate-Limit': 'true' },
  });
  const listDataB = await listResB.json();
  assert.strictEqual(listDataB.credentials.some(c => c.id === credentialId), false, 'User B must not see User A credential');

  // User B tries to delete User A's credential
  const unauthorizedDelete = await fetch(`http://localhost:${TEST_PORT}/api/credentials/${credentialId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tokenB}`, 'X-Test-Bypass-Rate-Limit': 'true' },
  });
  assert.strictEqual(unauthorizedDelete.status, 404, 'User B cannot delete User A credential (404/unauthorized)');
  console.log('  ✅ 7. Cross-user resource isolation & unauthorized access defense: PASSED');

  // 9. Retry synchronization endpoint
  const retrySyncRes = await fetch(`http://localhost:${TEST_PORT}/api/credentials/${credentialId}/sync`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tokenA}`, 'X-Test-Bypass-Rate-Limit': 'true' },
  });
  assert.strictEqual(retrySyncRes.status, 200);
  const retrySyncData = await retrySyncRes.json();
  assert.strictEqual(retrySyncData.n8n_synced, true);
  const activeN8nCredId = retrySyncData.n8n_credential_id;
  console.log('  ✅ 8. Safe retry synchronization mechanism: PASSED');

  // 10. Deletion and cleanup from n8n & Supabase
  const deleteRes = await fetch(`http://localhost:${TEST_PORT}/api/credentials/${credentialId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tokenA}`, 'X-Test-Bypass-Rate-Limit': 'true' },
  });
  assert.strictEqual(deleteRes.status, 200);
  const deleteData = await deleteRes.json();
  assert.strictEqual(deleteData.success, true);
  assert.strictEqual(deleteData.n8n_deleted, true);

  // Verify removed from n8n list
  const n8nListAfter = await n8nRequest('/credentials');
  const stillExistsInN8n = (n8nListAfter.data || []).some(c => c.id === activeN8nCredId);
  assert.strictEqual(stillExistsInN8n, false, 'Credential must no longer exist in n8n after deletion');

  testN8nCredId = null;
  console.log('  ✅ 9. Credential deletion cleanup in n8n and Supabase: PASSED');

  console.log('🎉 All Credential Synchronization Tests Passed!\n');
} finally {
  // Cleanup test users and test n8n credentials if any remain
  if (testN8nCredId) {
    try { await n8nRequest(`/credentials/${testN8nCredId}`, 'DELETE'); } catch (_) {}
  }
  if (userA) {
    try { await supabaseAdmin.auth.admin.deleteUser(userA.id); } catch (_) {}
  }
  if (userB) {
    try { await supabaseAdmin.auth.admin.deleteUser(userB.id); } catch (_) {}
  }
  server.close();
}
