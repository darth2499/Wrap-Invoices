// Suggests the receipts that most likely belong on an invoice (or on one line of it).
// Date is what matters most: a receipt from a shoot day, or the day before/after (travel), is a strong match.
// An exact amount match (a $500.55 hotel add-on ↔ a $500.55 receipt) is stronger still.
// Category and the client's name only help a receipt that's already close in date.
import { num } from './format.js';
import { datesFromCode } from './shoots.js';

const CODE = /\((\d{2}\/\d{2}(?:-\d{2}\/\d{2})?(?:,\s*\d{2}\/\d{2}(?:-\d{2}\/\d{2})?)*)\)/;
const CAT_FOR_ITEM = [[/park|toll/i, 'Parking & tolls'], [/meal|lunch|dinner|food|craft|per diem/i, 'Meals'], [/travel|flight|hotel|uber|lyft|train|airfare|bag/i, 'Travel'], [/mileage|gas|fuel/i, 'Car & truck'], [/rental|gear/i, 'Equipment rental']];
const DAY = 86400000;
const dayDiff = (a, b) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / DAY);

export function suggestContext({ lines = [], jobs, issueDate, clientName }) {
  const dates = new Set();
  const amounts = new Set();
  const cats = new Set();
  for (const l of lines) {
    if (Array.isArray(l.dates)) l.dates.forEach((d) => dates.add(d));
    const m = String(l.extras?.desc ?? l.description ?? '').match(CODE);
    if (m) datesFromCode(m[1], issueDate).forEach((d) => dates.add(d));
    const pieces = [{ label: `${l.item} ${l.description || ''}`, rate: l.extras ? l.extras.rate : l.rate }, ...(l.extras?.items || l.addons || [])];
    for (const p of pieces) {
      if (num(p.rate) > 0) amounts.add(num(p.rate).toFixed(2));
      for (const [re, cat] of CAT_FOR_ITEM) if (re.test(p.label || '')) cats.add(cat);
    }
  }
  for (const j of jobs?.jobs || []) {
    for (const d of j.days || []) if (d.date) dates.add(d.date);
    for (const e of j.expenses || []) { if (num(e.amount) > 0) amounts.add(num(e.amount).toFixed(2)); for (const [re, cat] of CAT_FOR_ITEM) if (re.test(e.type || '')) cats.add(cat); }
  }
  const names = String(clientName || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !['pictures', 'productions', 'studios', 'media', 'group', 'company'].includes(w));
  return { dates: [...dates].sort(), amounts, cats, names, issueDate };
}

export function receiptScore(r, ctx) {
  if (!ctx || !r.receipt_date || r.invoice_id) return 0; // already on another invoice: never suggested
  const d = r.receipt_date;
  let near = Infinity;
  for (const x of ctx.dates) near = Math.min(near, dayDiff(x, d));
  // No shoot dates picked yet: the 5 weeks before the invoice date is the best guess.
  const dateScore = ctx.dates.length
    ? near === 0 ? 10 : near === 1 ? 7 : near <= 3 ? 4 : 0
    : ctx.issueDate && d <= ctx.issueDate && dayDiff(ctx.issueDate, d) <= 35 ? 3 : 0;
  let s = dateScore;
  if (ctx.amounts.has(num(r.total).toFixed(2))) s += 8;
  if (dateScore > 0) {
    if (r.category && ctx.cats.has(r.category)) s += 3;
    const text = `${r.vendor || ''} ${r.notes || ''}`.toLowerCase();
    if (ctx.names.some((w) => text.includes(w))) s += 2;
  }
  return s;
}

/** Splits receipts into likely matches (best first) and the rest (newest first). */
export function rankReceipts(list, ctx) {
  const scored = list.map((r) => ({ r, s: receiptScore(r, ctx) }));
  const min = ctx?.dates.length ? 7 : 6;
  const top = scored.filter((x) => x.s >= min).sort((a, b) => b.s - a.s || String(b.r.receipt_date).localeCompare(String(a.r.receipt_date))).slice(0, 8).map((x) => x.r);
  const ids = new Set(top.map((r) => r.id));
  return { suggested: top, rest: list.filter((r) => !ids.has(r.id)) };
}
