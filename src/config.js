// Settings come from the build (GitHub Actions variables) — see SETUP.md.
// With no Supabase settings the app runs in DEMO mode: data stays in this browser only.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Wrap';
export const DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;
