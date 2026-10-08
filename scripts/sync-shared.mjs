// Copies the invoice-PDF and email code from the app (src/lib) into the server functions, so the PDF a client
// downloads is made on the server from your saved data, and looks exactly like the one you download.
// Runs automatically in .github/workflows/deploy-backend.yml before the functions are uploaded.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = 'supabase/functions/_shared/web';
mkdirSync(out, { recursive: true });
for (const f of ['pdf.js', 'format.js', 'calc.js', 'emailTemplate.js']) {
  const src = readFileSync(`src/lib/${f}`, 'utf8')
    .replace(/from 'pdf-lib'/g, "from 'npm:pdf-lib@1.17.1'");
  writeFileSync(`${out}/${f}`, `// GENERATED from src/lib/${f} by scripts/sync-shared.mjs. Edit the original, not this copy.\n${src}`);
}
console.log('Synced shared files into', out);
