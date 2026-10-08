import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Security: the built site only talks to your own Supabase project and your private file storage.
// A Content-Security-Policy blocks injected scripts and stops data being sent anywhere else.
function securityHeaders(env) {
  const supa = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com",
    `connect-src 'self' blob: data: https://*.supabase.co ${supa} https://*.r2.cloudflarestorage.com`.replace(/\s+/g, ' ').trim(),
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'security-headers',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="referrer" content="no-referrer" />`);
    },
  };
}

// base './' lets the site work on a custom domain or on username.github.io/repo.
export default defineConfig(({ mode }) => ({
  plugins: [react(), securityHeaders(loadEnv(mode, process.cwd(), 'VITE_'))],
  base: './',
  build: { chunkSizeWarningLimit: 12000 },
  // Keep the bundle pure ASCII (non-ASCII characters are written as \u escapes).
  esbuild: { charset: 'ascii' },
}));
