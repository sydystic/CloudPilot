// public/views/dashboard.js - Notion-inspired dashboard with pagination, search, and sorting
import { api, escapeHtml, formatDate } from '../api.js';
import { showToast, setPageHeader, setTopActions, updateStats, updateStatsError } from '../ui.js';
import { runWithLivePanel } from './timeline.js';
import { renderOnboardingChecklist, isOnboarded } from '../onboarding.js';

let _allWorkflows = [];
let _filteredWorkflows = [];
let _searchQuery = '';
let _currentSort = 'recent'; // recent, name, date
let _currentStatus = 'all'; // all, active, inactive
const ITEMS_PER_PAGE = 12;
let _currentPage = 1;

// Track last-run timestamps for sorting (in-memory, resets on page reload)
const _lastRunAt = new Map();

export async function dashboardView() {
  // Set up top bar with search and actions
  setPageHeader('Dashboard', 'Manage and run your automation workflows');
  setTopActions(`
    <div class="search-wrapper">
      <i class="fas fa-search"></i>
      <input type="text" id="searchInput" placeholder="Search workflows…" />
    </div>
    <button class="btn-create" onclick="window.location.hash='/templates'">
      <i class="fas fa-plus"></i> New Workflow
    </button>
  `);

  // Ensure the app-level boot overlay is ALWAYS hidden when any view renders
  const overlay = document.getElementById('loadingOverlay');
  overlay?.classList.add('hidden');

  const grid = document.getElementById('workflowsGrid');
  // Inline spinner — does NOT use the full-screen overlay
  grid.innerHTML = `<div class="loading-card" style="grid-column:1/-1"><div class="spinner-small"></div><span>Loading workflows…</span></div>`;

  // Setup search handler
  setupSearch();

  try {
    const data = await api.getWorkflows();
    _allWorkflows = normalizeWorkflowData(data);
    _filteredWorkflows = [..._allWorkflows];
    updateStats(_allWorkflows);
    grid.innerHTML = ''; // clear spinner before rendering cards
    await renderDashboardContent();
  } catch (err) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon" style="background:rgba(239,68,68,0.08);color:#dc2626">
          <i class="fas fa-plug"></i>
        </div>
        <h3>Cannot reach n8n</h3>
        <p>${escapeHtml(err.message)}</p>
        <button class="btn-create" onclick="window.location.hash='/dashboard'">
          <i class="fas fa-sync-alt"></i> Retry
        </button>
      </div>`;
    updateStatsError();
  }

  // Deduplicate execution-complete event listener
  if (window._dashRefreshHandler) {
    window.removeEventListener('cloudpilot:execution-complete', window._dashRefreshHandler);
  }
  window._dashRefreshHandler = () => {
    api.getWorkflows()
      .then(data => {
        _allWorkflows = normalizeWorkflowData(data);
        updateStats(_allWorkflows);
      })
      .catch(() => {});
  };
  window.addEventListener('cloudpilot:execution-complete', window._dashRefreshHandler);
}

function normalizeWorkflowData(data) {
  // Handle both array format and object { data: [...], workflows: [...] }
  const workflows = data?.data || data?.workflows || data || [];
  return Array.isArray(workflows) ? workflows.map(wf => ({
    id: String(wf.id || wf.workflow_id || ''),
    name: wf.name || 'Unnamed Workflow',
    description: wf.description || '',
    nodes: Array.isArray(wf.nodes) ? wf.nodes : [],
    active: Boolean(wf.active ?? wf.isActive ?? false),
    createdAt: wf.createdAt || wf.created_at,
    updatedAt: wf.updatedAt || wf.updated_at,
    lastRunAt: _lastRunAt.get(String(wf.id || wf.workflow_id)) || null,
    error: null
  })) : [];
}

async function renderDashboardContent() {
  const grid = document.getElementById('workflowsGrid');
  // Always start fresh to prevent duplicate cards on re-render (e.g. pagination change)
  grid.innerHTML = '';

  // Onboarding checklist (only if not onboarded)
  if (!isOnboarded()) {
    const onboardingContainer = document.createElement('div');
    onboardingContainer.id = 'onboardingContainer';
    onboardingContainer.style.cssText = 'grid-column:1/-1';
    grid.appendChild(onboardingContainer);
    await renderOnboardingChecklist(onboardingContainer);
  }

  const paginated = getPaginatedItems(_filteredWorkflows);
  if (!paginated.items.length) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'empty-state';
    emptyEl.style.gridColumn = '1 / -1';
    emptyEl.innerHTML = `
      <div class="empty-state-icon">
        <i class="fas fa-cloud"></i>
      </div>
      <h3>No workflows found</h3>
      <p>${_searchQuery ? 'No workflows match your search.' : 'Import a template to get started with your first automation'}</p>
      ${_searchQuery ? '' : `<button class="btn-create" onclick="window.location.hash='/templates'">
        <i class="fas fa-boxes"></i> Browse Templates
      </button>`}
    `;
    grid.appendChild(emptyEl);
    return;
  }

  // Render cards
  paginated.items.forEach(wf => {
    const cardEl = document.createElement('div');
    cardEl.innerHTML = buildWorkflowCard(wf);
    grid.appendChild(cardEl.firstElementChild);
  });

  // Add pagination if needed
  if (paginated.totalPages > 1) {
    renderPagination(grid, paginated);
  }
}

function getPaginatedItems(items) {
  const startIndex = (_currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedItems = items.slice(startIndex, endIndex);
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  return { items: paginatedItems, totalPages, currentPage: _currentPage };
}

function renderPagination(grid, paginated) {
  const paginationContainer = document.createElement('div');
  paginationContainer.className = 'pagination';
  paginationContainer.style.gridColumn = '1 / -1';

  const buttons = [];
  for (let i = 1; i <= paginated.totalPages; i++) {
    const btn = document.createElement('button');
    btn.className = 'pagination-btn' + (i === paginated.currentPage ? ' active' : '');
    btn.textContent = i;
    btn.addEventListener('click', () => {
      _currentPage = i;
      renderDashboardContent();
    });
    buttons.push(btn);
  }

  paginationContainer.appendChild(document.createElement('nav')).append(...buttons);
  grid.appendChild(paginationContainer);
}

// Sort: recently-run first, then by name
function getSortedItems() {
  return [..._filteredWorkflows].sort((a, b) => {
    if (_currentSort === 'name') {
      return (a.name || '').localeCompare(b.name || '');
    }
    if (_currentSort === 'date') {
      const aDate = new Date(a.updatedAt || a.createdAt || 0);
      const bDate = new Date(b.updatedAt || b.createdAt || 0);
      return bDate - aDate;
    }
    // 'recent' - recently run first
    const aRun = _lastRunAt.get(String(a.id)) || 0;
    const bRun = _lastRunAt.get(String(b.id)) || 0;
    if (aRun !== bRun) return bRun - aRun;
    const aDate = new Date(a.updatedAt || a.createdAt || 0);
    const bDate = new Date(b.updatedAt || b.createdAt || 0);
    return bDate - aDate;
  });
}


function buildWorkflowCard(wf) {
  const nodeCount = (wf.nodes || []).length;
  const id = escapeHtml(String(wf.id));
  const safeName = escapeHtml(wf.name).replace(/'/g, "\\'");
  const wasRecentlyRun = _lastRunAt.has(String(wf.id));

  return `
    <div class="wf-card${wasRecentlyRun ? ' wf-card--just-run' : ''}" id="wfcard-${id}">
      <div class="wf-header">
        <div class="wf-title-group">
          <h3 title="${escapeHtml(wf.name)}">${escapeHtml(wf.name)}</h3>
          <span class="wf-id">${id}</span>
        </div>
        <label class="toggle-switch" title="${wf.active ? 'Deactivate' : 'Activate'} workflow">
          <input type="checkbox" ${wf.active ? 'checked' : ''}
            onchange="window._toggleWorkflow('${id}', this.checked, '${safeName}', this)">
          <span class="toggle-slider"></span>
        </label>
      </div>

      ${wf.description ? `<p class="wf-description">${escapeHtml(wf.description)}</p>` : ''}

      <div class="wf-meta">
        <div class="meta-item">
          <i class="fas fa-clock"></i>
          <span>Updated ${formatDate(wf.updatedAt)}</span>
        </div>
        <div class="meta-item">
          <i class="fas fa-cubes"></i>
          <span>${nodeCount} node${nodeCount !== 1 ? 's' : ''}</span>
        </div>
        ${wasRecentlyRun ? `
        <div class="meta-item" style="color:var(--color-primary)">
          <i class="fas fa-bolt" style="opacity:1"></i>
          <span style="font-weight:600">Just run</span>
        </div>` : ''}
      </div>

      <div class="wf-status-row">
        <span class="status-badge ${wf.active ? 'active' : 'inactive'}">
          <span class="status-dot"></span>
          ${wf.active ? 'Active' : 'Inactive'}
        </span>
        <span class="wf-node-pill">${nodeCount} node${nodeCount !== 1 ? 's' : ''}</span>
      </div>

      <div class="wf-actions">
        <button class="wf-btn primary" id="runbtn-${id}"
          onclick="window._runWorkflow('${id}', '${safeName}', ${wf.active ? 'true' : 'false'}, this)">
          <i class="fas fa-play"></i> Run
        </button>
        <button class="wf-btn secondary"
          onclick="window.location.hash='/executions/${id}'">
          <i class="fas fa-history"></i> History
        </button>
        <button class="wf-btn danger" title="Delete workflow"
          onclick="window._deleteWorkflow('${id}', '${safeName}')">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>`;
}

function setupSearch() {
  window._dashboardSearch = (query) => {
    _searchQuery = query.trim().toLowerCase();
    _currentPage = 1;

    const q = _searchQuery;
    if (q) {
      _filteredWorkflows = _allWorkflows.filter(wf =>
        (wf.name || '').toLowerCase().includes(q) ||
        (wf.description || '').toLowerCase().includes(q) ||
        String(wf.id).toLowerCase().includes(q)
      );
    } else {
      _filteredWorkflows = [..._allWorkflows];
    }
    renderDashboardContent();
  };
}

// ─────────────────────────────────────────────
// Run workflow — check active state first
// ─────────────────────────────────────────────
window._runWorkflow = async (id, name, isActive, btnEl) => {
  // Guard: must be active to run
  if (isActive === false || isActive === 'false') {
    showToast('Activate this workflow before running it', 'warning');
    return;
  }

  const card = document.getElementById(`wfcard-${id}`);
  if (!card) return;

  showToast(`Starting "${name}"…`, 'info', 2000);

  // Look up the full workflow object so timeline can derive a command from its name
  const wf = _allWorkflows.find(w => String(w.id) === String(id)) || null;

  try {
    await runWithLivePanel(id, name, card, wf);
    // Move this card to the top by recording run time
    _lastRunAt.set(String(id), Date.now());
    // Re-sort cards without full reload
    _promoteCard(id);
    window.dispatchEvent(new CustomEvent('cloudpilot:execution-complete'));
  } catch (_) {
    // runWithLivePanel handles its own error display
  }
};

// Move the just-run card to the top of the grid visually
function _promoteCard(id) {
  const grid = document.getElementById('workflowsGrid');
  const card = document.getElementById(`wfcard-${id}`);
  if (!grid || !card) return;

  // Add highlight class
  card.classList.add('wf-card--just-run');

  // Move after the onboarding container (first non-card child)
  const anchor = grid.querySelector('#onboardingContainer') || grid.firstElementChild;
  if (anchor && anchor !== card && anchor.nextSibling !== card) {
    grid.insertBefore(card, anchor.nextSibling);
  }

  // Refresh after animations complete
  setTimeout(() => {
    _currentPage = 1;
    renderDashboardContent();
  }, 300);
}

// ─────────────────────────────────────────────
// Toggle
// ─────────────────────────────────────────────
window._toggleWorkflow = async (id, active, name, checkboxEl) => {
  const card = document.getElementById(`wfcard-${id}`);
  const badge = card?.querySelector('.status-badge');
  if (badge) {
    badge.className = `status-badge ${active ? 'active' : 'inactive'}`;
    badge.innerHTML = `<span class="status-dot"></span>${active ? 'Active' : 'Inactive'}`;
  }

  // Update the run button's isActive arg
  const runBtn = document.getElementById(`runbtn-${id}`);
  if (runBtn) {
    runBtn.setAttribute('onclick',
      `window._runWorkflow('${id}', '${name}', ${active}, this)`);
  }

  try {
    await api.toggleWorkflow(id, active);
    const wf = _allWorkflows.find(w => String(w.id) === String(id));
    if (wf) wf.active = active;
    updateStats(_allWorkflows);
    showToast(`${active ? 'Activated' : 'Deactivated'}: ${name}`, active ? 'success' : 'info');
  } catch (err) {
    if (checkboxEl) checkboxEl.checked = !active;
    if (badge) {
      badge.className = `status-badge ${!active ? 'active' : 'inactive'}`;
      badge.innerHTML = `<span class="status-dot"></span>${!active ? 'Active' : 'Inactive'}`;
    }
    showToast(err.message, 'error');
  }
};

// ─────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────
window._deleteWorkflow = async (id, name) => {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    await api.deleteWorkflow(id);
    _allWorkflows = _allWorkflows.filter(w => String(w.id) !== String(id));
    _lastRunAt.delete(String(id));
    const card = document.getElementById(`wfcard-${id}`);
    if (card) {
      card.style.transition = 'opacity 0.2s, transform 0.2s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.97)';
      setTimeout(() => {
        card.remove();
        _currentPage = 1;
        renderDashboardContent();
        updateStats(_allWorkflows);
      }, 220);
    }
    showToast(`"${name}" deleted`, 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
};