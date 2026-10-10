// File helpers: hashing, downloads, zips, CSV.
// jszip loads only when a zip is made or opened.
const loadZip = () => import('jszip').then((m) => m.default);

export async function sha256(blob) {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const extFor = (mime, fallback = 'bin') =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'image/heic': 'heic' }[mime] || fallback);

/** Wave-style name: 2026-10-06-McDonalds.jpg */
export function receiptFileName(r, ext) {
  const vendor = String(r.vendor || 'Receipt').normalize('NFKD').replace(/[\u0300-\u036f'’]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'Receipt';
  return `${r.receipt_date || 'undated'}-${vendor}.${ext}`;
}

/** File names for a set of receipts, with " (2)", " (3)"… added when two would share a name. Map: receipt → name. */
export function receiptNames(list) {
  const used = new Set();
  const out = new Map();
  for (const r of [...list].sort((a, b) => String(a.receipt_date || a.date || '').localeCompare(String(b.receipt_date || b.date || '')) || String(a.id || '').localeCompare(String(b.id || '')))) {
    let name = receiptFileName({ ...r, receipt_date: r.receipt_date || r.date }, extFor(r.mime, 'jpg'));
    if (r.work) name = name.replace(/(\.\w+)$/, ` - ${r.work}$1`);
    for (let i = 2; used.has(name.toLowerCase()); i++) name = name.replace(/( \(\d+\))?(\.\w+)$/, ` (${i})$2`);
    used.add(name.toLowerCase());
    out.set(r, name);
  }
  return out;
}

/**
 * Zip of the invoice PDF plus every attached receipt. receipts: [{ url, vendor, receipt_date|date, total, mime }]
 * A receipt that's an add-on under a line also gets that line's work name: "2026-10-06-McDonalds - Sound Mixer.jpg".
 */
export async function buildInvoiceZip(pdfBytes, pdfName, receipts, lines = []) {
  const zip = new (await loadZip())();
  zip.file(pdfName, pdfBytes);
  const work = {};
  for (const l of lines) {
    const name = String(l.item || l.extras?.desc || '').split('\n')[0].replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    for (const a of l.extras?.items || []) if (a.receipt_id && name) work[a.receipt_id] = name;
  }
  const withFiles = receipts.filter((r) => r.url).map((r) => (work[r.id] ? { ...r, work: work[r.id] } : r));
  const names = receiptNames(withFiles);
  const folder = withFiles.length ? zip.folder('Receipts') : null;
  for (const r of withFiles) folder.file(names.get(r), await (await fetch(r.url)).blob());
  return zip.generateAsync({ type: 'blob' });
}

export function toCSV(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.get])).join(','))].join('\n');
}

/** Parses CSV text (handles quotes, commas and newlines inside quotes). Returns array of objects keyed by header. */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!clean.length) return { headers: [], rows: [] };
  const headers = clean[0].map((h) => h.trim());
  return { headers, rows: clean.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

export function pickFiles({ accept = '*/*', multiple = false, capture } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture);
    input.style.display = 'none';
    input.onchange = () => {
      resolve([...(input.files || [])]);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}
