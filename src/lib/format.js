// Money and date helpers. Dates are stored as 'YYYY-MM-DD' strings (no time zones to trip over).

export const round2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON * 100) / 100;

export function money(n, { cents = true, sign = false } = {}) {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return (v < 0 ? '−$' : sign && v > 0 ? '+$' : '$') + s;
}

export const moneyK = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return '$' + (v / 1000).toFixed(Math.abs(v) >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return '$' + Math.round(v);
};

export const num = (v) => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const pad = (n) => String(n).padStart(2, '0');

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(iso, days) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function daysBetween(fromISO, toISOs) {
  return Math.round((parseISO(toISOs) - parseISO(fromISO)) / 86400000);
}

export function fmtDate(iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const d = parseISO(iso);
  return d ? d.toLocaleDateString('en-US', opts) : '';
}

export const fmtShort = (iso) => fmtDate(iso, { month: 'short', day: 'numeric' });
export const fmtLong = (iso) => fmtDate(iso, { month: 'long', day: 'numeric', year: 'numeric' });
export const mmdd = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : '');

/** Local calendar date of a timestamp, e.g. "Oct 7". */
export function fmtTsDate(ts, opts = { month: 'short', day: 'numeric' }) {
  return ts ? new Date(ts).toLocaleDateString('en-US', opts) : '';
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Groups dates into runs: ['2026-10-03','2026-10-04','2026-10-06'] → [['…03','…04'],['…06','…06']] */
export function dateRuns(dates) {
  const sorted = [...new Set(dates)].sort();
  const runs = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else runs.push([d, d]);
  }
  return runs;
}

/** "10/03-10/04, 10/06" — the style used on invoices. */
export const datesCode = (dates) =>
  dateRuns(dates).map(([a, b]) => (a === b ? mmdd(a) : `${mmdd(a)}-${mmdd(b)}`)).join(', ');

/** "Oct 3–4, 6" — compact label for the screen. */
export function datesLabel(dates) {
  const runs = dateRuns(dates);
  if (!runs.length) return '';
  let out = '';
  let lastMonth = '';
  runs.forEach(([a, b], i) => {
    const m = fmtDate(a, { month: 'short' });
    const da = parseISO(a).getDate();
    const db = parseISO(b).getDate();
    const mb = fmtDate(b, { month: 'short' });
    const head = m !== lastMonth ? `${m} ` : '';
    const part = a === b ? `${head}${da}` : mb !== m ? `${head}${da} – ${mb} ${db}` : `${head}${da}–${db}`;
    out += (i ? ', ' : '') + part;
    lastMonth = mb;
  });
  return out;
}

export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function slug(s) {
  return String(s || '').replace(/[^\w\- .$]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'file';
}
