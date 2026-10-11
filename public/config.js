// public/config.js - Safe browser-side configuration loader
// Fetches safe, public configuration from /api/config
// NEVER expose service role keys, encryption keys, or API keys here.

let _configCache = null;
let _configPromise = null;

/**
 * Fetches the safe public configuration from the server (/api/config)
 * @returns {Promise<{ supabase: { url: string, anonKey: string }, demoMode: boolean, version: string }>}
 */
export async function getConfig() {
  if (_configCache) return _configCache;

  if (!_configPromise) {
    _configPromise = fetch('/api/config')
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || errData.error || `Failed to load config (${res.status})`);
        }
        _configCache = await res.json();
        return _configCache;
      })
      .catch((err) => {
        _configPromise = null;
        throw err;
      });
  }

  return _configPromise;
}

export default getConfig;