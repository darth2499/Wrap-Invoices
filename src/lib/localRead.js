// The backup receipt reader, on this device: used only when the online reader can't be reached or is used up
// for the day. Text recognition (Tesseract) runs in the browser from files this site serves itself (public/ocr,
// copied at build time), so nothing leaves the device and nothing costs anything. It's slower and less exact than
// the online reader, so what it finds is marked to double-check.
import { findDates, guessOrder } from './dateText.js';
import { textDirection, turnedFile } from './scan.js';
import { findOrderNumber, findCard, findItems, isFinanced, fullTotal } from './receiptExtras.js';

let workerP = null;
function ocrWorker() {
  if (!workerP) {
    workerP = import('tesseract.js').then(async ({ createWorker }) => {
      const base = new URL('ocr/', document.baseURI).href;
      return createWorker('eng', 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: base,
        workerBlobURL: false, // load the worker from this site (keeps the security policy intact)
        gzip: true,
        cacheMethod: 'write', // keep the language file in the browser after the first time
      });
    }).catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

async function ocr(image) {
  const w = await ocrWorker();
  const { data } = await w.recognize(image);
  return { text: data.text || '', confidence: data.confidence || 0 };
}

/**
 * Text from a photo, turned the right way up: lines running down the page mean it's sideways (try both quarter
 * turns, keep the clearer one); a poor read of an upright-looking photo gets one more try upside down.
 */
export async function photoText(file) {
  const dir = await textDirection(file).catch(() => 'unknown');
  const tries = dir === 'vertical' ? [90, 270] : [0];
  let best = null;
  for (const t of tries) {
    const r = await ocr(t ? await turnedFile(file, t) : file);
    if (!best || r.confidence > best.confidence) best = { ...r, turn: t };
  }
  if (best.confidence < 45 && dir !== 'vertical') {
    const r = await ocr(await turnedFile(file, 180));
    if (r.confidence > best.confidence) best = { ...r, turn: 180 };
  }
  return best;
}

// ---------- reading the details out of receipt text ----------
const MONEY = /(?<![\d.,])-?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)[.,](\d{2})(?!\d)/g;
const amountsIn = (line) => [...line.replace(/(?<=\d)[oO]|[oO](?=\d)/g, '0').matchAll(MONEY)].map((m) => Number(`${m[1].replace(/,/g, '')}.${m[2]}`));
const CATEGORY = [
  [/park|garage|meter|parkmobile|spothero|lot\b|toll|fastrak/i, 'Parking & tolls'],
  [/shell|chevron|arco|exxon|mobil|valero|76\b|fuel|gas\b|gasoline|unleaded/i, 'Car & truck'],
  [/uber|lyft|taxi|airline|airways|united|delta|alaska|southwest|jetblue|amtrak|hotel|inn\b|marriott|hilton|hyatt|airbnb|bart|caltrain|baggage/i, 'Travel'],
  [/restaurant|cafe|café|coffee|starbucks|grill|kitchen|taco|pizza|burger|sushi|ramen|bar\b|cantina|diner|bistro|bakery|deli|server|gratuity|tip\b/i, 'Meals'],
  [/b\s?&\s?h|adorama|amazon|best buy|staples|office|home depot|lowe'?s|target|walmart|costco/i, 'Supplies'],
  [/rental|rent\b|lensrentals|sharegrid/i, 'Equipment rental'],
];

/** Vendor, date, total, tax, tip and a category, worked out from receipt text with simple rules. */
export function parseReceiptText(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const labelled = (re) => {
    const out = [];
    lines.forEach((l, i) => { if (re.test(l)) { const a = amountsIn(l); if (a.length) out.push({ i, amount: a[a.length - 1] }); } });
    return out;
  };
  const subtotal = labelled(/sub\s*-?\s*total/i).pop()?.amount ?? null;
  const tax = labelled(/\b(sales\s*)?tax\b|\bvat\b|\bgst\b|\bhst\b/i).pop()?.amount ?? null;
  const tipHit = labelled(/\btip\b|gratuity/i).pop() || null;
  const tip = tipHit?.amount ?? null;
  const totals = labelled(/(?<!sub\s?-?\s?)\b(grand\s*total|total|amount\s*(paid|charged|due)|balance\s*due|card\s*total|charged)\b/i)
    .filter((t) => !/sub\s*-?\s*total/i.test(lines[t.i]));
  const applied = labelled(/amount\s*applied|card\s*amount|payment\s*amount/i).pop()?.amount ?? null;
  let total = totals.length ? totals[totals.length - 1] : null;
  let totalPaid = total?.amount ?? null;
  if (totalPaid == null) { const all = lines.flatMap(amountsIn); totalPaid = all.length ? Math.max(...all) : null; }
  const bill = subtotal != null ? subtotal + (tax ?? 0) : totalPaid;
  if (applied != null && bill != null && applied < bill - 0.01 && !isFinanced(text)) totalPaid = applied + (tip ?? 0); // split check
  else if (tipHit && total && tipHit.i > total.i && totalPaid != null && !totals.some((t) => t.i > tipHit.i)) totalPaid += tip; // tip added after the total
  // Paid in installments: what you bought is the order's full total, not today's charge.
  const financed = isFinanced(text);
  if (financed) { const full = fullTotal(text); if (full) totalPaid = full; }
  if (totalPaid != null) totalPaid = Math.round(totalPaid * 100) / 100;

  // Date: the first date on the receipt (US order unless the receipt shows otherwise), never in the future.
  const order = guessOrder(lines, new Date().toISOString().slice(0, 10));
  const today = new Date().toISOString().slice(0, 10);
  let date = null;
  let datePrinted = null;
  for (const l of [...lines.filter((x) => /date|ordered|time/i.test(x)), ...lines]) {
    const f = findDates(l, today, order);
    const d = f?.dates[0];
    if (d && d <= today && d > '2000') { date = d; datePrinted = l.slice(f.start, f.end).trim().slice(0, 60); break; }
  }
  // Vendor: the first real name near the top (not "Welcome", an address, a phone number or a date).
  const vendor = lines.slice(0, 6).find((l) => /[a-z]{3}/i.test(l) && !/welcome|receipt|thank|invoice|order|^\d|^tel|phone|www\.|\.com|@|^\(?\d{3}\)?[\s.-]?\d{3}/i.test(l))?.replace(/[^\w\s&'.,-]/g, '').trim().replace(/(\s+\d{1,2})+$/, '').slice(0, 60) || null;
  const all = lines.join(' ');
  const category = (CATEGORY.find(([re]) => re.test(all)) || [null, 'Other'])[1];
  // Every labelled amount on the receipt ("Amount charged 46.59"), so learned rules can pick the right one next time.
  const labelOf = (l) => l.replace(MONEY, ' ').replace(/[$:*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  const totalLabel = total ? labelOf(lines[total.i]) : null;
  const card = findCard(text);
  const amounts = lines.flatMap((l) => {
    const a = amountsIn(l);
    const label = labelOf(l);
    return a.length && /[a-z]{2}/i.test(label) ? [{ label, amount: a[a.length - 1] }] : [];
  }).slice(0, 20);
  return {
    is_receipt: totalPaid != null, vendor, date, date_printed: datePrinted, total_paid: totalPaid, total_label: totalLabel, subtotal, tax, tip, currency: 'USD', amounts, category,
    confidence: 'low', check: 'unknown', reader: 'device', financed,
    order_number: findOrderNumber(text), card_brand: card.brand, card_last4: card.last4, items: findItems(text),
    reasoning: 'Read on this device. Double-check the total and date.',
  };
}

/** Reads a receipt on this device: a photo (with OCR) or a PDF's own text. */
export async function readOnDevice({ photo, pdfText }) {
  if (pdfText && pdfText.replace(/\s/g, '').length > 30) return { ...parseReceiptText(pdfText), turn: 0 };
  const { text, turn } = await photoText(photo);
  return { ...parseReceiptText(text), turn };
}
