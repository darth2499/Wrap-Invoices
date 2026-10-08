// Settings come from the build (GitHub Actions variables) — see SETUP.md.
// With no Supabase settings the app runs in DEMO mode: data stays in this browser only.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Wrap';
export const LIVE_CONFIGURED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
// "Try the demo" on the sign-in page: sample data in this browser only, never touches your real account.
const demoChosen = (() => { try { return localStorage.getItem('wrap_demo_mode') === '1'; } catch { return false; } })();
export const DEMO = !LIVE_CONFIGURED || demoChosen;
export function setDemoMode(on) {
  try { if (on) localStorage.setItem('wrap_demo_mode', '1'); else localStorage.removeItem('wrap_demo_mode'); } catch { /* private mode */ }
  window.location.hash = '#/';
  window.location.reload();
}
