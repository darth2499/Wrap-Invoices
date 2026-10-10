// Client links load fast: the invoice is requested the moment the page starts (before React and the page's code
// have loaded), and the answer is picked up by the page when it's ready.
import { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO } from '../config.js';

/** Your sign-in on this browser, read straight from storage (no network, no refresh). */
export function storedAccessToken() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^sb-.+-auth-token$/.test(k)) return JSON.parse(localStorage.getItem(k))?.access_token || null;
    }
  } catch { /* private mode */ }
  return null;
}

let early = null;

/** Whose account is signed in on this browser (read from the stored sign-in, no network). */
function viewerId() {
  try { return JSON.parse(atob(storedAccessToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null; } catch { return null; }
}
const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const asJson = async (res) => {
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || out.message || `Request failed (${res.status})`), { status: res.status });
  return out;
};
const edge = (body) => fetch(`${SUPABASE_URL}/functions/v1/public`, { method: 'POST', headers, body: JSON.stringify(body) }).then(asJson);

/**
 * The client page in two parts, requested at the same time:
 *   page:  the invoice itself, straight from the database (fast, no server function to wake up)
 *   files: links for the logo and receipts + the verification code (from the server function)
 * Falls back to the server function for everything if the database call isn't set up yet (013 not run).
 */
export function publicRequest(token, preview) {
  const viewer = viewerId();
  const files = edge({ action: 'files', token }).catch(() => ({}));
  const page = fetch(`${SUPABASE_URL}/rest/v1/rpc/public_invoice`, {
    method: 'POST', headers, body: JSON.stringify({ p_token: token, p_viewer: viewer, p_preview: !!preview }),
  }).then(asJson).then((d) => {
    if (!d) throw Object.assign(new Error('Link not found'), { status: 404 });
    return d;
  }).catch((e) => {
    if (e.message === 'Link not found') throw e;
    return edge({ action: 'invoice', token, preview, viewer_token: storedAccessToken() || undefined }); // older setup
  });
  return { page, files };
}

/** Called first thing in main.jsx. */
export function startEarly() {
  const m = window.location.hash.match(/^#\/i\/([a-f0-9]{48,64})(\?.*)?$/);
  if (!m || DEMO || !SUPABASE_URL) return;
  const preview = /[?&]preview=1/.test(m[2] || '');
  early = { token: m[1], preview, req: publicRequest(m[1], preview) };
  early.req.page.catch(() => {}); // handled when the page picks it up
}

/** The early request for this link, if there is one (used once). */
export function takeEarly(token, preview) {
  if (!early || early.token !== token || early.preview !== preview) return null;
  const r = early.req;
  early = null;
  return r;
}
