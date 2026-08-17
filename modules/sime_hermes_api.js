// modules/sime_hermes_api.js
// Minimal client to fetch hermes-campanhas metrics for the new panel.
// Only GET requests. For homologation/development you may set a bearer token in localStorage:
//   localStorage.setItem('SIME_HERMES_BEARER', 'Bearer <token>')
// This is strictly for local/dev testing. Do NOT store production secrets in the browser.

export async function getHermesMetrics() {
  // dev-only: read localStorage token if present (explicit dev flow)
  const devBearer = localStorage.getItem('SIME_HERMES_BEARER') || '';
  const headers = {};
  if (devBearer) headers['Authorization'] = devBearer;

  try {
    const resp = await fetch('/api/hermes-campanhas-metrics', { method: 'GET', headers });
    if (resp.status === 401) {
      return { ok: false, error: 'Unauthorized (missing HERMES secret). For dev: set SIME_HERMES_BEARER in localStorage.' };
    }
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({ error: 'unknown' }));
      return { ok: false, error: body.error || 'metrics fetch failed' };
    }
    const data = await resp.json();
    return data;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
