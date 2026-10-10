// Finds work dates written in a line's description, however they were typed:
//   09/30 · 9/30 · 09/30/2026 · 9/30/26 · 2026-09-30 · 2026/09/30
//   Sep 30 · Sept 30, 2026 · September 30th · 30 Sep 2026
//   ranges: 09/26-09/27 · 9/26 - 9/28 · 2026-09-30 to 2026-10-02 · Sep 28–30 · Sep 30 - Oct 2 · Dec 30 - Jan 2
//   lists:  09/26, 09/28 · Sep 28 & 30 · 10/05-10/07, 10/09
//   with or without brackets, and with "(2 Days)" / "2 days" after them.
// Returns the dates (YYYY-MM-DD) and where they sit in the text, or null.
//
// Day/month order: 09/10 is Sept 10 in the US but 9 Oct in most other countries. Month names and
// 2026-09-10 are never ambiguous. For numbers, `order` ('mdy' or 'dmy') decides; guessOrder() picks it per
// document from the dates themselves (a 25/09 can only be day-first), then from which reading puts the work
// near the invoice date, and only then from this device's language settings.

const MON = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const ORD = String.raw`(?:st|nd|rd|th)?`;
const PATTERNS = [
  { kind: 'iso', re: /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/iy, get: (m) => ({ y: +m[1], mo: +m[2], d: +m[3] }) },
  { kind: 'mon', re: new RegExp(String.raw`${MON}\s+(\d{1,2})${ORD}(?!\d)(?:,?\s+(\d{4})(?!\d))?`, 'iy'), get: (m) => ({ y: m[3] ? +m[3] : null, mo: monthOf(m[1]), d: +m[2] }) },
  { kind: 'dmon', re: new RegExp(String.raw`(\d{1,2})${ORD}\s+${MON}(?![a-z])(?:,?\s+(\d{4})(?!\d))?`, 'iy'), get: (m) => ({ y: m[3] ? +m[3] : null, mo: monthOf(m[2]), d: +m[1] }) },
  // 30.09.2026 / 30-09-2026 (always with a year: "30.09" alone could be a price)
  { kind: 'num', re: /(\d{1,2})[.-](\d{1,2})[.-](\d{4}|\d{2})(?![\d.])/y, get: (m) => ({ y: m[3].length === 2 ? 2000 + +m[3] : +m[3], a: +m[1], b: +m[2] }) },
  { kind: 'num', re: /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/y, get: (m) => ({ y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null, a: +m[1], b: +m[2] }) },
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function monthOf(s) { return MONTHS.indexOf(String(s).toLowerCase().slice(0, 3)) + 1; }

const RANGE = /\s*(?:-|–|—|~|\bto\b|\bthrough\b|\bthru\b|\buntil\b)\s*/iy;
const LIST = /\s*(?:,|;|&|\+|\band\b)\s*/iy;
const DAY_ONLY = new RegExp(String.raw`(\d{1,2})${ORD}(?![\d/:.]|\s*(?:am|pm|hr|hour|h\b|%|x\b))`, 'iy');
const DAYS_NOTE = /\s*\(?\s*\d+(?:\.\d+)?\s*(?:full\s+|half\s+|work\s+)?days?\s*\)?/iy;

const valid = ({ mo, d }) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
const pad = (n) => String(n).padStart(2, '0');

function at(re, s, i) {
  re.lastIndex = i;
  const m = re.exec(s);
  return m ? { m, end: re.lastIndex } : null;
}

/** One date starting exactly at position i. */
function dateAt(s, i, order = 'mdy') {
  for (const p of PATTERNS) {
    const r = at(p.re, s, i);
    if (!r) continue;
    let v = p.get(r.m);
    if (p.kind === 'num') {
      // "1/2" (a half) and the like aren't dates: numeric dates need a two-digit part or a year.
      if (!r.m[3] && r.m[1].length < 2 && r.m[2].length < 2) continue;
      v = order === 'dmy' ? { y: v.y, mo: v.b, d: v.a } : { y: v.y, mo: v.a, d: v.b };
    }
    if (valid(v)) return { ...v, kind: p.kind, end: r.end };
  }
  return null;
}

/** This device's usual order for numeric dates (US: month first; most other places: day first). */
export function localeOrder() {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric' }).formatToParts(new Date(2026, 10, 25));
    const types = parts.map((x) => x.type);
    return types.indexOf('day') < types.indexOf('month') ? 'dmy' : 'mdy';
  } catch {
    return 'mdy';
  }
}

const NUM_DATE = /(?<![\d$.,])(\d{1,2})([/.-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![\d.])/g;

/**
 * Day-first or month-first for one document (an invoice's descriptions, or a CSV's date column):
 *   1. a number over 12 settles it (25/09 → day first, 09/25 → month first)
 *   2. otherwise, the reading that puts the dates closest to (mostly just before) the invoice date
 *   3. otherwise, this device's settings
 */
export function guessOrder(texts, issueISO) {
  let dayFirst = 0;
  let monthFirst = 0;
  const pairs = [];
  for (const t of texts) {
    for (const m of String(t || '').matchAll(NUM_DATE)) {
      if (m[2] !== '/' && !m[4]) continue; // 30.09 / 10-12 without a year: not a date
      const a = +m[1];
      const b = +m[3];
      if (a < 1 || b < 1 || a > 31 || b > 31 || (a > 12 && b > 12)) continue;
      if (a > 12) dayFirst++;
      else if (b > 12) monthFirst++;
      pairs.push({ a, b, y: m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : null });
    }
  }
  if (dayFirst && !monthFirst) return 'dmy';
  if (monthFirst && !dayFirst) return 'mdy';
  if (issueISO && pairs.length) {
    const issue = Date.parse(`${issueISO}T00:00:00Z`);
    const score = (order) => pairs.reduce((t, p) => {
      const v = withYear(order === 'dmy' ? { y: p.y, mo: p.b, d: p.a } : { y: p.y, mo: p.a, d: p.b }, issueISO);
      if (!valid(v) || !realDate(v)) return t - 1;
      const days = (Date.UTC(v.y, v.mo - 1, v.d) - issue) / 86400000;
      return t + (days <= 14 && days >= -120 ? 1 : 0); // work usually happens in the months before the invoice
    }, 0);
    const md = score('mdy');
    const dm = score('dmy');
    if (md !== dm) return md > dm ? 'mdy' : 'dmy';
  }
  return localeOrder();
}

/** Year for a date written without one: the invoice's year, or the year before for late-year work on an early invoice. */
function withYear(v, issueISO) {
  if (v.y) return v;
  const y0 = Number(String(issueISO || '').slice(0, 4)) || new Date().getFullYear();
  const m0 = Number(String(issueISO || '').slice(5, 7)) || 12;
  return { ...v, y: v.mo > m0 + 2 ? y0 - 1 : y0 };
}

const iso = (v) => `${v.y}-${pad(v.mo)}-${pad(v.d)}`;
const realDate = (v) => { const t = new Date(Date.UTC(v.y, v.mo - 1, v.d)); return t.getUTCMonth() === v.mo - 1 && t.getUTCDate() === v.d; };

function expand(a, b) {
  const out = [];
  let t = Date.UTC(a.y, a.mo - 1, a.d);
  const end = Date.UTC(b.y, b.mo - 1, b.d);
  for (let k = 0; t <= end && k < 62; k++, t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function findDates(text, issueISO, order = 'mdy') {
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && /[\w$.\/-]/.test(s[i - 1]) && !/[(\s]/.test(s[i - 1])) continue; // inside a number or word
    const first = dateAt(s, i, order);
    if (!first) continue;
    const dates = [];
    let pos = first.end;
    let cur = withYear(first, issueISO);
    for (;;) {
      if (!realDate(cur)) break;
      let last = cur;
      // a range: "-", "to", "–" … then a full date or (for month names / numeric) just the day
      const r = at(RANGE, s, pos);
      if (r) {
        const full = dateAt(s, r.end, order);
        const dayOnly = !full && at(DAY_ONLY, s, r.end);
        if (full || dayOnly) {
          let end = full ? { ...full } : { y: cur.y, mo: cur.mo, d: +dayOnly.m[1], end: dayOnly.end };
          if (!end.y) end = { ...end, y: cur.y };
          if (iso(end) < iso(cur) && !full?.y) end = { ...end, y: end.y + 1 }; // Dec 30 – Jan 2
          if (realDate(end) && iso(end) >= iso(cur)) { last = end; pos = end.end; }
        }
      }
      dates.push(...expand(cur, last));
      // a list: ", 10/09" or "& 30"
      const l = at(LIST, s, pos);
      if (!l) break;
      const next = dateAt(s, l.end, order);
      const nextDay = !next && (first.kind === 'mon' || first.kind === 'dmon') && at(DAY_ONLY, s, l.end);
      if (next) { cur = withYear(next, issueISO); if (next.y == null && cur.y < last.y) cur = { ...cur, y: last.y }; pos = next.end; continue; }
      if (nextDay && !/^\d{4}/.test(s.slice(l.end))) { cur = { y: last.y, mo: last.mo, d: +nextDay.m[1] }; pos = nextDay.end; continue; }
      break;
    }
    if (!dates.length) continue;
    // swallow a "(2 Days)" note and brackets around the whole thing
    const note = at(DAYS_NOTE, s, pos);
    let end = note ? note.end : pos;
    let start = i;
    if (s[start - 1] === '(' && s[end] === ')') { start -= 1; end += 1; }
    const unique = [...new Set(dates)].sort();
    return { dates: unique, start, end };
  }
  return null;
}

/**
 * The first description row with dates, rewritten the way Wrap writes them: "Google (09/26-09/27)".
 * Returns { text, dates } or null when there are no dates.
 */
export function normalizeDates(text, issueISO, code, order = 'mdy') {
  const rows = String(text || '').split('\n');
  for (const [k, row] of rows.entries()) {
    const f = findDates(row, issueISO, order);
    if (!f) continue;
    const label = (row.slice(0, f.start) + ' ' + row.slice(f.end))
      .replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:,@|]+|[\s\-–—:,@|]+$/g, '').replace(/\s+(?:on|from)$/i, '').trim();
    rows[k] = label ? `${label} (${code(f.dates)})` : `(${code(f.dates)})`;
    return { text: rows.join('\n'), dates: f.dates };
  }
  return null;
}
