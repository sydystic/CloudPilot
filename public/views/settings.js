// public/views/settings.js - Notion-inspired settings page
import { api, escapeHtml } from '../api.js';
import { showToast, setPageHeader, setTopActions } from '../ui.js';

export async function settingsView() {
  setPageHeader('Settings', 'Manage your account and connected services');
  setTopActions('');

  const grid = document.getElementById('workflowsGrid');
  const user = window._currentUser || {};
  const fullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';

  // Render layout immediately
  grid.innerHTML = `
    <div class="settings-wrap" style="grid-column:1/-1">

      <!-- LEFT COLUMN -->
      <div style="display:flex;flex-direction:column;gap:1.25rem">

        <!-- Profile card -->
        <div class="settings-card">
          <div class="settings-section-title"><i class="fas fa-user"></i> Profile</div>
          <div class="form-group">
            <label class="form-label">Full Name</label>
            <input type="text" id="settingsName" class="form-input"
              value="${escapeHtml(fullName)}" placeholder="Your name">
          </div>
          <div class="form-group">
            <label class="form-label">Email Address</label>
            <input type="email" class="form-input"
              value="${escapeHtml(user.email || '')}" disabled
              style="opacity:0.55;cursor:not-allowed;background:var(--bg-secondary)">
          </div>
          <div class="form-group">
            <label class="form-label">Member Since</label>
            <input type="text" class="form-input"
              value="${formatJoinDate(user.created_at)}" disabled
              style="opacity:0.55;cursor:not-allowed;background:var(--bg-secondary)">
          </div>
          <button class="wf-btn primary" style="width:100%"
            onclick="window._saveSettings()">
            <i class="fas fa-save"></i> Save Changes
          </button>
        </div>

        <!-- Danger Zone -->
        <div class="settings-card">
          <div class="settings-section-title" style="color:var(--accent)">
            <i class="fas fa-exclamation-triangle" style="color:var(--accent)"></i>
            Danger Zone
          </div>
          <div class="danger-zone">
            <div class="danger-zone-title">
              <i class="fas fa-sign-out-alt"></i> Sign Out
            </div>
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:0.875rem;line-height:1.5">
              You will be signed out of all sessions and redirected to the login page.
            </p>
            <button class="wf-btn danger" style="width:100%" onclick="window._logout()">
              <i class="fas fa-sign-out-alt"></i> Sign Out of CloudPilot
            </button>
          </div>
        </div>

      </div>

      <!-- RIGHT COLUMN -->
      <div style="display:flex;flex-direction:column;gap:1.25rem">

        <!-- Connected Services -->
        <div class="settings-card">
          <div class="settings-section-title"><i class="fas fa-plug"></i> Connected Services</div>

          <div class="settings-service-row">
            <div class="settings-service-info">
              <div class="service-icon n8n-icon"><i class="fas fa-cogs"></i></div>
              <div style="min-width:0">
                <div class="service-name">n8n Automation</div>
                <div class="service-url" id="n8nUrl">Checking…</div>
              </div>
            </div>
            <div id="n8nStatus">
              <span class="status-badge inactive"><span class="status-dot"></span>Checking…</span>
            </div>
          </div>

          <div class="settings-service-row">
            <div class="settings-service-info">
              <div class="service-icon supabase-icon"><i class="fas fa-database"></i></div>
              <div style="min-width:0">
                <div class="service-name">Supabase</div>
                <div class="service-url">Auth + Realtime DB</div>
              </div>
            </div>
            <span class="status-badge active"><span class="status-dot"></span>Connected</span>
          </div>
        </div>

        <!-- Account Stats -->
        <div class="settings-card">
          <div class="settings-section-title"><i class="fas fa-chart-bar"></i> Account Stats</div>
          <div class="settings-stat-row" id="settingsStats">
            <div class="settings-stat">
              <div class="settings-stat-val" id="statWorkflows">—</div>
              <div class="settings-stat-label">Workflows</div>
            </div>
            <div class="settings-stat">
              <div class="settings-stat-val" id="statActive">—</div>
              <div class="settings-stat-label">Active</div>
            </div>
            <div class="settings-stat">
              <div class="settings-stat-val" id="statCreds">—</div>
              <div class="settings-stat-label">Credentials</div>
            </div>
          </div>
        </div>

        <!-- Version Info -->
        <div class="settings-card">
          <div class="settings-section-title"><i class="fas fa-info-circle"></i> About</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)">
              <span style="color:var(--text-muted);font-weight:600">Version</span>
              <span style="font-family:var(--font-mono);color:var(--primary)">2.0.0</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)">
              <span style="color:var(--text-muted);font-weight:600">Build</span>
              <span style="font-family:var(--font-mono);color:var(--text-secondary)">CloudPilot v2</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0">
              <span style="color:var(--text-muted);font-weight:600">Environment</span>
              <span style="font-family:var(--font-mono);color:var(--text-secondary)" id="envBadge">—</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;

  // Load health + populate service status
  api.health().then(h => {
    const connected = h.services?.n8n === 'connected' || h.status === 'demo';
    const isDemo = h.status === 'demo';

    const statusEl = document.getElementById('n8nStatus');
    const urlEl = document.getElementById('n8nUrl');
    const envEl = document.getElementById('envBadge');

    if (statusEl) {
      statusEl.innerHTML = `<span class="status-badge ${connected ? 'active' : 'inactive'}">
        <span class="status-dot"></span>
        ${connected ? (isDemo ? 'Demo Mode' : 'Connected') : 'Disconnected'}
      </span>`;
    }
    if (urlEl) {
      urlEl.textContent = isDemo ? 'Demo (mocked)' : (h.n8n?.url || 'localhost:5678');
    }
    if (envEl) {
      envEl.textContent = isDemo ? 'Demo Mode' : 'Production';
      envEl.style.color = isDemo ? 'var(--warning)' : 'var(--success)';
    }
  }).catch(() => {
    const statusEl = document.getElementById('n8nStatus');
    if (statusEl) {
      statusEl.innerHTML = `<span class="status-badge inactive"><span class="status-dot"></span>Offline</span>`;
    }
  });

  // Load workflow + credential counts for stats
  Promise.all([
    api.getWorkflows().catch(() => null),
    api.getCredentials().catch(() => null),
  ]).then(([wfData, credData]) => {
    const workflows = wfData?.data || wfData?.workflows || [];
    const creds = credData?.credentials || [];
    const active = workflows.filter(w => w.active).length;

    const w = document.getElementById('statWorkflows');
    const a = document.getElementById('statActive');
    const c = document.getElementById('statCreds');

    if (w) w.textContent = workflows.length;
    if (a) a.textContent = active;
    if (c) c.textContent = creds.length;
  });
}

function formatJoinDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch { return 'N/A'; }
}

window._saveSettings = async () => {
  const name = document.getElementById('settingsName')?.value?.trim();
  if (!name) { return; }

  const supabase = window.supabase;
  if (supabase) {
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name }
      });
      if (error) throw error;
      if (window._currentUser) {
        window._currentUser.user_metadata = { ...window._currentUser.user_metadata, full_name: name };
      }
      // Update sidebar
      const nameEl = document.getElementById('userName');
      if (nameEl) nameEl.textContent = name;
      const avatarEl = document.getElementById('userAvatar');
      if (avatarEl) avatarEl.textContent = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    } catch (err) {
      showToast('❌ ' + err.message, 'error');
      return;
    }
  }
  showToast('✅ Profile updated!', 'success');
};