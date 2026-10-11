// public/views/templates.js - Notion-inspired template marketplace with search and category filtering
import { api, escapeHtml } from '../api.js';
import { showModal, showToast, setPageHeader, setTopActions } from '../ui.js';

let _allTemplates = [];
let _currentCategory = 'all';

// Category colors (sticker palette - decorative)
const catColors = {
  'aws':       { color: '#dd5b00',      label: 'AWS' },
  'gcp':       { color: '#2a9d99',      label: 'GCP' },
  'azure':     { color: '#523410',      label: 'Azure' },
  'ai':        { color: '#62aef0',      label: 'AI' },
  'storage':   { color: '#2a9d99',      label: 'Storage' },
  'messaging': { color: '#1aae39',      label: 'Messaging' },
  'general':   { color: '#0075de',      label: 'General' },
  'default':   { color: '#0075de',      label: 'All' },
};

export async function templatesView() {
  setPageHeader('Template Marketplace', 'Pre-built automations ready for your cloud workflows');
  setTopActions(`
    <div class="table-controls">
      <div class="search-wrapper">
        <i class="fas fa-search"></i>
        <input type="text" id="searchInput" placeholder="Search templates…" />
      </div>
      <select id="categoryFilter" class="filter-select" onchange="window._filterTemplates(this.value)">
        <option value="all">All Categories</option>
        <option value="AWS">AWS</option>
        <option value="GCP">Google Cloud</option>
        <option value="Azure">Azure</option>
        <option value="AI">AI & ML</option>
        <option value="Storage">Storage</option>
        <option value="Messaging">Messaging</option>
      </select>
    </div>
  `);

  const grid = document.getElementById('workflowsGrid');
  grid.innerHTML = `<div class="loading-card"><div class="spinner-small"></div><span>Loading templates…</span></div>`;

  try {
    const templateData = await api.getTemplates();
    _allTemplates = normalizeTemplates(templateData);
    renderCategories();
    renderTemplates(_allTemplates);
    setupTemplateSearch();
  } catch (err) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon" style="background:rgba(239,68,68,0.08);color:#dc2626">
          <i class="fas fa-boxes"></i>
        </div>
        <h3>Failed to load templates</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

function normalizeTemplates(data) {
  const templates = data?.templates || [];
  return Array.isArray(templates) ? templates.map(t => ({
    id: t.template_id || t.id || '',
    name: t.name || 'Unnamed Template',
    description: t.description || 'No description provided',
    category: t.category || 'General',
    node_count: t.node_count || (t.template_json?.nodes?.length || (t.nodes?.length || 0)),
    tags: Array.isArray(t.tags) ? t.tags : [],
    required_credentials: Array.isArray(t.required_credentials) ? t.required_credentials : [],
    storage_path: t.storage_path || t.id,
  })) : [];
}

function getCatColor(category) {
  const key = (category || 'General').toLowerCase();
  const match = Object.keys(catColors).find(k =>
    key.includes(catColors[k].label.toLowerCase()) || key.includes(k)
  );
  const cat = catColors[match] || catColors['default'];
  return { color: cat.color, label: cat.label };
}

function renderCategories() {
  // Show category pills above the grid for quick filtering
  const categories = [...new Set(_allTemplates.map(t => t.category))];
  const controls = document.querySelector('.table-controls');
  if (controls && categories.length > 1) {
    const pills = document.createElement('div');
    pills.className = 'category-pills';
    pills.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;';
    pills.innerHTML = categories.map(cat => `
      <button class="category-pill ${cat === _currentCategory ? 'active' : ''}"
        onclick="window._setCategory('${escapeHtml(cat)}')"
        style="${cat === _currentCategory ? `background:${catColors[cat.toLowerCase()]?.color || '#0075de'}22; border-color:${catColors[cat.toLowerCase()]?.color || '#0075de'}; color:${catColors[cat.toLowerCase()]?.color || '#0075de'}` : ''}">
        ${escapeHtml(cat)}
      </button>
    `).join('');
    controls.appendChild(pills);
  }
}

function renderTemplates(templates) {
  const grid = document.getElementById('workflowsGrid');

  if (!templates.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon">
          <i class="fas fa-search"></i>
        </div>
        <h3>No templates found</h3>
        <p>${_allTemplates.length ? 'Try a different search or category.' : 'No workflow files found. Templates are loaded from the workflow-templates directory or the Supabase "workflow_templates" Storage bucket.'}</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = templates.map(t => {
    const cat = getCatColor(t.category);
    const catColor = cat.color;

    return `
      <div class="wf-card template-card">
        <div class="template-header">
          <div class="template-icon" style="background:${catColor}18;color:${catColor}">
            <i class="fas fa-bolt"></i>
          </div>
          <div style="flex:1;min-width:0">
            <h3>${escapeHtml(t.name)}</h3>
            <div class="template-category" style="color:${catColor}">${escapeHtml(t.category || 'General')}</div>
          </div>
        </div>

        <p class="template-desc">${escapeHtml(t.description)}</p>

        <div class="template-tags">
          ${(t.tags || []).slice(0, 3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
          ${t.node_count ? `<span class="tag"><i class="fas fa-cubes"></i> ${t.node_count} nodes</span>` : ''}
        </div>

        <button class="wf-btn primary" style="width:100%;margin-top:1rem"
          onclick="window._importTemplate('${escapeHtml(t.id)}')">
          <i class="fas fa-download"></i> Install Template
        </button>
      </div>
    `;
  }).join('');
}

function setupTemplateSearch() {
  window._templateSearch = (query) => {
    const q = query.toLowerCase();
    _currentCategory = 'all';
    if (!q) return renderTemplates(_allTemplates);
    renderTemplates(_allTemplates.filter(t =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.tags || []).some(tag => tag.toLowerCase().includes(q))
    ));
  };
}

window._setCategory = (cat) => {
  _currentCategory = cat;
  renderCategories();
  if (cat === 'all') {
    return renderTemplates(_allTemplates);
  }
  renderTemplates(_allTemplates.filter(t => t.category === cat));
};

// ─────────────────────────────────────────────
// Import modal
// ─────────────────────────────────────────────
const _templateMap = new Map();

window._importTemplate = async (templateId) => {
  const tmpl = _allTemplates.find(t => t.id === templateId);
  if (!tmpl) return;

  _templateMap.set(tmpl.id, { ...tmpl, creds: [] });

  showModal('Install Template', `
    <div class="import-form">
      <div class="import-template-name">${escapeHtml(tmpl.name)}</div>

      <div class="form-group">
        <label class="form-label">Workflow Name</label>
        <input type="text" id="importWfName" class="form-input"
          value="${escapeHtml(tmpl.name)}" placeholder="Custom workflow name…">
      </div>

      ${tmpl.required_credentials.length ? `
        <div class="cred-missing-warning">
          <i class="fas fa-exclamation-circle"></i>
          <span>This template requires credentials for: ${tmpl.required_credentials.map(c => c.toUpperCase()).join(', ')}. Add them in <strong>Credentials</strong> before installing.</span>
        </div>
      ` : ''}

      <div style="background:${getCatColor(tmpl.category).color}18;border-radius:var(--radius-md);padding:10px 14px;margin-bottom:1rem;font-size:12px;color:var(--color-ink-secondary);line-height:1.5">
        <i class="fas fa-magic" style="color:${getCatColor(tmpl.category).color}"></i>
        <strong style="color:var(--color-ink)">Auto-setup:</strong>
        A <em>CloudPilot Trigger</em> webhook node will be injected so this workflow can run from CloudPilot immediately after install.
      </div>

      <button class="wf-btn primary" style="width:100%"
        onclick="window._doImport('${escapeHtml(tmpl.id)}')">
        <i class="fas fa-download"></i> Install &amp; Set Up
      </button>
    </div>
  `);
};

window._doImport = async (templateId) => {
  const tmpl = _templateMap.get(templateId);
  const name = document.getElementById('importWfName')?.value?.trim();
  const storagePath = tmpl?.storage_path || templateId;

  try {
    const btn = document.querySelector('.modal .wf-btn.primary');
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner-small"></div> Installing…'; }

    const result = await api.installFromStorage({
      storage_path: storagePath,
      workflow_name: name,
    });

    document.getElementById('modal').classList.remove('active');

    showToast(`"${result.workflow?.name || 'Workflow'}" installed successfully!`, 'success');
    setTimeout(() => { window.location.hash = '/dashboard'; }, 1000);
  } catch (err) {
    showToast('Install failed: ' + err.message, 'error');
    const btn = document.querySelector('.modal .wf-btn.primary');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Install &amp; Set Up'; }
  }
};