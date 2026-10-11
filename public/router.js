// public/router.js - Hash-based SPA router
const routes = {};

export function defineRoute(path, handler) {
  routes[path] = handler;
}

export function navigate(path) {
  window.location.hash = path;
}

export function getCurrentRoute() {
  return window.location.hash.slice(1) || '/dashboard';
}

export function initRouter() {
  async function handleRoute() {
    const hash = window.location.hash.slice(1) || '/dashboard';

    // Extract base path and params
    // e.g. /workflow/abc-123 → { path: '/workflow', params: ['abc-123'] }
    const parts = hash.split('/').filter(Boolean);
    const base = '/' + (parts[0] || 'dashboard');
    const params = parts.slice(1);

    // Find matching route
    let handler = routes[base];

    // Fallback to /dashboard
    if (!handler) handler = routes['/dashboard'];

    if (handler) {
      // Always ensure the boot overlay is hidden before rendering any view
      document.getElementById('loadingOverlay')?.classList.add('hidden');
      try {
        await handler(params);
      } catch (err) {
        console.error('Route handler error:', err);
        showRouteError(err);
      }
    }
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute(); // Initial route
}

function showRouteError(err) {
  const grid = document.getElementById('workflowsGrid');
  if (grid) {
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Something went wrong</h3>
        <p>${err.message}</p>
      </div>
    `;
  }
}