import { copyFileSync } from 'node:fs';
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
    `connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co ${supa} ${supa.replace(/^https:/, 'wss:')} https://*.r2.cloudflarestorage.com https://photon.komoot.io`.replace(/\s+/g, ' ').trim(),
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

// Clean URLs (/reports, not /#/reports): GitHub Pages answers any unknown path with 404.html, so the build writes
// 404.html as a copy of the app. On a custom domain the site lives at "/"; on username.github.io/repo set VITE_BASE=/repo/.
const spaFallback = () => ({
  name: 'spa-404',
  apply: 'build',
  closeBundle() { copyFileSync('dist/index.html', 'dist/404.html'); },
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), securityHeaders(loadEnv(mode, process.cwd(), 'VITE_')), spaFallback()],
  base: loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE || '/',
  build: { chunkSizeWarningLimit: 12000 },
  // Keep the bundle pure ASCII (non-ASCII characters are written as \u escapes).
  esbuild: { charset: 'ascii' },
}));
