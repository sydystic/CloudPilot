// public/views/credentials.js - Notion-inspired credential vault with AES-256-GCM encryption
import { api, escapeHtml, formatDate } from '../api.js';
import { showModal, showToast, setPageHeader, setTopActions } from '../ui.js';

export async function credentialsView() {
  setPageHeader('Credential Vault', 'Securely manage your cloud credentials with AES-256-GCM encryption');
  setTopActions(`
    <button class="btn-create" onclick="window._showAddCredModal()">
      <i class="fas fa-plus"></i> Add Credential
    </button>
  `);

  const grid = document.getElementById('workflowsGrid');
  grid.innerHTML = `<div class="loading-card"><div class="spinner-small"></div><span>Loading credentials…</span></div>`;

  try {
    const data = await api.getCredentials();
    renderCredentials(data?.credentials || []);
  } catch (err) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon" style="background:rgba(239,68,68,0.08);color:#dc2626">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <h3>Failed to load credentials</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

function renderCredentials(creds) {
  const grid = document.getElementById('workflowsGrid');

  if (!creds.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon">
          <i class="fas fa-key"></i>
        </div>
        <h3>No credentials yet</h3>
        <p>Add your first cloud credential to start importing templates</p>
        <button class="btn-create" onclick="window._showAddCredModal()">
          <i class="fas fa-plus"></i> Add Credential
        </button>
      </div>
    `;
    return;
  }

  const icons = {
    aws: 'fab fa-aws',
    gcp: 'fab fa-google',
    azure: 'fab fa-microsoft',
    github: 'fab fa-github',
    slack: 'fab fa-slack'
  };

  const colors = {
    aws: '#f97316',
    gcp: '#3b82f6',
    azure: '#0075de',
    github: '#1f2937',
    slack: '#10b981'
  };

  grid.innerHTML = creds.map(c => {
    const icon = icons[c.credential_type] || 'fa-key';
    const color = colors[c.credential_type] || '#0075de';
    return `
      <div class="wf-card">
        <div class="cred-header">
          <div class="cred-icon" style="background:${color}22;color:${color}">
            <i class="${icon}"></i>
          </div>
          <div>
            <h3>${escapeHtml(c.credential_name)}</h3>
            <div class="cred-type">${(c.credential_type || '').toUpperCase()}</div>
          </div>
          <div style="margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <span class="status-badge ${c.is_valid ? 'active' : 'inactive'}">
              <span class="status-dot"></span>
              ${c.is_valid ? 'Valid' : 'Invalid'}
            </span>
            <span class="status-badge ${c.sync_status === 'synced' ? 'active' : 'inactive'}" style="font-size:10px;padding:2px 8px;${c.sync_status === 'synced' ? '' : 'background:rgba(217,119,2,0.08);color:#d97706;border-color:rgba(217,119,2,0.2)'}">
              <i class="fas fa-${c.sync_status === 'synced' ? 'check-circle' : 'exclamation-circle'}" style="font-size:9px"></i>
              ${c.sync_status === 'synced' ? 'n8n Synced' : 'Sync Pending'}
            </span>
          </div>
        </div>
        <div class="cred-meta">
          <div class="meta-item">
            <i class="fas fa-lock"></i>
            <span>AES-256-GCM encrypted</span>
          </div>
          <div class="meta-item">
            <i class="fas fa-calendar"></i>
            <span>Added ${formatDate(c.created_at)}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:0.75rem">
          ${c.sync_status !== 'synced' ? `
            <button class="wf-btn secondary" style="flex:1" onclick="window._syncCredential('${escapeHtml(c.id)}', this)">
              <i class="fas fa-sync-alt"></i> Retry Sync
            </button>
          ` : ''}
          <button class="wf-btn danger" style="${c.sync_status !== 'synced' ? 'flex:1' : 'width:100%'}"
            onclick="window._deleteCredential('${escapeHtml(c.id)}', '${escapeHtml(c.credential_name)}')">
            <i class="fas fa-trash"></i> Remove
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window._showAddCredModal = () => {
  showModal('Add Credential', `
    <div class="form-group">
      <label class="form-label">Credential Type</label>
      <select id="credType" class="form-input" onchange="window._updateCredFields()">
        <option value="aws">AWS</option>
        <option value="gcp">Google Cloud (GCP)</option>
        <option value="azure">Microsoft Azure</option>
        <option value="github">GitHub</option>
        <option value="slack">Slack</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Credential Name</label>
      <input type="text" id="credName" class="form-input" placeholder="e.g. AWS Production">
    </div>
    <div id="credFields"></div>
    <div class="security-note">
      <i class="fas fa-shield-alt"></i>
      Secrets are encrypted with AES-256-GCM before storage. They are never sent to the frontend.
    </div>
    <button class="wf-btn primary" style="width:100%;margin-top:1rem" onclick="window._submitCredential()">
      <i class="fas fa-lock"></i> Save Credential
    </button>
  `);
  window._updateCredFields();
};

window._updateCredFields = () => {
  const type = document.getElementById('credType')?.value;
  const fieldsMap = {
    aws: [
      { id: 'awsAccessKey', label: 'Access Key ID', placeholder: 'AKIAIOSFODNN7EXAMPLE' },
      { id: 'awsSecretKey', label: 'Secret Access Key', placeholder: '••••••••', type: 'password' },
      { id: 'awsRegion', label: 'Region', placeholder: 'us-east-1' },
    ],
    gcp: [
      { id: 'gcpProjectId', label: 'Project ID', placeholder: 'my-project-123' },
      { id: 'gcpServiceAccountEmail', label: 'Service Account Email', placeholder: 'sa@project.iam.gserviceaccount.com' },
      { id: 'gcpPrivateKey', label: 'Private Key JSON', placeholder: '{"type":"service_account",...}', type: 'password' },
    ],
    azure: [
      { id: 'azureTenantId', label: 'Tenant ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { id: 'azureClientId', label: 'Client ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { id: 'azureClientSecret', label: 'Client Secret', placeholder: '••••••••', type: 'password' },
      { id: 'azureSubscriptionId', label: 'Subscription ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
    ],
    github: [
      { id: 'githubToken', label: 'Personal Access Token', placeholder: 'ghp_xxxxxxxxxxxx', type: 'password' },
    ],
    slack: [
      { id: 'slackToken', label: 'Bot OAuth Token', placeholder: 'xoxb-xxxxxxxxxxxx', type: 'password' },
    ],
  };

  const fields = fieldsMap[type] || [];
  const container = document.getElementById('credFields');
  if (!container) return;

  container.innerHTML = fields.map(f => `
    <div class="form-group">
      <label class="form-label">${f.label}</label>
      <input type="${f.type || 'text'}" id="${f.id}" class="form-input" placeholder="${f.placeholder}" autocomplete="off">
    </div>
  `).join('');
};

window._submitCredential = async () => {
  const type = document.getElementById('credType')?.value;
  const name = document.getElementById('credName')?.value?.trim();

  if (!name) { showToast('❌ Credential name is required', 'error'); return; }

  // Collect field values by type
  const fieldIds = {
    aws: ['awsAccessKey', 'awsSecretKey', 'awsRegion'],
    gcp: ['gcpProjectId', 'gcpServiceAccountEmail', 'gcpPrivateKey'],
    azure: ['azureTenantId', 'azureClientId', 'azureClientSecret', 'azureSubscriptionId'],
    github: ['githubToken'],
    slack: ['slackToken'],
  };

  const credData = {};
  for (const fieldId of (fieldIds[type] || [])) {
    const val = document.getElementById(fieldId)?.value?.trim();
    if (val) credData[fieldId] = val;
  }

  if (!Object.keys(credData).length) {
    showToast('❌ Please fill in at least one field', 'error');
    return;
  }

  try {
    const btn = document.querySelector('.modal .wf-btn.primary');
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner-small"></div> Saving…'; }

    const res = await api.addCredential({ credential_type: type, credential_name: name, credentials: credData });

    document.getElementById('modal').classList.remove('active');
    if (res.n8n_synced) {
      showToast('✅ Credential saved & synchronized to n8n!', 'success');
    } else {
      showToast('⚠️ Saved locally, but n8n sync is pending: ' + (res.sync_error || 'check n8n'), 'warning');
    }
    credentialsView();
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
    const btn = document.querySelector('.modal .wf-btn.primary');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock"></i> Save Credential'; }
  }
};

window._syncCredential = async (id, btnEl) => {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<div class="spinner-small"></div> Syncing…';
  }
  try {
    const res = await api.syncCredential(id);
    if (res.n8n_synced) {
      showToast('✅ Credential synchronized to n8n!', 'success');
    } else {
      showToast('⚠️ Synchronization incomplete: check n8n connection', 'warning');
    }
    credentialsView();
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = '<i class="fas fa-sync-alt"></i> Retry Sync';
    }
  }
};

window._deleteCredential = async (id, name) => {
  if (!confirm(`Remove credential "${name}"? This cannot be undone.`)) return;
  try {
    await api.deleteCredential(id);
    showToast('🗑️ Credential removed and cleaned up from n8n', 'success');
    credentialsView();
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  }
};