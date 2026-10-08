// Year-end income forecast from your own history.
// Method: last year's month-by-month shape × how much faster (or slower) you're earning this year,
// plus anything already invoiced for future months. Falls back to a simple monthly average.
import { num, todayISO } from './format.js';

/** Billed income per month for a year: [12 numbers]. Counts sent/paid invoices (not drafts/void/quotes). */
export function monthlyBilled(invoices, year) {
  const out = Array(12).fill(0);
  for (const i of invoices) {
    if (i.kind !== 'invoice' || ['draft', 'void'].includes(i.status) || !i.issue_date) continue;
    if (Number(i.issue_date.slice(0, 4)) !== year) continue;
    out[Number(i.issue_date.slice(5, 7)) - 1] += num(i.total);
  }
  return out;
}

export function forecastYear(invoices, today = todayISO()) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1; // current month index (partial)
  const cur = monthlyBilled(invoices, year);
  const prev = monthlyBilled(invoices, year - 1);
  const ytdDone = cur.slice(0, month).reduce((s, v) => s + v, 0); // full months only
  const ytdAll = cur.reduce((s, v) => s + v, 0);
  const prevSame = prev.slice(0, month).reduce((s, v) => s + v, 0);
  const prevTotal = prev.reduce((s, v) => s + v, 0);
  const remainingMonths = 12 - month;

  let method;
  let projected; // per-month forecast for months month..11
  if (prevTotal > 0 && prevSame > 0 && month >= 2) {
    method = 'seasonal';
    const growth = ytdDone / prevSame;
    projected = prev.slice(month).map((v) => v * growth);
  } else if (month >= 3 && ytdDone > 0) {
    method = 'average';
    const recent = cur.slice(Math.max(0, month - 6), month);
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
    projected = Array(remainingMonths).fill(avg);
  } else {
    return { enough: false, year, cur, prev, ytd: ytdAll };
  }
  // Never forecast less than what's already billed for those months.
  projected = projected.map((v, i) => Math.max(v, cur[month + i]));
  const mid = ytdDone + projected.reduce((s, v) => s + v, 0);
  // Uncertainty widens the further out we look.
  let low = ytdDone;
  let high = ytdDone;
  const cumLow = [];
  const cumHigh = [];
  const cumMid = [];
  let m = ytdDone;
  projected.forEach((v, i) => {
    const spread = Math.min(0.45, 0.12 + i * 0.05);
    low += Math.max(cur[month + i], v * (1 - spread));
    high += v * (1 + spread);
    m += v;
    cumLow.push(low);
    cumHigh.push(high);
    cumMid.push(m);
  });
  const growthPct = prevTotal > 0 ? (mid / prevTotal - 1) * 100 : null;
  return { enough: true, method, year, month, cur, prev, ytd: ytdAll, ytdDone, mid, low, high, cumLow, cumHigh, cumMid, growthPct, prevTotal };
}

/** Expenses per month for a year (receipts + crew payouts). */
export function monthlyExpenses(receipts, crewPayouts, year) {
  const out = Array(12).fill(0);
  const add = (date, amt) => {
    if (!date || Number(String(date).slice(0, 4)) !== year) return;
    out[Number(String(date).slice(5, 7)) - 1] += num(amt);
  };
  for (const r of receipts) add(r.receipt_date, r.total);
  for (const c of crewPayouts || []) add(c.paid_on, c.amount);
  return out;
}

/**
 * Year-end expenses: what's spent in finished months, then your average monthly spending
 * (last 12 finished months, so one big gear purchase doesn't swing it) for the rest of the year.
 */
export function forecastExpenses(receipts, crewPayouts, today = todayISO()) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const cur = monthlyExpenses(receipts, crewPayouts, year);
  const prev = monthlyExpenses(receipts, crewPayouts, year - 1);
  const last12 = [...prev.slice(month), ...cur.slice(0, month)];
  const months = last12.filter((_, i) => i >= 12 - month || prev.some((v) => v > 0)).length || 1;
  const perMonth = last12.reduce((s, v) => s + v, 0) / months;
  const done = cur.slice(0, month).reduce((s, v) => s + v, 0);
  const rest = cur.slice(month).map((v) => Math.max(v, perMonth));
  return { year, ytd: cur.reduce((s, v) => s + v, 0), done, perMonth, mid: done + rest.reduce((s, v) => s + v, 0) };
}
