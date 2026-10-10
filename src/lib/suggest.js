// Suggests the receipts that most likely belong on an invoice (or on one line of it).
// Date is what matters most: a receipt from a shoot day, or the day before/after (travel), is a strong match.
// An exact amount match (a $500.55 hotel add-on ↔ a $500.55 receipt) is stronger still.
// Category and the client's name only help a receipt that's already close in date.
import { num } from './format.js';
import { datesFromCode } from './shoots.js';
import { findDates } from './dateText.js';

const CODE = /\((\d{2}\/\d{2}(?:-\d{2}\/\d{2})?(?:,\s*\d{2}\/\d{2}(?:-\d{2}\/\d{2})?)*)\)/;
const CAT_FOR_ITEM = [[/park|toll/i, 'Parking & tolls'], [/meal|lunch|dinner|food|craft|per diem/i, 'Meals'], [/travel|flight|hotel|uber|lyft|train|airfare|bag/i, 'Travel'], [/mileage|gas|fuel/i, 'Car & truck'], [/rental|gear/i, 'Equipment rental']];
const DAY = 86400000;
// Words on an invoice line that say nothing about which receipt goes with it.
const STOP = new Set(['the', 'and', 'for', 'with', 'day', 'days', 'rate', 'half', 'full', 'base', 'other', 'per', 'fee', 'fees', 'total', 'item', 'items', 'misc', 'service', 'services', 'work', 'hours', 'hrs']);
const dayDiff = (a, b) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / DAY);

export function suggestContext({ lines = [], jobs, issueDate, clientName }) {
  const dates = new Set();
  const amounts = new Set();
  const cats = new Set();
  const words = new Set();
  const addWords = (t) => String(t || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).forEach((w) => { if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) words.add(w); });
  for (const l of lines) {
    // Work dates written anywhere in the line (any format: 09/30, Sep 30, 2026-09-30 …), on every row.
    for (const t of [l.extras?.desc, l.description, l.note]) {
      for (const row of String(t || '').split('\n')) {
        const f = row && findDates(row, issueDate);
        if (f) f.dates.forEach((d) => dates.add(d));
      }
    }
    addWords(l.item);
    addWords(l.extras?.desc ?? l.description);
    for (const a of l.extras?.items || l.addons || []) addWords(a.label);
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
  return { dates: [...dates].sort(), amounts, cats, names, words, issueDate };
}

export function receiptScore(r, ctx) {
  if (!ctx || !r.receipt_date || r.invoice_id) return 0; // already on another invoice: never suggested
  const d = r.receipt_date;
  let near = Infinity;
  for (const x of ctx.dates) near = Math.min(near, dayDiff(x, d));
  // Shoot dates are the best clue; the invoice date is the next best (same day counts almost as much).
  const issue = ctx.issueDate ? dayDiff(ctx.issueDate, d) : Infinity;
  const fromShoot = near === 0 ? 10 : near === 1 ? 7 : near <= 3 ? 4 : 0;
  const fromIssue = issue === 0 ? 8 : issue === 1 ? 5 : issue <= 3 ? 3 : ctx.issueDate && d <= ctx.issueDate && issue <= 35 && !ctx.dates.length ? 2 : 0;
  const dateScore = Math.max(fromShoot, fromIssue);
  let s = dateScore;
  if (ctx.amounts.has(num(r.total).toFixed(2))) s += 8;
  // The receipt's vendor, notes or category names an item on the invoice ("Parking" ↔ "SFMTA Parking").
  const text = `${r.vendor || ''} ${r.notes || ''} ${r.category || ''}`.toLowerCase();
  const itemHit = [...(ctx.words || [])].some((w) => text.includes(w));
  if (itemHit) s += dateScore > 0 ? 6 : 2;
  if (dateScore > 0) {
    if (r.category && ctx.cats.has(r.category)) s += 3;
    if (ctx.names.some((w) => text.includes(w))) s += 2;
  }
  return s;
}

/** Splits receipts into likely matches and the rest, both newest first. */
export function rankReceipts(list, ctx) {
  const scored = list.map((r) => ({ r, s: receiptScore(r, ctx) }));
  // The best 8 matches, shown by date like the rest of the list.
  const top = scored.filter((x) => x.s >= 7).sort((a, b) => b.s - a.s).slice(0, 8)
    .sort((a, b) => String(b.r.receipt_date).localeCompare(String(a.r.receipt_date))).map((x) => x.r);
  const ids = new Set(top.map((r) => r.id));
  return { suggested: top, rest: list.filter((r) => !ids.has(r.id)) };
}

/**
 * For one receipt: the invoices it most likely belongs on, best first, with the reason.
 * The deciding clue is the date: a work day on the invoice that's the receipt's day (or the day before/after,
 * for travel), then the invoice's own date. A matching amount or item ("Parking") adds to it.
 * Returns [{ inv, score, why }] for the strong matches only (never a guess from the name alone).
 */
const ctxCache = new WeakMap(); // an invoice's clues, worked out once per version of its lines (typing stays fast)
export function rankInvoicesFor(receipt, invoices, { linesFor, clientName }) {
  if (!receipt?.receipt_date) return [];
  const out = [];
  for (const inv of invoices) {
    const lines = linesFor(inv.id);
    const key = `${inv.issue_date}|${clientName(inv) || ''}|${inv.updated_at || ''}`;
    let byKey = ctxCache.get(lines);
    if (!byKey) { byKey = new Map(); ctxCache.set(lines, byKey); }
    let ctx = byKey.get(key);
    if (!ctx) { ctx = suggestContext({ lines, jobs: inv.jobs, issueDate: inv.issue_date, clientName: clientName(inv) }); byKey.set(key, ctx); }
    const score = receiptScore({ ...receipt, invoice_id: null }, ctx);
    if (score < 7) continue;
    const d = receipt.receipt_date;
    let near = Infinity;
    for (const x of ctx.dates) near = Math.min(near, dayDiff(x, d));
    const why = near === 0 ? 'work that day' : near === 1 ? 'work the day before/after' : near <= 3 ? 'work that week'
      : inv.issue_date === d ? 'invoice dated that day' : ctx.amounts.has(num(receipt.total).toFixed(2)) ? 'same amount' : 'close match';
    // Date first: work on that very day beats everything, then the day before/after, then an invoice dated that day.
    const tier = near === 0 ? 0 : near === 1 ? 1 : inv.issue_date === d ? 2 : 3;
    out.push({ inv, score, near, tier, why });
  }
  return out.sort((a, b) => a.tier - b.tier || b.score - a.score || String(b.inv.issue_date).localeCompare(String(a.inv.issue_date))).slice(0, 5);
}
