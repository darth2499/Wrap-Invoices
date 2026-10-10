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

/** Payment method to show, hiding placeholders older imports saved (e.g. "Imported from Wave"). */
export function payMethod(m) {
  return m && !/^imported\b/i.test(String(m).trim()) ? m : null;
}

/** Time windows for long lists: 'all', '30d', '90d', '120d', '365d', or a year like '2025'. */
export function inPeriod(iso, period, today = todayISO()) {
  if (!period || period === 'all') return true;
  if (!iso) return false;
  if (/^\d{4}$/.test(period)) return iso.startsWith(period);
  const days = Number(period.replace('d', ''));
  return iso >= addDays(today, -days) && iso <= addDays(today, 3650);
}
export function periodOptions(dates) {
  const years = [...new Set(dates.filter(Boolean).map((d) => d.slice(0, 4)))].sort().reverse();
  return [
    { value: 'all', label: 'All time' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: '120d', label: 'Last 120 days' },
    { value: '365d', label: 'Last 12 months' },
    ...years.map((y) => ({ value: y, label: y })),
  ];
}

/** File name for an invoice/quote PDF, e.g. Invoice_149_2026-10-08.pdf */
export function pdfFileName(invoice) {
  const label = invoice.kind === 'quote' ? 'Quote' : 'Invoice';
  return `${label}_${String(invoice.number).replace(/[^\w-]/g, '')}_${invoice.issue_date || ''}.pdf`;
}

/**
 * Who an email greets: the contact's first name ("Hi Sam,"). In Japanese it's the family name + 様.
 * Falls back to the first word of the client name (older clients without a contact name), then "there".
 */
export function greetName(client, lang = 'en') {
  const first = String(client?.contact_first || '').trim();
  const last = String(client?.contact_last || '').trim();
  if (lang === 'ja') return last ? `${last}様` : first ? `${first}様` : 'ご担当者様';
  return first || String(client?.name || '').trim().split(/\s+/)[0] || 'there';
}

// ---------- how work dates show on invoices ----------
// Lines always store dates as "(MM/DD)" codes (everything that reads dates relies on that); the business's
// chosen style is applied only when the invoice is shown, drawn as a PDF or emailed.
export const DATE_STYLES = [
  { value: 'mmdd', example: '10/01 · 10/01-10/03', label: '10/01' },
  { value: 'mon_d', example: 'Oct 1 · Oct 1–3', label: 'Oct 1' },
  { value: 'mon_dd', example: 'Oct 01 · Oct 01–03', label: 'Oct 01' },
  { value: 'd_mon', example: '1 Oct · 1–3 Oct', label: '1 Oct' },
  { value: 'ddmm', example: '01/10 · 01/10-03/10', label: '01/10' },
  { value: 'iso', example: '2026-10-01', label: '2026-10-01' },
];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_CODE = /\((\d{2}\/\d{2}(?:-\d{2}\/\d{2})?(?:,\s*\d{2}\/\d{2}(?:-\d{2}\/\d{2})?)*)\)/g;

function styleRun(a, b, style, y) {
  const [am, ad] = a.split('/').map(Number);
  const [bm, bd] = b ? b.split('/').map(Number) : [];
  const p2 = (n) => String(n).padStart(2, '0');
  const one = (m, d, yr) => style === 'mon_d' ? `${MON3[m - 1]} ${d}` : style === 'mon_dd' ? `${MON3[m - 1]} ${p2(d)}`
    : style === 'd_mon' ? `${d} ${MON3[m - 1]}` : style === 'ddmm' ? `${p2(d)}/${p2(m)}` : style === 'iso' ? `${yr}-${p2(m)}-${p2(d)}` : `${p2(m)}/${p2(d)}`;
  const ya = am > y.m + 2 ? y.y - 1 : y.y; // late-year work on an early-year invoice
  if (!b) return one(am, ad, ya);
  const yb = bm < am ? ya + 1 : ya; // Dec 30 – Jan 2
  if (am === bm && style === 'mon_d') return `${MON3[am - 1]} ${ad}–${bd}`;
  if (am === bm && style === 'mon_dd') return `${MON3[am - 1]} ${p2(ad)}–${p2(bd)}`;
  if (am === bm && style === 'd_mon') return `${ad}–${bd} ${MON3[am - 1]}`;
  const dash = style === 'mmdd' || style === 'ddmm' ? '-' : style === 'iso' ? ' – ' : '–';
  return `${one(am, ad, ya)}${dash}${one(bm, bd, yb)}`;
}

/** A description with its "(MM/DD)" codes written in the chosen style (unchanged for the default). */
export function styleDates(text, style, issueISO) {
  if (!text || !style || style === 'mmdd') return text;
  const y = { y: Number(String(issueISO || '').slice(0, 4)) || new Date().getFullYear(), m: Number(String(issueISO || '').slice(5, 7)) || 12 };
  return String(text).replace(DATE_CODE, (_, inner) => `(${inner.split(/,\s*/).map((r) => { const [a, b] = r.split('-'); return styleRun(a, b, style, y); }).join(', ')})`);
}

export const styledLines = (lines, style, issueISO) =>
  !style || style === 'mmdd' ? lines : (lines || []).map((l) => (l.description ? { ...l, description: styleDates(l.description, style, issueISO) } : l));
