// routes/credentials.js - Secure credential vault with AES-256-GCM & n8n synchronization
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { encryptCredential, decryptCredential, redactSecrets } from '../utils/encryption.js';
import { n8nRequest } from '../utils/n8n.js';
import { DEMO_CREDENTIALS } from '../utils/demo.js';

const router = Router();
router.use(requireAuth);

export const SUPPORTED_CREDENTIAL_TYPES = ['aws', 'gcp', 'azure', 'github', 'slack'];

/**
 * Formats provider-specific credentials into the payload schema expected by n8n
 */
export function formatCredentialForN8n(type, creds) {
  if (!creds || typeof creds !== 'object') return null;

  switch (type) {
    case 'aws': {
      const accessKeyId = creds.awsAccessKey || creds.accessKeyId || '';
      const secretAccessKey = creds.awsSecretKey || creds.secretAccessKey || '';
      const region = creds.awsRegion || creds.region || 'us-east-1';
      if (!accessKeyId || !secretAccessKey) return null;

      return {
        type: 'aws',
        data: {
          accessKeyId,
          secretAccessKey,
          region,
          sessionToken: creds.sessionToken || '',
          rekognitionEndpoint: '',
          lambdaEndpoint: '',
          snsEndpoint: '',
          sesEndpoint: '',
          sqsEndpoint: '',
          s3Endpoint: '',
          ssmEndpoint: '',
        },
      };
    }

    case 'github': {
      const accessToken = creds.githubToken || creds.accessToken || creds.token || '';
      if (!accessToken) return null;
      return {
        type: 'githubApi',
        data: { accessToken },
      };
    }

    case 'slack': {
      const accessToken = creds.slackToken || creds.accessToken || creds.token || '';
      if (!accessToken) return null;
      return {
        type: 'slackApi',
        data: { accessToken },
      };
    }

    case 'gcp': {
      const email = creds.gcpServiceAccountEmail || creds.email || '';
      const privateKey = creds.gcpPrivateKey || creds.privateKey || '';
      if (!email || !privateKey) return null;
      return {
        type: 'googleApi',
        data: { email, privateKey },
      };
    }

    case 'azure': {
      const clientId = creds.azureClientId || creds.clientId || '';
      const clientSecret = creds.azureClientSecret || creds.clientSecret || '';
      const tenantId = creds.azureTenantId || creds.tenantId || '';
      if (!clientId || !clientSecret || !tenantId) return null;
      return {
        type: 'microsoftAzureOAuth2Api',
        data: { clientId, clientSecret, tenantId },
      };
    }

    default:
      return null;
  }
}

// ─────────────────────────────────────────────
// GET /api/credentials - List credentials (metadata only, secrets NEVER exposed)
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  if (process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production') {
    return res.json({ credentials: DEMO_CREDENTIALS });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('user_credentials')
      .select('id, credential_type, credential_name, n8n_credential_id, is_valid, last_validated_at, created_at, updated_at')
      .eq('user_id', req.user.id)
      .eq('is_valid', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Map truthful synchronization status
    const credentials = (data || []).map(c => ({
      id: c.id,
      credential_type: c.credential_type,
      credential_name: c.credential_name,
      is_valid: c.is_valid,
      n8n_credential_id: c.n8n_credential_id,
      sync_status: c.n8n_credential_id ? 'synced' : 'failed',
      last_validated_at: c.last_validated_at,
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));

    res.json({ credentials });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch credentials', message: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/credentials - Create, Encrypt, & Sync Credential
// ─────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { credential_type, credential_name, credentials } = req.body;

  if (!credential_type || typeof credential_type !== 'string') {
    return res.status(400).json({ error: 'credential_type is required' });
  }
  if (!credential_name || typeof credential_name !== 'string' || credential_name.trim().length === 0) {
    return res.status(400).json({ error: 'credential_name is required' });
  }
  if (!credentials || typeof credentials !== 'object' || Object.keys(credentials).length === 0) {
    return res.status(400).json({ error: 'credentials object is required and must not be empty' });
  }

  const cleanType = credential_type.toLowerCase().trim();
  if (!SUPPORTED_CREDENTIAL_TYPES.includes(cleanType)) {
    return res.status(400).json({
      error: `Unsupported credential type '${credential_type}'`,
      supported_types: SUPPORTED_CREDENTIAL_TYPES,
    });
  }

  if (process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production') {
    return res.json({
      success: true,
      credential: {
        id: `cred-${Date.now()}`,
        credential_type: cleanType,
        credential_name: credential_name.trim(),
        is_valid: true,
        sync_status: 'synced',
        n8n_credential_id: 'demo-n8n-cred-id',
        created_at: new Date().toISOString(),
      },
      n8n_synced: true,
      sync_status: 'synced',
    });
  }

  try {
    const supabase = getSupabaseAdmin();
    const userId = req.user.id;
    const cleanName = credential_name.trim();

    // 1. Encrypt credentials on backend before database persistence
    const encrypted = encryptCredential(credentials);

    // 2. Persist encrypted data securely in Supabase
    const { data: record, error: dbErr } = await supabase
      .from('user_credentials')
      .insert({
        user_id: userId,
        credential_type: cleanType,
        credential_name: cleanName,
        encrypted_data: JSON.stringify(encrypted),
        is_valid: true,
        last_validated_at: new Date().toISOString(),
      })
      .select('id, credential_type, credential_name, is_valid, created_at')
      .single();

    if (dbErr) throw dbErr;

    // 3. Format and synchronize to CloudPilot n8n (port 5680)
    let n8nCredentialId = null;
    let syncError = null;

    const n8nFormatted = formatCredentialForN8n(cleanType, credentials);
    if (n8nFormatted) {
      try {
        const n8nName = `${cleanName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${userId.slice(0, 8)}_${Date.now()}`;
        const n8nCred = await n8nRequest('/credentials', 'POST', {
          name: n8nName,
          type: n8nFormatted.type,
          data: n8nFormatted.data,
        });

        if (n8nCred?.id) {
          n8nCredentialId = n8nCred.id;

          // Save the CloudPilot-to-n8n mapping
          await supabase
            .from('user_credentials')
            .update({ n8n_credential_id: n8nCredentialId })
            .eq('id', record.id);
        }
      } catch (n8nErr) {
        syncError = n8nErr.message;
        console.warn('n8n credential sync failed:', n8nErr.message);
      }
    } else {
      syncError = 'Credential data did not meet required provider schema for n8n synchronization';
    }

    // 4. Audit log (never log decrypted secrets)
    try {
      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'credential_added',
        resource_type: 'credential',
        resource_id: record.id,
        metadata: {
          credential_type: cleanType,
          credential_name: cleanName,
          n8n_synced: !!n8nCredentialId,
          sync_status: n8nCredentialId ? 'synced' : 'failed',
        },
      });
    } catch (_) {}

    // 5. Return truthful synchronization status
    const isSynced = Boolean(n8nCredentialId);
    res.status(201).json({
      success: true,
      credential: {
        id: record.id,
        credential_type: record.credential_type,
        credential_name: record.credential_name,
        is_valid: record.is_valid,
        n8n_credential_id: n8nCredentialId,
        sync_status: isSynced ? 'synced' : 'failed',
        created_at: record.created_at,
      },
      n8n_synced: isSynced,
      sync_status: isSynced ? 'synced' : 'failed',
      sync_error: isSynced ? null : (syncError || 'n8n synchronization incomplete'),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create credential', message: err.message });
  }
});

// ─────────────────────────────────────────────
// PUT /api/credentials/:id - Update credential & re-sync to n8n
// ─────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { credential_name, credentials } = req.body;

  if (process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production') {
    return res.json({ success: true, sync_status: 'synced', n8n_synced: true });
  }

  try {
    const supabase = getSupabaseAdmin();
    const userId = req.user.id;

    // Verify ownership
    const { data: existing, error: findErr } = await supabase
      .from('user_credentials')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .eq('is_valid', true)
      .single();

    if (findErr || !existing) {
      return res.status(404).json({ error: 'Credential not found or unauthorized' });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (credential_name && typeof credential_name === 'string') {
      updates.credential_name = credential_name.trim();
    }

    let activeCredData = null;

    if (credentials && typeof credentials === 'object' && Object.keys(credentials).length > 0) {
      const encrypted = encryptCredential(credentials);
      updates.encrypted_data = JSON.stringify(encrypted);
      activeCredData = credentials;
    } else {
      // Decrypt existing for n8n sync
      try {
        activeCredData = decryptCredential(JSON.parse(existing.encrypted_data));
      } catch (_) {}
    }

    // Sync to n8n (n8n public API creates fresh credentials and does not support PUT)
    let n8nCredentialId = existing.n8n_credential_id;
    let syncError = null;

    const n8nFormatted = formatCredentialForN8n(existing.credential_type, activeCredData);
    if (n8nFormatted) {
      try {
        const n8nName = `${(updates.credential_name || existing.credential_name).replace(/[^a-zA-Z0-9_-]/g, '_')}_${userId.slice(0, 8)}_${Date.now()}`;
        if (n8nCredentialId) {
          try {
            await n8nRequest(`/credentials/${n8nCredentialId}`, 'DELETE');
          } catch (_) {}
        }
        const n8nCred = await n8nRequest('/credentials', 'POST', {
          name: n8nName,
          type: n8nFormatted.type,
          data: n8nFormatted.data,
        });
        if (n8nCred?.id) {
          n8nCredentialId = n8nCred.id;
          updates.n8n_credential_id = n8nCredentialId;
        }
      } catch (n8nErr) {
        syncError = n8nErr.message;
      }
    }

    // Update in Supabase
    const { data: updated, error: updateErr } = await supabase
      .from('user_credentials')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, credential_type, credential_name, n8n_credential_id, is_valid, updated_at')
      .single();

    if (updateErr) throw updateErr;

    const isSynced = Boolean(n8nCredentialId && !syncError);
    res.json({
      success: true,
      credential: {
        ...updated,
        sync_status: isSynced ? 'synced' : 'failed',
      },
      n8n_synced: isSynced,
      sync_status: isSynced ? 'synced' : 'failed',
      sync_error: syncError,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update credential', message: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/credentials/:id/sync - Safe Retry Synchronization
// ─────────────────────────────────────────────
router.post('/:id/sync', async (req, res) => {
  const { id } = req.params;

  if (process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production') {
    return res.json({ success: true, sync_status: 'synced', n8n_synced: true });
  }

  try {
    const supabase = getSupabaseAdmin();
    const userId = req.user.id;

    // Verify ownership
    const { data: record, error: findErr } = await supabase
      .from('user_credentials')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .eq('is_valid', true)
      .single();

    if (findErr || !record) {
      return res.status(404).json({ error: 'Credential not found or unauthorized' });
    }

    const decrypted = decryptCredential(JSON.parse(record.encrypted_data));
    const n8nFormatted = formatCredentialForN8n(record.credential_type, decrypted);

    if (!n8nFormatted) {
      return res.status(400).json({
        error: 'Cannot synchronize',
        message: 'Credential data does not conform to n8n provider schema',
      });
    }

    const n8nName = `${record.credential_name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${userId.slice(0, 8)}_${Date.now()}`;
    let n8nCredentialId = record.n8n_credential_id;

    if (n8nCredentialId) {
      try {
        await n8nRequest(`/credentials/${n8nCredentialId}`, 'DELETE');
      } catch (_) {}
    }

    const newCred = await n8nRequest('/credentials', 'POST', {
      name: n8nName,
      type: n8nFormatted.type,
      data: n8nFormatted.data,
    });
    n8nCredentialId = newCred?.id || null;

    if (n8nCredentialId) {
      await supabase
        .from('user_credentials')
        .update({ n8n_credential_id: n8nCredentialId, last_validated_at: new Date().toISOString() })
        .eq('id', id);
    }

    const isSynced = Boolean(n8nCredentialId);
    res.json({
      success: isSynced,
      n8n_synced: isSynced,
      sync_status: isSynced ? 'synced' : 'failed',
      n8n_credential_id: n8nCredentialId,
    });
  } catch (err) {
    res.status(500).json({ error: 'Synchronization failed', message: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/credentials/:id - Delete & Remove from n8n
// ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  if (process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production') {
    return res.json({ success: true, n8n_deleted: true });
  }

  try {
    const supabase = getSupabaseAdmin();
    const userId = req.user.id;

    // Verify ownership and get n8n credential ID
    const { data: record, error: findErr } = await supabase
      .from('user_credentials')
      .select('id, n8n_credential_id')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (findErr || !record) {
      return res.status(404).json({ error: 'Credential not found or unauthorized' });
    }

    // Clean up from n8n if mapped
    let n8nDeleted = false;
    if (record.n8n_credential_id) {
      try {
        await n8nRequest(`/credentials/${record.n8n_credential_id}`, 'DELETE');
        n8nDeleted = true;
      } catch (n8nErr) {
        console.warn(`Could not delete credential ${record.n8n_credential_id} from n8n:`, n8nErr.message);
      }
    }

    // Soft-delete in Supabase (mark is_valid = false)
    const { error } = await supabase
      .from('user_credentials')
      .update({ is_valid: false, n8n_credential_id: null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', userId);

    if (error) throw error;

    // Audit log
    try {
      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'credential_deleted',
        resource_type: 'credential',
        resource_id: req.params.id,
        metadata: { n8n_deleted: n8nDeleted },
      });
    } catch (_) {}

    res.json({ success: true, n8n_deleted: n8nDeleted });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete credential', message: err.message });
  }
});

// ─────────────────────────────────────────────
// Internal helper - get decrypted credential data
// (Strictly for authorized internal backend operations, verified by userId)
// ─────────────────────────────────────────────
export async function getDecryptedCredential(credentialId, userId) {
  if (!userId) {
    throw new Error('Unauthorized: missing userId for credential retrieval');
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('user_credentials')
    .select('*')
    .eq('id', credentialId)
    .eq('user_id', userId)
    .eq('is_valid', true)
    .single();

  if (error || !data) {
    throw new Error('Credential not found or unauthorized');
  }

  const parsed = JSON.parse(data.encrypted_data);
  const decrypted = decryptCredential(parsed);

  return {
    id: data.id,
    credential_type: data.credential_type,
    credential_name: data.credential_name,
    data: decrypted,
  };
}

export default router;