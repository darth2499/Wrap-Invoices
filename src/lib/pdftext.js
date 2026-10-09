// Reads PDFs in the browser (pdf.js): pulls out the text, or draws page 1 as a picture.
// Loaded only when a PDF is added, so it doesn't slow down the rest of the app.
let lib = null;
async function pdfjs() {
  if (!lib) {
    const [mod, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.js?url')]);
    mod.GlobalWorkerOptions.workerSrc = worker.default;
    lib = mod;
  }
  return lib;
}

async function open(file) {
  const { getDocument } = await pdfjs();
  return getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

/** All text in the PDF, rebuilt line by line (items on the same row joined left to right). */
export async function pdfText(file, maxPages = 12) {
  const doc = await open(file);
  const pages = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    const rows = new Map();
    for (const it of items) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map((t) => t.s).join('  '));
    pages.push(lines.join('\n'));
  }
  return pages.join('\n\n--- page break ---\n\n').trim();
}

/** Every page (up to `max`) as a picture, for showing a PDF inside the app. Returns object URLs. */
export async function pdfPages(file, { max = 10, width = 1100 } = {}) {
  const doc = await open(file);
  const out = [];
  for (let n = 1; n <= Math.min(doc.numPages, max); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, width / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(URL.createObjectURL(await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85))));
  }
  return { pages: out, total: doc.numPages };
}

/** Page 1 as a JPEG (for PDFs that are just a scanned picture). */
export async function pdfFirstPageImage(file, maxSide = 1600) {
  const doc = await open(file);
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, maxSide / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
}

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
