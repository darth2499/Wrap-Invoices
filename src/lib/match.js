// Is this the same client (or payee) as one you already have? Compares name, email, phone, email domain and
// address and says how sure it is:
//   'same' — merge without asking (e.g. same email and a similar name)
//   'ask'  — probably the same, but something's off (same email, different name; very similar name, no contact overlap)
//   'no'   — different people
// Plain JS with no imports (also used on the server, copied by scripts/sync-shared.mjs).

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'comcast.net', 'att.net', 'sbcglobal.net', 'verizon.net']);
const SUFFIX = /\b(inc|incorporated|llc|l l c|ltd|limited|co|corp|corporation|company|plc|gmbh|pty|pc|pllc|lp|llp)\b/g;
const SWAP = [[/&/g, ' and '], [/\bbros\b/g, 'brothers'], [/\bbro\b/g, 'brother'], [/\bintl\b/g, 'international'], [/\bprod(s)?\b/g, 'productions'], [/\bmgmt\b/g, 'management'], [/\bent\b/g, 'entertainment'], [/\bsvcs?\b/g, 'services'], [/\bthe\b/g, ' ']];

export function normName(s) {
  let t = String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[.'’]/g, '').replace(/[^a-z0-9&]+/g, ' ');
  for (const [re, to] of SWAP) t = t.replace(re, to);
  return t.replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}
export const normEmail = (s) => String(s || '').trim().toLowerCase();
export function normPhone(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-10) : '';
}
const domainOf = (email) => { const d = normEmail(email).split('@')[1] || ''; return d && !FREE_MAIL.has(d) ? d : ''; };
const firstLine = (a) => String(a || '').split('\n')[0].toLowerCase().replace(/\b(street|st|avenue|ave|road|rd|boulevard|blvd|suite|ste|unit|#)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** 0–1: how alike two names are (word overlap, ignoring Inc/LLC/&/Bros spelling). */
export function nameSimilarity(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  if (x === y || x.replace(/ /g, '') === y.replace(/ /g, '')) return 1;
  const A = new Set(x.split(' '));
  const B = new Set(y.split(' '));
  const both = [...A].filter((w) => B.has(w)).length;
  const jac = both / new Set([...A, ...B]).size;
  // "Warner Bros" vs "Warner Bros Pictures": every word of the shorter one is in the longer one.
  const contained = both === Math.min(A.size, B.size) && Math.min(A.size, B.size) >= 1 && (Math.min(A.size, B.size) >= 2 || [...A, ...B].some((w) => w.length >= 4)) ? 0.8 : 0;
  return Math.max(jac, contained);
}

const emailsOf = (r) => [r.email, ...String(r.cc_emails || '').split(/[,;\s]+/)].map(normEmail).filter((e) => e.includes('@'));

/** How sure we are that a and b are the same: { level: 'same' | 'ask' | 'no', score, why: [] }. */
export function matchScore(a, b) {
  const why = [];
  const name = nameSimilarity(a.name, b.name);
  const ea = emailsOf(a);
  const eb = emailsOf(b);
  const emailSame = ea.some((e) => eb.includes(e));
  const pa = normPhone(a.phone);
  const pb = normPhone(b.phone);
  const phoneSame = !!pa && pa === pb;
  const da = new Set(ea.map(domainOf).filter(Boolean));
  const domainSame = eb.map(domainOf).some((d) => d && da.has(d));
  const la = firstLine(a.address);
  const lb = firstLine(b.address);
  const addressSame = la.length >= 6 && la === lb;
  // Clearly different contact details on both sides (not just one missing).
  const emailClash = ea.length && eb.length && !emailSame && !domainSame;
  const phoneClash = pa && pb && !phoneSame;
  if (emailSame) why.push('same email');
  if (phoneSame) why.push('same phone');
  if (domainSame && !emailSame) why.push('same company email domain');
  if (addressSame) why.push('same address');
  if (name === 1) why.push('same name'); else if (name >= 0.5) why.push('similar name');

  const score = Math.round((name * 0.45 + (emailSame ? 0.35 : domainSame ? 0.15 : 0) + (phoneSame ? 0.3 : 0) + (addressSame ? 0.15 : 0)) * 100) / 100;
  let level = 'no';
  if ((emailSame || phoneSame) && name >= 0.5) level = 'same';
  else if (emailSame && phoneSame) level = 'same';
  else if (name === 1 && !emailClash && !phoneClash) level = 'same';
  else if (emailSame || phoneSame) level = 'ask'; // same contact, different name: maybe a rename, maybe a shared inbox
  else if (name === 1) level = 'ask'; // same name, different contact details
  else if (name >= 0.75 && !(emailClash && phoneClash)) level = 'ask';
  else if ((domainSame || addressSame) && name >= 0.4) level = 'ask';
  return { level, score, why };
}

/** The best match for `rec` in `list` (skipping itself): { item, level, score, why } or null when nothing's close. */
export function findMatch(rec, list) {
  let best = null;
  for (const item of list || []) {
    if (!item || (rec.id && item.id === rec.id)) continue;
    const m = matchScore(rec, item);
    if (m.level === 'no') continue;
    const rank = (m.level === 'same' ? 10 : 0) + m.score;
    if (!best || rank > best.rank) best = { item, ...m, rank };
  }
  return best;
}

/** Pairs in one list that look like the same person: [{ a, b, level, score, why }], surest first. */
export function findDuplicates(list, { skip = new Set() } = {}) {
  const out = [];
  const rows = (list || []).filter(Boolean);
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (skip.has(pairKey(rows[i], rows[j]))) continue;
      const m = matchScore(rows[i], rows[j]);
      if (m.level !== 'no') out.push({ a: rows[i], b: rows[j], ...m });
    }
  }
  return out.sort((x, y) => (y.level === 'same') - (x.level === 'same') || y.score - x.score);
}
export const pairKey = (a, b) => [a.id, b.id].sort().join('|');
