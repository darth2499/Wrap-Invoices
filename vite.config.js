import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' lets the site work on a custom domain or on username.github.io/repo.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { chunkSizeWarningLimit: 12000 },
  // Keep the bundle pure ASCII (non-ASCII characters are written as \u escapes).
  esbuild: { charset: 'ascii' },
});
