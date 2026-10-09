// GENERATED from src/lib/pdf.js by scripts/sync-shared.mjs. Edit the original, not this copy.
// Builds the invoice/quote PDF in the browser (pdf-lib). Matches components/InvoiceDoc.jsx.
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { money, fmtLong, num, payMethod } from './format.js';
import { depositAmount } from './calc.js';

const W = 612;
const H = 792;
const M = 48;
const INK = rgb(0.086, 0.086, 0.102);
const GRAY = rgb(0.37, 0.38, 0.41);
const LINE = rgb(0.9, 0.9, 0.88);
const SHADE = rgb(0.957, 0.957, 0.945);

function hexToRgb(hex) {
  const h = String(hex || '#16161A').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Converts any image URL/blob to bytes pdf-lib can embed (PNG or JPEG). */
export async function imageBytes(src) {
  try {
    const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (buf[0] === 0x89 && buf[1] === 0x50) return { type: 'png', bytes: buf };
    if (buf[0] === 0xff && buf[1] === 0xd8) return { type: 'jpg', bytes: buf };
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const png = await new Promise((r) => c.toBlob(r, 'image/png'));
    return { type: 'png', bytes: new Uint8Array(await png.arrayBuffer()) };
  } catch {
    return null;
  }
}

/**
 * verify: { url, code } — when the PDF is made by the server, every page says where to check it's genuine.
 */
export async function buildInvoicePdf({ business = {}, invoice, client, lines, payments = [], logo, verify }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${invoice.kind === 'quote' ? 'Quote' : 'Invoice'} ${invoice.number}`);
  pdf.setAuthor(business.business_name || '');
  pdf.setCreator('Wrap');
  if (verify?.code) {
    pdf.setSubject(`Verification code ${verify.code}`);
    pdf.setKeywords([`verify:${verify.code}`]);
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const template = business.template || 'minimal';
  const accent = hexToRgb(business.accent);
  const isQuote = invoice.kind === 'quote';
  const label = isQuote ? 'Quote' : 'Invoice';

  // Characters the built-in font can't draw become "?" instead of crashing.
  const ok = new Map();
  const clean = (s) =>
    String(s ?? '')
      .split('\u2212').join('-')
      .replace(/\t/g, ' ')
      .split('')
      .map((ch) => {
        if (ch === '\n') return ch;
        if (!ok.has(ch)) {
          try { font.encodeText(ch); ok.set(ch, true); } catch { ok.set(ch, false); }
        }
        return ok.get(ch) ? ch : '?';
      })
      .join('');

  const width = (s, size, f = font) => f.widthOfTextAtSize(clean(s), size);
  function wrap(text, size, maxW, f = font) {
    const out = [];
    for (const para of clean(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const tryLine = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(tryLine, size) <= maxW) line = tryLine;
        else {
          if (line) out.push(line);
          line = word;
          while (f.widthOfTextAtSize(line, size) > maxW && line.length > 1) {
            let cut = line.length - 1;
            while (cut > 1 && f.widthOfTextAtSize(line.slice(0, cut), size) > maxW) cut--;
            out.push(line.slice(0, cut));
            line = line.slice(cut);
          }
        }
      }
      out.push(line);
    }
    return out;
  }

  let page;
  let y;
  const pages = [];
  const text = (s, x, yy, { size = 10, f = font, color = INK, align = 'left' } = {}) => {
    const t = clean(s);
    const xx = align === 'right' ? x - f.widthOfTextAtSize(t, size) : align === 'center' ? x - f.widthOfTextAtSize(t, size) / 2 : x;
    page.drawText(t, { x: xx, y: yy, size, font: f, color });
  };

  let logoImg = null;
  if (logo) {
    try {
      logoImg = logo.type === 'png' ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
    } catch {
      logoImg = null;
    }
  }

  // ---------- first page header ----------
  page = pdf.addPage([W, H]);
  pages.push(page);
  y = H - M;
  const isBold = template === 'bold';
  if (isBold) {
    // ----- "Bold" layout: big title right, company + contact columns, gray details band, open table -----
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: accent });
    text(isQuote ? 'Quote' : 'Invoice', W - M, y - 22, { size: 26, f: bold, color: INK, align: 'right' });
    let by = y - 8;
    if (logoImg) {
      const sc = Math.min(160 / logoImg.width, 60 / logoImg.height, 1);
      page.drawImage(logoImg, { x: M, y: by - logoImg.height * sc, width: logoImg.width * sc, height: logoImg.height * sc });
      by -= logoImg.height * sc + 16;
    } else by -= 34;
    let cy = by;
    text(business.business_name || '', M, cy, { size: 10.5, f: bold });
    cy -= 13;
    for (const l of String(business.address || '').split('\n').filter(Boolean)) { text(l, M, cy, { size: 9, color: GRAY }); cy -= 12; }
    let ky = by;
    const cx = M + 200;
    for (const [k, v] of [['Phone #', business.phone], ['Email', business.business_email], ['Website', business.website]].filter(([, v]) => v)) {
      text(k, cx, ky, { size: 9, f: bold });
      text(v, cx + bold.widthOfTextAtSize(k, 9) + 5, ky, { size: 9, color: GRAY });
      ky -= 12;
    }
    y = Math.min(cy, ky) - 20;
  }
  // Left: logo or name
  if (!isBold) {
  let leftBottom = y;
  if (logoImg) {
    const s = Math.min(170 / logoImg.width, 72 / logoImg.height, 1);
    const w = logoImg.width * s;
    const h = logoImg.height * s;
    page.drawImage(logoImg, { x: M, y: y - h, width: w, height: h });
    leftBottom = y - h;
  } else {
    text((business.business_name || '').toUpperCase(), M, y - 18, { size: 16, f: bold });
    leftBottom = y - 24;
  }
  // Right: title + business details
  let ry = y - 22;
  text(isQuote ? 'QUOTE' : 'INVOICE', W - M, ry, { size: 24, f: font, color: template === 'bold' ? accent : INK, align: 'right' });
  ry -= 18;
  if (logoImg && business.business_name) { text(business.business_name, W - M, ry, { size: 10, f: bold, align: 'right' }); ry -= 13; }
  for (const l of String(business.address || '').split('\n').filter(Boolean)) { text(l, W - M, ry, { size: 9.5, color: GRAY, align: 'right' }); ry -= 12.5; }
  for (const l of [business.phone, business.business_email, business.website].filter(Boolean)) { text(l, W - M, ry, { size: 9.5, color: GRAY, align: 'right' }); ry -= 12.5; }
  y = Math.min(leftBottom, ry) - 16;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: LINE });
  y -= 22;
  }

  // ---------- bill to + meta ----------
  const paid = payments.reduce((s, p) => s + num(p.amount), 0);
  const due = num(invoice.total) - paid;
  if (isBold) {
    const left = [];
    if (client) {
      left.push([client.name, true]);
      for (const l of [...String(client.address || '').split('\n'), client.email].filter(Boolean)) for (const w of wrap(l, 9, 210)) left.push([w]);
    }
    const det = [[`${label} #`, invoice.number], [isQuote ? 'Date' : 'Invoice date', fmtLong(invoice.issue_date)], ...(invoice.terms ? [['Terms', invoice.terms]] : []), ...(invoice.due_date ? [[isQuote ? 'Valid until' : 'Due date', fmtLong(invoice.due_date)]] : []), [isQuote ? 'Total' : 'Amount due', money(isQuote ? invoice.total : due)]];
    const bandH = 30 + Math.max(left.length, det.length) * 12;
    page.drawRectangle({ x: M, y: y - bandH + 12, width: W - 2 * M, height: bandH, color: SHADE });
    let ly2 = y - 4;
    text('Bill to', M + 12, ly2, { size: 9, f: bold });
    let dy = ly2;
    const dx = W - M - 190;
    text('Details', dx, dy, { size: 9, f: bold });
    ly2 -= 14; dy -= 14;
    for (const [t, b] of left) { text(t, M + 12, ly2, { size: 9, f: b ? bold : font, color: b ? INK : GRAY }); ly2 -= 12; }
    for (const [k, v] of det) { text(k, dx, dy, { size: 9, f: bold }); text(v, dx + 72, dy, { size: 9, color: GRAY }); dy -= 12; }
    y = y - bandH - 14;
  }
  let ly = y;
  if (!isBold) {
  text('BILL TO', M, ly, { size: 8, f: bold, color: GRAY });
  ly -= 14;
  if (client) {
    text(client.name, M, ly, { size: 10.5, f: bold });
    ly -= 13;
    for (const l of [...String(client.address || '').split('\n'), client.email].filter(Boolean)) {
      for (const w of wrap(l, 9.5, 230)) { text(w, M, ly, { size: 9.5, color: GRAY }); ly -= 12.5; }
    }
  }
  const meta = [
    [`${label} Number:`, invoice.number],
    [isQuote ? 'Date:' : 'Invoice Date:', fmtLong(invoice.issue_date)],
    ...(invoice.due_date ? [[isQuote ? 'Valid Until:' : 'Payment Due:', fmtLong(invoice.due_date)]] : []),
  ];
  let my = y;
  const colX = W - M - 110;
  for (const [k, v] of meta) {
    text(k, colX - 8, my, { size: 9.5, f: bold, align: 'right' });
    text(v, colX, my, { size: 9.5 });
    my -= 14;
  }
  page.drawRectangle({ x: colX - 150, y: my - 5, width: W - M - colX + 150 + 4, height: 18, color: SHADE });
  text(isQuote ? 'Total (USD):' : 'Amount Due (USD):', colX - 8, my, { size: 9.5, f: bold, align: 'right' });
  text(money(isQuote ? invoice.total : due), colX, my, { size: 9.5, f: bold });
  my -= 14;
  y = Math.min(ly, my) - 22;
  }

  // ---------- items table ----------
  const hasTax = lines.some((l) => num(l.tax_rate) > 0);
  const cols = isBold
    ? (hasTax
      ? { item: M + 8, itemW: 100, desc: M + 120, descW: 180, qty: 380, price: 440, tax: 495, amount: W - M - 8 }
      : { item: M + 8, itemW: 110, desc: M + 130, descW: 210, qty: 400, price: 470, amount: W - M - 8 })
    : hasTax
      ? { item: M + 12, itemW: 250, qty: 380, price: 450, tax: 505, amount: W - M - 12 }
      : { item: M + 12, itemW: 300, qty: 400, price: 482, amount: W - M - 12 };

  const tableHeader = () => {
    const h = 24;
    if (template === 'classic') page.drawRectangle({ x: M, y: y - h + 8, width: W - 2 * M, height: h, color: INK });
    const c = template === 'classic' ? rgb(1, 1, 1) : template === 'bold' ? INK : GRAY;
    const ty = y - 8;
    text(isBold ? 'Product / service' : 'Items', cols.item, ty, { size: 9, f: bold, color: c });
    if (isBold) text('Description', cols.desc, ty, { size: 9, f: bold, color: c });
    text(isBold ? 'Qty' : 'Quantity', cols.qty, ty, { size: 9, f: bold, color: c, align: 'right' });
    text(isBold ? 'Rate' : 'Price', cols.price, ty, { size: 9, f: bold, color: c, align: 'right' });
    if (hasTax) text('Tax', cols.tax, ty, { size: 9, f: bold, color: c, align: 'right' });
    text('Amount', cols.amount, ty, { size: 9, f: bold, color: c, align: 'right' });
    if (template === 'minimal') page.drawLine({ start: { x: M, y: y - h + 8 }, end: { x: W - M, y: y - h + 8 }, thickness: 1.2, color: INK });
    if (isBold) page.drawLine({ start: { x: M, y: y - h + 8 }, end: { x: W - M, y: y - h + 8 }, thickness: 0.8, color: LINE });
    y -= h + 6;
  };

  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    y = H - M;
    if (isBold) page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: accent });
    text(`${label.toUpperCase()} #${invoice.number}`, W - M, y - 10, { size: 10, f: bold, align: 'right' });
    text(business.business_name || '', M, y - 10, { size: 10, f: bold });
    y -= 36;
  };
  const BOTTOM = M + 30;

  tableHeader();
  for (const l of lines) {
    const desc = l.description ? wrap(l.description, 9, isBold ? cols.descW : cols.itemW) : [];
    const note = l.note ? wrap(l.note, 8.5, isBold ? cols.descW : cols.itemW) : [];
    const itemLines = isBold ? wrap(l.item, 9.5, cols.itemW) : [l.item];
    const h = isBold ? Math.max(itemLines.length * 12, (desc.length + note.length) * 11.5, 12) + 16 : 14 + desc.length * 11.5 + note.length * 11 + 10;
    if (y - h < BOTTOM) {
      newPage();
      tableHeader();
    }
    let iy = y;
    if (isBold) {
      let a = y;
      for (const t of itemLines) { text(t, cols.item, a, { size: 9.5 }); a -= 12; }
      let d = y;
      for (const t of [...desc, ...note]) { text(t, cols.desc, d, { size: 9, color: GRAY }); d -= 11.5; }
      text(Number(l.qty).toLocaleString('en-US', { maximumFractionDigits: 3 }), cols.qty, y, { size: 9.5, align: 'right' });
      text(money(l.rate), cols.price, y, { size: 9.5, align: 'right' });
      if (hasTax) text(num(l.tax_rate) ? `${num(l.tax_rate)}%` : '-', cols.tax, y, { size: 9.5, align: 'right' });
      text(money(l.amount), cols.amount, y, { size: 9.5, align: 'right' });
      y = Math.min(a, d) - 4;
      y -= 8;
      continue;
    }
    text(l.item, cols.item, iy, { size: 10, f: bold });
    text(Number(l.qty).toLocaleString('en-US', { maximumFractionDigits: 3 }), cols.qty, iy, { size: 10, align: 'right' });
    text(money(l.rate), cols.price, iy, { size: 10, align: 'right' });
    if (hasTax) text(num(l.tax_rate) ? `${num(l.tax_rate)}%` : '-', cols.tax, iy, { size: 10, align: 'right' });
    text(money(l.amount), cols.amount, iy, { size: 10, align: 'right' });
    iy -= 13;
    for (const d of desc) { text(d, cols.item, iy, { size: 9, color: GRAY }); iy -= 11.5; }
    if (note.length) iy -= 2;
    for (const d of note) { text(d, cols.item, iy, { size: 8.5, color: GRAY }); iy -= 11; }
    y = iy - 6;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.5, color: LINE });
    y -= 10;
  }

  // ---------- totals ----------
  let shownNotes = false;
  let notesBottom = null;
  const rows = [];
  if (num(invoice.discount_total) > 0 || num(invoice.tax_total) > 0) rows.push(['Subtotal:', money(invoice.subtotal)]);
  if (num(invoice.discount_total) > 0) rows.push(['Discount:', `-${money(invoice.discount_total)}`]);
  if (num(invoice.tax_total) > 0) rows.push(['Tax:', money(invoice.tax_total)]);
  rows.push(['Total:', money(invoice.total), true]);
  for (const p of payments) rows.push([`Payment on ${fmtLong(p.paid_on)}${payMethod(p.method) ? ` using ${payMethod(p.method).toLowerCase()}` : ''}:`, `-${money(p.amount)}`]);
  if (!isQuote) rows.push(['Amount Due (USD):', money(due), true, true]);
  const deposit = depositAmount(invoice);
  if (deposit > 0 && paid < deposit) rows.push([`Deposit due now (${num(invoice.deposit_percent)}%):`, money(deposit - paid), true]);
  if (y - rows.length * 20 < BOTTOM) newPage();
  if (isBold) {
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.8, color: LINE });
    y -= 12;
    const msg = [invoice.terms, invoice.notes].filter(Boolean).join('\n');
    if (msg) {
      let ny = y;
      text('Message', M, ny, { size: 9.5, f: bold });
      ny -= 13;
      for (const l of wrap(msg, 9, 230)) { text(l, M, ny, { size: 9, color: GRAY }); ny -= 11.5; }
      notesBottom = ny;
    }
    shownNotes = true;
  }
  y -= 4;
  for (const [k, v, strong, rule] of rows) {
    if (rule) {
      page.drawLine({ start: { x: W - M - 200, y: y + 13 }, end: { x: W - M, y: y + 13 }, thickness: 1, color: INK });
      y -= 4;
    }
    text(k, W - M - 110, y, { size: 10, f: strong ? bold : font, align: 'right' });
    text(v, W - M - 12, y, { size: 10, f: strong ? bold : font, align: 'right' });
    y -= 18;
  }
  if (notesBottom != null) y = Math.min(y, notesBottom - 6);
  y -= 10;

  // ---------- notes, payment instructions, footer ----------
  const block = (title, body) => {
    const ls = wrap(body, 9.5, W - 2 * M);
    if (y - (16 + ls.length * 12.5) < BOTTOM) newPage();
    text(title, M, y, { size: 10, f: bold });
    y -= 14;
    for (const l of ls) { text(l, M, y, { size: 9.5, color: GRAY }); y -= 12.5; }
    y -= 12;
  };
  const notes = [invoice.terms, invoice.notes].filter(Boolean).join('\n');
  if (notes && !shownNotes) block('Notes / Terms', notes);
  if (business.payment_instructions && !isQuote) block('How to pay', business.payment_instructions);
  if (business.footer_note) {
    if (y < BOTTOM + 14) newPage();
    text(business.footer_note, W / 2, y, { size: 9.5, color: GRAY, align: 'center' });
  }

  // Page numbers
  pages.forEach((p, i) => {
    page = p;
    text(`Page ${i + 1} of ${pages.length} for ${label} #${invoice.number}`, W / 2, M - 18, { size: 8, color: GRAY, align: 'center' });
    if (verify?.url) {
      const long = `Check this ${label.toLowerCase()} is genuine and current: ${verify.url}  \u00b7  Code ${verify.code}`;
      const line = width(long, 7) <= W - 2 * M ? long : `Verify: ${verify.url}  \u00b7  Code ${verify.code}`;
      text(line, W / 2, M - 30, { size: 7, color: GRAY, align: 'center' });
    }
  });
  return pdf.save();
}

export { pdfFileName } from './format.js';
