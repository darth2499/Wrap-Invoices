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

const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

/** The client page, from the server function (visitors never touch the database directly). */
export function publicRequest(token, preview) {
  return fetch(`${SUPABASE_URL}/functions/v1/public`, {
    method: 'POST', headers,
    // Your sign-in on this browser (if any) goes along, so your own visits don't count as the client's.
    body: JSON.stringify({ action: 'invoice', token, preview: !!preview, viewer_token: storedAccessToken() || undefined }),
  }).then(async (res) => {
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(out.error || `Request failed (${res.status})`), { status: res.status });
    return out;
  });
}

/** Called first thing in main.jsx. */
/**
 * The link's code from the address, even if something was stuck on the end when it was pasted or tapped
 * ("…a1b2).", "…a1b2%20", a line break, a tracking parameter).
 */
export function linkToken(raw) {
  return (String(raw || '').match(/[a-f0-9]{48,64}/i)?.[0] || '').toLowerCase();
}

export function startEarly() {
  const m = window.location.hash.match(/^#\/i\/(.*)$/);
  const token = m && linkToken(m[1]);
  if (!token || DEMO || !SUPABASE_URL) return;
  const preview = /[?&]preview=1/.test(m[1]);
  early = { token, preview, req: publicRequest(token, preview) };
  early.req.catch(() => {}); // handled when the page picks it up
}

/** The early request for this link, if there is one (used once). */
export function takeEarly(token, preview) {
  if (!early || early.token !== token || early.preview !== preview) return null;
  const r = early.req;
  early = null;
  return r;
}
