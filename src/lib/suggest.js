// Suggests the receipts that most likely belong on an invoice: same shoot days (or close), the invoice's period,
// and matching context (a Parking line ↔ parking receipts, the client or job name in the receipt).
import { addDays } from './format.js';
import { datesFromCode } from './shoots.js';

const CODE = /\((\d{2}\/\d{2}(?:-\d{2}\/\d{2})?(?:,\s*\d{2}\/\d{2}(?:-\d{2}\/\d{2})?)*)\)/;
const CAT_FOR_ITEM = [[/park|toll/i, 'Parking & tolls'], [/meal|lunch|dinner|food|craft/i, 'Meals'], [/travel|flight|hotel|uber|lyft|train|airfare/i, 'Travel'], [/mileage|gas|fuel/i, 'Car & truck'], [/rental|gear/i, 'Equipment rental']];

export function suggestContext({ lines = [], jobs, issueDate, clientName }) {
  const dates = new Set();
  for (const l of lines) {
    if (Array.isArray(l.dates)) l.dates.forEach((d) => dates.add(d));
    const m = String(l.description || '').match(CODE);
    if (m) datesFromCode(m[1], issueDate).forEach((d) => dates.add(d));
  }
  for (const j of jobs?.jobs || []) for (const d of j.days || []) if (d.date) dates.add(d.date);
  const sorted = [...dates].sort();
  const from = sorted.length ? addDays(sorted[0], -3) : issueDate ? addDays(issueDate, -35) : null;
  const to = sorted.length ? addDays(sorted[sorted.length - 1], 3) : issueDate || null;
  const cats = new Set();
  for (const l of lines) for (const [re, cat] of CAT_FOR_ITEM) if (re.test(`${l.item} ${l.description || ''}`)) cats.add(cat);
  const words = new Set(
    [clientName, ...lines.map((l) => String(l.description || '').replace(CODE, ''))]
      .join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3),
  );
  return { dates, from, to, cats, words };
}

export function receiptScore(r, ctx) {
  if (!ctx || !r.receipt_date) return 0;
  let s = 0;
  const d = r.receipt_date;
  if (ctx.dates.has(d)) s += 6;
  else if ([...ctx.dates].some((x) => Math.abs(new Date(x) - new Date(d)) <= 2 * 86400000)) s += 4;
  else if (ctx.from && d >= ctx.from && d <= ctx.to) s += 2;
  if (r.category && ctx.cats.has(r.category)) s += 2;
  const text = `${r.vendor || ''} ${r.notes || ''}`.toLowerCase();
  if ([...ctx.words].some((w) => text.includes(w))) s += 2;
  if (r.invoice_id) s -= 5; // already on another invoice
  return s;
}

/** Splits receipts into likely matches (best first) and the rest (newest first). */
export function rankReceipts(list, ctx) {
  const scored = list.map((r) => ({ r, s: receiptScore(r, ctx) }));
  const top = scored.filter((x) => x.s >= 4).sort((a, b) => b.s - a.s || String(b.r.receipt_date).localeCompare(String(a.r.receipt_date))).slice(0, 8).map((x) => x.r);
  const ids = new Set(top.map((r) => r.id));
  const rest = list.filter((r) => !ids.has(r.id));
  return { suggested: top, rest };
}
