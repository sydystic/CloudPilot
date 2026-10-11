// routes/templates.js - Workflow Template Marketplace API
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { n8nRequest } from '../utils/n8n.js';
import { getDecryptedCredential } from './credentials.js';
import { DEMO_TEMPLATES } from '../utils/demo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_TEMPLATES_DIR = path.join(__dirname, '../workflow-templates');

const router = Router();
router.use(requireAuth);

const N8N_CRED_TYPE_MAP = {
  aws: 'aws',
  gcp: 'googleApi',
  azure: 'microsoftAzureOAuth2Api',
  github: 'githubApi',
  slack: 'slackApi',
  openai: 'openAiApi',
  dropbox: 'dropboxApi',
  smtp: 'smtp',
  http: 'httpBasicAuth',
};

// ─────────────────────────────────────────────
// GET /api/templates
// Lists templates from Supabase DB table `workflow_templates`,
// falling back to Storage bucket `workflow_templates` or local files.
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  if (process.env.DEMO_MODE === 'true') return res.json({ templates: DEMO_TEMPLATES });

  try {
    const supabase = getSupabaseAdmin();

    // 1. Try fetching from Supabase DB table 'workflow_templates'
    const { data: dbTemplates, error: dbErr } = await supabase
      .from('workflow_templates')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (!dbErr && dbTemplates && dbTemplates.length > 0) {
      const templates = dbTemplates.map(t => ({
        id: t.template_id || t.id,
        template_id: t.template_id || t.id,
        name: t.name,
        description: t.description || '',
        category: t.category || detectCategory(t.name, t.template_json?.nodes || []),
        node_count: (t.template_json?.nodes || []).length,
        tags: t.tags || extractTags(t.name, t.template_json?.nodes || []),
        required_credentials: t.required_credentials || [],
        storage_path: t.template_id,
      }));
      return res.json({ templates });
    }

    // 2. Try storage bucket 'workflow_templates'
    const { data: files, error: listErr } = await supabase
      .storage
      .from('workflow_templates')
      .list('', { limit: 200, sortBy: { column: 'name', order: 'asc' } });

    if (!listErr && files && files.length > 0) {
      const jsonFiles = files.filter(f => f.name && f.name.endsWith('.json'));
      const templates = [];

      for (const file of jsonFiles) {
        try {
          const { data: blob } = await supabase.storage.from('workflow_templates').download(file.name);
          const json = JSON.parse(await blob.text());
          templates.push({
            id: file.name,
            template_id: file.name,
            name: json.name || file.name.replace(/\.json$/i, ''),
            description: json.meta?.description || json.description || '',
            category: detectCategory(json.name || file.name, json.nodes || []),
            node_count: (json.nodes || []).length,
            tags: extractTags(json.name || file.name, json.nodes || []),
            required_credentials: [],
            storage_path: file.name,
          });
        } catch (_) {}
      }

      if (templates.length > 0) {
        templates.sort((a, b) => a.name.localeCompare(b.name));
        return res.json({ templates });
      }
    }

    // 3. Fallback to local files in workflow-templates directory
    const localTemplates = loadLocalTemplates();
    res.json({ templates: localTemplates });

  } catch (err) {
    console.warn('GET /api/templates fallback to local files:', err.message);
    const localTemplates = loadLocalTemplates();
    res.json({ templates: localTemplates });
  }
});

function loadLocalTemplates() {
  const templates = [];
  try {
    if (fs.existsSync(LOCAL_TEMPLATES_DIR)) {
      const files = fs.readdirSync(LOCAL_TEMPLATES_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(LOCAL_TEMPLATES_DIR, file), 'utf8');
          const json = JSON.parse(raw);
          templates.push({
            id: file,
            template_id: file,
            name: json.name || file.replace(/\.json$/i, ''),
            description: json.meta?.description || json.description || `Workflow template with ${(json.nodes || []).length} nodes`,
            category: detectCategory(json.name || file, json.nodes || []),
            node_count: (json.nodes || []).length,
            tags: extractTags(json.name || file, json.nodes || []),
            required_credentials: [],
            storage_path: file,
          });
        } catch (_) {}
      }
    }
  } catch (_) {}
  templates.sort((a, b) => a.name.localeCompare(b.name));
  return templates;
}

function detectCategory(name, nodes) {
  const n = (name || '').toUpperCase();
  if (n.includes('AWS') || n.includes('EC2') || n.includes('S3') || n.includes('IAM') || n.includes('REKOGNITION')) return 'AWS';
  if (n.includes('GCS') || n.includes('GCP') || n.includes('GOOGLE') || n.includes('FIREBASE')) return 'GCP';
  if (n.includes('AZURE')) return 'Azure';
  if (n.includes('DROPBOX')) return 'Storage';
  if (n.includes('SLACK')) return 'Messaging';
  if (n.includes('RAG') || n.includes('AI') || n.includes('OPENAI')) return 'AI';
  const types = (nodes || []).map(nd => (nd.type || '').toLowerCase()).join(' ');
  if (types.includes('aws')) return 'AWS';
  if (types.includes('google')) return 'GCP';
  if (types.includes('slack')) return 'Messaging';
  return 'General';
}

function extractTags(name, nodes) {
  const tags = new Set();
  const n = (name || '').toLowerCase();
  if (n.includes('aws') || n.includes('ec2') || n.includes('s3') || n.includes('iam')) tags.add('aws');
  if (n.includes('gcs') || n.includes('gcp') || n.includes('google')) tags.add('gcp');
  if (n.includes('webhook')) tags.add('webhook');
  if (n.includes('automat')) tags.add('automation');
  if (n.includes('monitor')) tags.add('monitoring');
  if (n.includes('scale') || n.includes('scaling')) tags.add('scaling');
  if (n.includes('rag') || n.includes('ai')) tags.add('ai');
  if (n.includes('dropbox')) tags.add('storage');
  if (n.includes('firebase')) tags.add('database');
  for (const node of (nodes || [])) {
    const t = (node.type || '').toLowerCase();
    if (t.includes('slack')) tags.add('slack');
    if (t.includes('gmail') || t.includes('email')) tags.add('email');
    if (t.includes('http')) tags.add('http');
  }
  return [...tags].slice(0, 5);
}

// ─────────────────────────────────────────────
// POST /api/templates/install-from-storage
// ─────────────────────────────────────────────
router.post('/install-from-storage', async (req, res) => {
  const { storage_path, workflow_name } = req.body;
  if (!storage_path) return res.status(400).json({ error: 'storage_path is required' });

  const userId = req.user.id;
  const supabase = getSupabaseAdmin();

  try {
    const rawJson = await resolveTemplateJson(storage_path, supabase);
    const finalName = (workflow_name || '').trim() || rawJson.name || 'Imported Workflow';

    const sanitized = sanitizeWorkflow(rawJson, finalName);
    const workflowJson = injectCloudPilotTrigger(sanitized);

    const n8nPayload = {
      name: workflowJson.name,
      nodes: workflowJson.nodes,
      connections: workflowJson.connections,
      settings: workflowJson.settings,
    };

    const n8nWorkflow = await n8nRequest('/workflows', 'POST', n8nPayload);
    if (!n8nWorkflow?.id) throw new Error('n8n did not return a workflow ID');

    try { await n8nRequest('/workflows/' + n8nWorkflow.id + '/activate', 'POST'); }
    catch (e) { console.warn('Activate failed:', e.message); }

    const webhookUrl = deriveWebhookUrl(workflowJson.nodes);

    const { data: uw, error: uwErr } = await supabase
      .from('user_workflows')
      .insert({
        user_id: userId,
        engine_workflow_ref: String(n8nWorkflow.id),
        workflow_name: finalName,
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select('id, workflow_name').single();

    if (uwErr) {
      console.warn('user_workflows insert failed:', uwErr.message);
      return res.json({
        success: true,
        workflow: { id: String(n8nWorkflow.id), n8n_id: n8nWorkflow.id, name: finalName },
        webhook_url: webhookUrl,
        warning: 'Workflow created but could not save to database: ' + uwErr.message,
      });
    }

    res.json({
      success: true,
      workflow: { id: uw.id, n8n_id: n8nWorkflow.id, name: uw.workflow_name },
      webhook_url: webhookUrl,
    });
  } catch (err) {
    console.error('install-from-storage error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/templates/import
// ─────────────────────────────────────────────
router.post('/import', async (req, res) => {
  const { template_id, workflow_name, credential_mappings = {} } = req.body;
  if (!template_id) return res.status(400).json({ error: 'template_id is required' });

  if (process.env.DEMO_MODE === 'true') {
    const t = DEMO_TEMPLATES.find(x => x.id === template_id || x.template_id === template_id);
    return res.json({ success: true, workflow: { id: 'demo-wf-' + Date.now(), name: workflow_name || t?.name || 'Imported Workflow' } });
  }

  const userId = req.user.id;
  const supabase = getSupabaseAdmin();

  try {
    const rawJson = await resolveTemplateJson(template_id, supabase);

    const n8nCredIds = {};
    for (const [credType, credId] of Object.entries(credential_mappings)) {
      if (!credId) continue;
      try {
        const credInfo = await getDecryptedCredential(credId, userId);
        const n8nType = N8N_CRED_TYPE_MAP[credType] || credType;
        const n8nCred = await n8nRequest('/credentials', 'POST', {
          name: credInfo.credential_name + '_' + Date.now(),
          type: n8nType,
          data: credInfo.data,
        });
        n8nCredIds[credType] = { id: n8nCred.id, name: credInfo.credential_name };
      } catch (e) { console.warn('Credential failed for ' + credType + ':', e.message); }
    }

    const finalName = (workflow_name || '').trim() || rawJson.name || 'Imported Workflow';
    const sanitized = sanitizeWorkflow(rawJson, finalName);
    const workflowJson = injectCloudPilotTrigger(sanitized);

    if (Object.keys(n8nCredIds).length > 0) {
      workflowJson.nodes = workflowJson.nodes.map(node => {
        if (node.credentials) {
          for (const credKey of Object.keys(node.credentials)) {
            const match = Object.keys(n8nCredIds).find(t =>
              credKey.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(credKey.toLowerCase())
            );
            if (match) node.credentials[credKey] = n8nCredIds[match];
          }
        }
        return node;
      });
    }

    const n8nPayload = {
      name: workflowJson.name,
      nodes: workflowJson.nodes,
      connections: workflowJson.connections,
      settings: workflowJson.settings,
    };

    const n8nWorkflow = await n8nRequest('/workflows', 'POST', n8nPayload);
    if (!n8nWorkflow?.id) throw new Error('n8n did not return a workflow ID');

    try { await n8nRequest('/workflows/' + n8nWorkflow.id + '/activate', 'POST'); }
    catch (e) { console.warn('Activate failed:', e.message); }

    const webhookUrl = deriveWebhookUrl(workflowJson.nodes);

    const { data: uw, error: uwErr } = await supabase
      .from('user_workflows')
      .insert({
        user_id: userId,
        engine_workflow_ref: String(n8nWorkflow.id),
        workflow_name: finalName,
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select('id, workflow_name').single();

    if (uwErr) {
      console.warn('user_workflows insert failed:', uwErr.message);
      return res.json({
        success: true,
        workflow: { id: String(n8nWorkflow.id), n8n_id: n8nWorkflow.id, name: finalName },
        webhook_url: webhookUrl,
        manual_trigger_injected: workflowJson._manualTriggerInjected || false,
        warning: 'Workflow created but could not save to database',
      });
    }

    res.json({
      success: true,
      workflow: { id: uw.id, n8n_id: n8nWorkflow.id, name: uw.workflow_name },
      webhook_url: webhookUrl,
      manual_trigger_injected: workflowJson._manualTriggerInjected || false,
    });
  } catch (err) {
    console.error('Template import error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper: resolve template JSON from DB -> Storage -> Local File
async function resolveTemplateJson(templateId, supabase) {
  // 1. Check DB table workflow_templates
  try {
    const { data: dbRow } = await supabase
      .from('workflow_templates')
      .select('template_json')
      .or(`template_id.eq.${templateId},id.eq.${templateId}`)
      .maybeSingle();

    if (dbRow?.template_json) return dbRow.template_json;
  } catch (_) {}

  // 2. Check Storage bucket 'workflow_templates'
  try {
    const { data: blob } = await supabase.storage.from('workflow_templates').download(templateId);
    if (blob) return JSON.parse(await blob.text());
  } catch (_) {}

  // 3. Check local file
  const sanitizeName = path.basename(templateId);
  const possiblePaths = [
    path.join(LOCAL_TEMPLATES_DIR, sanitizeName),
    path.join(LOCAL_TEMPLATES_DIR, sanitizeName + '.json'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }

  // Find partial match in local folder
  if (fs.existsSync(LOCAL_TEMPLATES_DIR)) {
    const files = fs.readdirSync(LOCAL_TEMPLATES_DIR);
    const match = files.find(f => f.toLowerCase().includes(templateId.toLowerCase().replace('.json', '')));
    if (match) {
      return JSON.parse(fs.readFileSync(path.join(LOCAL_TEMPLATES_DIR, match), 'utf8'));
    }
  }

  throw new Error(`Template "${templateId}" not found in database, storage, or local templates directory`);
}

function sanitizeWorkflow(raw, name) {
  const wf = JSON.parse(JSON.stringify(raw));

  const rawSettings = (wf.settings && typeof wf.settings === 'object') ? wf.settings : {};
  const settings = {};
  if (rawSettings.executionOrder) settings.executionOrder = rawSettings.executionOrder;
  if (rawSettings.saveManualExecutions !== undefined) settings.saveManualExecutions = rawSettings.saveManualExecutions;
  if (rawSettings.saveDataSuccessExecution) settings.saveDataSuccessExecution = rawSettings.saveDataSuccessExecution;
  if (rawSettings.saveDataErrorExecution) settings.saveDataErrorExecution = rawSettings.saveDataErrorExecution;
  if (rawSettings.callerPolicy) settings.callerPolicy = rawSettings.callerPolicy;
  if (rawSettings.errorWorkflow) settings.errorWorkflow = rawSettings.errorWorkflow;
  if (rawSettings.timezone) settings.timezone = rawSettings.timezone;

  if (!settings.executionOrder) settings.executionOrder = 'v1';
  settings.saveManualExecutions = true;
  settings.saveDataSuccessExecution = 'all';
  settings.saveDataErrorExecution = 'all';

  const nodes = (Array.isArray(wf.nodes) ? wf.nodes : []).map(node => {
    const n = { ...node };
    delete n.id;
    if (!Array.isArray(n.position) || n.position.length < 2) n.position = [250, 300];
    return n;
  });

  return {
    name: (name && name.trim()) || wf.name || 'Imported Workflow',
    nodes,
    connections: (wf.connections && typeof wf.connections === 'object') ? wf.connections : {},
    settings,
  };
}

function injectCloudPilotTrigger(wf) {
  const nodes = [...(wf.nodes || [])];
  const connections = JSON.parse(JSON.stringify(wf.connections || {}));

  const WEBHOOK_TYPES = ['n8n-nodes-base.webhook'];
  const MANUAL_TYPES = [
    'n8n-nodes-base.manualTrigger',
    'n8n-nodes-base.start',
    '@n8n/n8n-nodes-langchain.manualChatTrigger',
  ];
  const ALL_TRIGGER_TYPES = [...WEBHOOK_TYPES, ...MANUAL_TYPES];

  if (nodes.some(n => WEBHOOK_TYPES.includes(n.type))) {
    return { ...wf, nodes, connections };
  }

  const minX = nodes.length > 0
    ? Math.min(...nodes.map(n => (Array.isArray(n.position) ? n.position[0] : 250)))
    : 250;
  const avgY = nodes.length > 0
    ? Math.round(nodes.reduce((s, n) => s + (Array.isArray(n.position) ? n.position[1] : 300), 0) / nodes.length)
    : 300;

  const hasManual = nodes.some(n => MANUAL_TYPES.includes(n.type));

  const connectedNodes = new Set();
  for (const srcConns of Object.values(connections)) {
    if (!srcConns || typeof srcConns !== 'object') continue;
    for (const outputs of Object.values(srcConns)) {
      if (!Array.isArray(outputs)) continue;
      for (const branch of outputs) {
        if (Array.isArray(branch)) {
          for (const conn of branch) { if (conn?.node) connectedNodes.add(conn.node); }
        }
      }
    }
  }

  const entryNode = nodes.find(n =>
    !ALL_TRIGGER_TYPES.includes(n.type) && !connectedNodes.has(n.name)
  );

  const firstActionNode = entryNode
    || nodes.find(n => !ALL_TRIGGER_TYPES.includes(n.type))
    || nodes[0];

  const webhookPath = 'cp-' + Math.random().toString(36).slice(2, 10);

  const cloudPilotTrigger = {
    parameters: {
      httpMethod: 'POST',
      path: webhookPath,
      responseMode: 'responseNode',
      options: {},
    },
    name: 'CloudPilot Trigger',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 1,
    position: [minX - 440, avgY - 70],
    webhookId: webhookPath,
  };

  nodes.unshift(cloudPilotTrigger);

  if (hasManual && firstActionNode) {
    connections['CloudPilot Trigger'] = {
      main: [[{ node: firstActionNode.name, type: 'main', index: 0 }]],
    };
  } else if (firstActionNode) {
    const manualTrigger = {
      parameters: {},
      name: 'Manual Trigger',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [minX - 440, avgY + 110],
    };

    const mergeNode = {
      parameters: { mode: 'passThrough', output: 'input1' },
      name: 'Merge Triggers',
      type: 'n8n-nodes-base.merge',
      typeVersion: 2,
      position: [minX - 200, avgY + 20],
    };

    nodes.push(manualTrigger);
    nodes.push(mergeNode);

    connections['CloudPilot Trigger'] = {
      main: [[{ node: 'Merge Triggers', type: 'main', index: 0 }]],
    };
    connections['Manual Trigger'] = {
      main: [[{ node: 'Merge Triggers', type: 'main', index: 1 }]],
    };
    connections['Merge Triggers'] = {
      main: [[{ node: firstActionNode.name, type: 'main', index: 0 }]],
    };

    wf._manualTriggerInjected = true;
  } else {
    connections['CloudPilot Trigger'] = { main: [[]] };
  }

  return {
    name: wf.name,
    nodes,
    connections,
    settings: wf.settings,
    _manualTriggerInjected: wf._manualTriggerInjected || false,
  };
}

function deriveWebhookUrl(nodes) {
  const n8nBase = (process.env.N8N_URL || 'http://localhost:5678').replace(/\/$/, '');
  const webhookNode = (nodes || []).find(n =>
    n.type === 'n8n-nodes-base.webhook' && n.name === 'CloudPilot Trigger'
  );
  const path = webhookNode?.parameters?.path;
  return path ? n8nBase + '/webhook/' + path : null;
}

export default router;