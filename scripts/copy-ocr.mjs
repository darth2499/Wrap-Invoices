// Copies the on-device receipt reader (Tesseract OCR) into public/ocr before each build, so the site serves it
// itself (no outside servers). Runs automatically with "npm run build" (see "prebuild" in package.json).
import { cpSync, mkdirSync, existsSync } from 'node:fs';

const out = 'public/ocr';
mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];
for (const [from, to] of files) {
  if (!existsSync(from)) { console.warn(`OCR file missing: ${from}`); continue; }
  cpSync(from, `${out}/${to}`);
}
console.log('On-device reader copied to public/ocr');
