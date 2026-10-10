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

export function publicRequest(token, preview) {
  return fetch(`${SUPABASE_URL}/functions/v1/public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ action: 'invoice', token, preview, viewer_token: storedAccessToken() || undefined }),
  }).then(async (res) => {
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
    return out;
  });
}

/** Called first thing in main.jsx. */
export function startEarly() {
  const m = window.location.hash.match(/^#\/i\/([a-f0-9]{48,64})(\?.*)?$/);
  if (!m || DEMO || !SUPABASE_URL) return;
  const preview = /[?&]preview=1/.test(m[2] || '');
  early = { token: m[1], preview, promise: publicRequest(m[1], preview) };
  early.promise.catch(() => {}); // handled when the page picks it up
}

/** The early request for this link, if there is one (used once). */
export function takeEarly(token, preview) {
  if (!early || early.token !== token || early.preview !== preview) return null;
  const p = early.promise;
  early = null;
  return p;
}
