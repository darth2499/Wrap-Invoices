// More from a receipt's text: the order number, the card it was paid with (brand + last 4 digits only), and what
// was bought. Works on a PDF's text (pulled out in the browser) and on text read from a photo. Also used to check
// what the online reader returned: for PDFs, a value has to actually be printed in the PDF to be kept.
// Plain JS, no imports.

const MONEY_RE = /(?<![\w.])[-–(]?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)[.,]\d{2}\)?(?![\d%])/g;
const hasMoney = (s) => new RegExp(MONEY_RE.source).test(s);
const moneyIn = (s) => [...String(s).matchAll(new RegExp(MONEY_RE.source, 'g'))].map((m) => Number(m[0].replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.').replace(/^-/, '')));
// (Receipt lines are short: very long lines and huge texts are cut, so nothing here can get slow.)
const linesOf = (text) => String(text || '').slice(0, 200000).replace(/\r/g, '').split('\n').slice(0, 4000).map((l) => l.slice(0, 300).replace(/\s+$/, ''));
// Text read from photos mixes up 0/O and 1/I inside words ("T0TAL", "V1SA"): used only for recognising labels.
const ocrFix = (s) => String(s).replace(/(?<=[A-Za-z])0|0(?=[A-Za-z]{2})/g, 'O').replace(/(?<=[A-Za-z])1(?=[A-Za-z])|(?<=\b)1(?=[A-Za-z]{3})/g, 'I');
const segs = (line) => line.trim().split(/\s{2,}|\t/).filter(Boolean);
const flat = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------- order number
const ORDER_LABELS = [
  // [label, how sure]
  [/\b(?:web\s+|online\s+|purchase\s+)?order\s*(?:number|no\b\.?|num\b|#|id\b|nbr\b|ref(?:erence)?\b)/i, 10],
  [/^\s*order\s*:/i, 9],
  [/\b(?:booking|reservation)\s*(?:reference|ref\b|number|no\b\.?|code|#|id\b)/i, 7],
  [/\bconfirmation\s*(?:number|no\b\.?|code|#|id\b)/i, 7],
  [/\b(?:record locator|pnr)\b/i, 7],
  [/^\s*confirmation\s*:/i, 6],
  [/\breceipt\s*(?:number|no\b\.?|#|id\b)/i, 4],
  [/\btransaction\s*(?:number|no\b\.?|#|id\b)/i, 3],
  [/\binvoice\s*(?:number|no\b\.?|#)/i, 2],
];
// Numbers that are never the order number.
const NOT_ORDER = /\b(?:customer|account|acct|member|tracking|track|purchase order|p\.?o\.?\b|po\s*(?:number|#|no)|phone|tel|fax|store|register|reg\b|terminal|merchant|cashier|employee|auth|approval|batch|aid|tvr|tsi|ref\s*#?\s*$|sku|upc|item\s*#|model|serial|tax\s*id|ein|vat)/i;

/** A token that could be an order number: has a digit, 4–32 chars, not a date / amount / phone / time. */
function orderToken(raw, strength = 10) {
  const t = String(raw || '').trim().replace(/^[#:.\s-]+|[,.;:)\]]+$/g, '').split(/\s+/)[0] || '';
  // Airline / booking codes can be letters only ("GQZTNK"); short numbers only right after "Order #".
  if (strength >= 7 && /^[A-Z]{5,8}$/.test(t)) return t;
  if (strength >= 9 && /^\d{3}$/.test(t)) return t;
  if (t.length < 4 || t.length > 32 || !/\d/.test(t)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9-/.]*[A-Za-z0-9]$/.test(t)) return null;
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t)) return null; // a date
  if (/^\$?\d+[.,]\d{2}$/.test(t)) return null; // an amount
  if (/^\(?\d{3}\)?[-.]\d{3}[-.]\d{4}$/.test(t)) return null; // a phone number
  if (/^\d{1,2}:\d{2}/.test(t)) return null; // a time
  return t;
}

/** The order number printed on the receipt (or null). Looks beside the label, then under it (same column). */
export function findOrderNumber(text) {
  const lines = linesOf(text);
  let best = null;
  lines.forEach((line, i) => {
    for (const [re, score] of ORDER_LABELS) {
      const m = line.match(re);
      if (!m) continue;
      const before = line.slice(0, m.index);
      if (NOT_ORDER.test(`${before.slice(-24)} ${m[0]}`) && !/order/i.test(m[0])) continue;
      if (best && best.score >= score) break;
      // 1) on the same line, right after the label ("Order #: 112-3456789", "Order Number W165…")
      const after = line.slice(m.index + m[0].length).replace(/^\s*(?:number|no\.?|#|id)?\s*[:#.]?\s*/i, '');
      let val = orderToken(after, score);
      // 2) under the label, in the same column ("Order Number:   Order Date:" / "W1654966057   September 23, 2026")
      if (!val) {
        const row = segs(line);
        const col = row.findIndex((sg) => re.test(sg));
        for (let k = i + 1; k <= Math.min(i + 2, lines.length - 1) && !val; k++) {
          const next = segs(lines[k]);
          if (!next.length) continue;
          const cand = next.length === row.length ? next[col] : next.length === 1 ? next[0] : next[Math.min(col, next.length - 1)];
          val = orderToken(cand, score);
          if (val && ORDER_LABELS.some(([r]) => r.test(lines[k]))) val = null; // that's another label row
        }
      }
      if (val) best = { value: val, score };
      break;
    }
  });
  return best?.value || null;
}

// ---------------------------------------------------------------- card
const BRANDS = [
  [/\bamerican\s*express\b|\bamex\b|\bamx\b/i, 'Amex'],
  [/\bmaster\s?card\b|\bmc\b(?=[\s*x•·#-]*\d{4})|\bmastercrd\b/i, 'Mastercard'],
  [/\bvisa\b/i, 'Visa'],
  [/\bdiscover\b/i, 'Discover'],
  [/\bapple\s*card\b/i, 'Apple Card'],
  [/\bjcb\b/i, 'JCB'],
  [/\bdiners\s*club\b/i, 'Diners Club'],
  [/\bunion\s*pay\b|\bunionpay\b/i, 'UnionPay'],
  [/\binterac\b/i, 'Interac'],
  [/\bpaypal\b/i, 'PayPal'],
  [/\bdebit\b/i, 'Debit'],
];
const WALLET = /\b(apple\s*pay|google\s*pay|samsung\s*pay)\b/i;

/** { brand, last4 } of the card that paid (either may be null). Never more than the last 4 digits. */
export function findCard(text) {
  const lines = linesOf(text);
  const pick = (s) => BRANDS.find(([re]) => re.test(ocrFix(s)))?.[1] || null;
  const CARDISH = /\b(card|visa|amex|american express|master\s?card|mc|discover|debit|credit|ending|ends|paid|payment|charged|tender|sale|chip|contactless|swipe|tap|acct|account)\b/i;
  const NOT_CARD = /\b(drawer|reg(?:ister)?|chk|check\s*#|server|employee|table|guest|cashier|terminal|store|phone|tel|fax|zip|order|invoice|auth|approval|aid|tvr|tsi|batch|ref|trans(?:action)?\s*id|tran\s*id|rec#|customer|member|ticket|confirmation|folio)\b/i;
  const PATTERNS = [
    [/[x*•·#]{2}[x*•·#\s-]{0,28}?(\d{4})(?!\d)/i, 2],
    [/(?:^|\s)\*(\d{4})\b(?!\d)/, 1],
    [/\b(?:visa|amex|mastercard|master card|discover|debit|credit|card)\s*\(\s*[x*•·]*\s*(\d{4})\s*\)/i, 3],
    [/\b(?:ending|ends)\s*(?:in|with)?\s*[:#-]?\s*(\d{4})\b/i, 3],
    [/\blast\s*(?:4|four)(?:\s*digits)?\s*[:#-]?\s*(\d{4})\b/i, 3],
    [/\b(?:card|acct|account)\s*(?:no\.?|number|#)?\s*[:#]?\s*[x*•·.]*\s*(\d{4})\b(?![\d/])/i, 1],
    [/\b(?:visa|amex|mastercard|master card|discover|mc|debit|credit|vi|ax|ds)\b[\s:.\-•·*x]{1,20}(\d{4})\b(?![\d/.,])/i, 2],
  ];
  let best = null;
  lines.forEach((l, i) => {
    for (const [re, base] of PATTERNS) {
      const m = l.match(re);
      if (!m) continue;
      if (/^(19|20)\d{2}$/.test(m[1]) && !/[x*•·#]/i.test(m[0])) continue; // a year
      const around = [lines[i - 1], l, lines[i + 1]].filter(Boolean).join(' ');
      let score = base;
      if (pick(l)) score += 3; else if (pick(around)) score += 2;
      if (CARDISH.test(l)) score += 2; else if (CARDISH.test(around)) score += 1;
      if ((m[0].match(/[x*•·#]/gi) || []).length >= 8) score += 2; // a full masked card number
      if (NOT_CARD.test(l.slice(0, Math.max(0, l.indexOf(m[0]))) + ' ' + l.slice(l.indexOf(m[0]) + m[0].length, l.indexOf(m[0]) + m[0].length + 12)) && !pick(l)) score -= 5;
      if (score >= 3 && (!best || score > best.score)) best = { last4: m[1], at: i, score };
      break;
    }
  });
  const at = best ? best.at : -1;
  const near = at >= 0 ? lines.slice(Math.max(0, at - 3), at + 4).join('\n') : '';
  let brand = (at >= 0 && pick(lines[at])) || pick(near) || null;
  if (!brand) {
    // Only where payments are printed (not "We accept Visa…" footers), or a line that is just the brand.
    const pay = lines.filter((l) => (CARDISH.test(l) || l.trim().split(/\s+/).length <= 3) && !/\baccept/i.test(l)).join('\n');
    brand = pick(pay);
  }
  if (!brand && WALLET.test(text)) brand = WALLET.exec(text)[1].replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { brand, last4: best?.last4 || null };
}

/** Reads what you typed in "Paid with" ("Visa 2759", "amex ••1009", "Apple Card") back into { brand, last4 }. */
export function parseCardLabel(text) {
  const t = String(text || '').trim();
  if (!t) return { brand: null, last4: null };
  const digits = t.match(/(\d{4})\D*$/);
  const known = BRANDS.find(([re]) => re.test(t))?.[1] || (WALLET.test(t) ? WALLET.exec(t)[1].replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null);
  const typed = t.replace(/[\d•·*x#\s-]+$/i, '').trim();
  return { brand: known || (typed ? typed.slice(0, 30) : null), last4: digits ? digits[1] : null };
}

/** "Visa ••2759", "Apple Card", or '' — how a card shows in Wrap and in exports. */
export function cardLabel(brand, last4) {
  if (!brand && !last4) return '';
  return [brand || 'Card', last4 ? `••${last4}` : ''].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- items
// Lines that are never things you bought (checked against the start of the name, or the whole name).
const NOT_ITEM_START = /^(?:sub\s*-?\s*total|total|tax|taxes|sales tax|est(?:imated)?\.?\s*(?:sales\s*)?tax|vat|gst|hst|pst|tip|gratuity|service charge|discounts?|savings|you saved|coupon|promo|rewards?|points|shipping|delivery|handling|deposit|crv|change|cash|tendered|balance|amount|payment|paid|charged|refund|due|grand|rounding|installments?|financed|apr|auth|approval|items? subtotal|merchandise subtotal|order total|total before tax|fuel total|price\s*\/\s*gal|qty|quantity|price|unit price|item price|ext\.? price|extended price|card|credit|debit|visa|mastercard|amex|discover|apple pay|google pay|change due|amount due|balance due|thank|ship to|bill to|sold to|sold by|condition|shipped|arrival|departure|room tax|resort fee)\b|^(?:order|invoice|receipt|date|time|check|chk|table|server|guests?|store|tel|phone|folio|ticket|trans(?:action)?)\b\s*(?:[:#]|no\b|number|\d)/i;
const NOT_ITEM_END = /\b(?:fee|fees|surcharge|tax|taxes|discount|deposit|tip|gratuity|total|subtotal)$/i;
const PAY_LINE = /(?:visa|mastercard|master card|amex|american express|discover|debit|credit)\b.*\d{4}|[x*•]{4,}\d{4}/i;
const HEADER = /^(?:item|items|items ordered|product|products|product name|description|qty|quantity|price|unit price|item price|amount|total|ext\.?|extended)(?:\s{1,}|$)/i;
const MONEY_AT = /[-–(]?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)[.,]\d{2}(?![\d%])/;
const QTY_LINE = /^\s*(\d{1,3})\s*(?:@|x|×)\s*\$?((?:\d{1,3}(?:,\d{3})+|\d+)[.,]\d{2})\s*(?:ea\.?|each)?\s*$/i;
const MAX_ITEMS = 25;

const notItem = (raw) => { const name = ocrFix(raw); return NOT_ITEM_START.test(name) || NOT_ITEM_END.test(name) || PAY_LINE.test(name) || HEADER.test(name); };

function cleanName(raw) {
  return String(raw)
    .split(/\s{2,}/)
    // drop product codes (Z0YQ, MXP63LL/A), single-letter flags (NF, T) and lone quantities that sit in their own column
    .filter((sg, k) => k === 0 || !((/^[A-Z0-9/-]{2,14}$/.test(sg) && /\d/.test(sg)) || /^[A-Z]{1,2}$/.test(sg) || /^\d{1,3}$/.test(sg)))
    .join(' ')
    .replace(/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+/, '') // a date in front (hotel folios)
    .replace(/^\d{5,}\s+/, '') // a store item number in front (Costco, Target)
    .replace(/\b(?:sku|upc|item\s*#|model|mfr\s*#|b&h\s*#)[:#\s]*[\w/-]+/ig, '')
    .replace(/[\s,–-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What was bought: [{ name, qty, amount }]. Reads the lines above the totals: each line with a name and a price,
 * plus a name that wraps onto the next line. Skips fees, tax, shipping, discounts, tips and card lines.
 */
export function findItems(text) {
  const raw = linesOf(text).map((l) => l.trim());
  // A name with its price alone on the next line ("Pocket Cinema Camera 6K Pro" / "$1,995.00"): one line.
  // (Not the big total printed under the shop's name: an amount the receipt also calls its total.)
  const totals = new Set(raw.filter((l) => /^(?:\*+\s*)?(?:sub\s*-?\s*)?total\b/i.test(l)).flatMap(moneyIn));
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const next = raw[i + 1] || '';
    if (raw[i] && /[a-z]{3}/i.test(raw[i]) && !hasMoney(raw[i]) && /^\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)[.,]\d{2}$/.test(next) && !(i < 3 && totals.has(moneyIn(next)[0]))) { lines.push(`${raw[i]}  ${next}`); i++; } else lines.push(raw[i]);
  }
  const items = [];
  const qtyLines = []; // "2 @ 12.99" on a line of its own: belongs to the item next to it
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || /^--- page break ---$/.test(l)) continue;
    if (started && /^(?:\*+\s*)?(sub\s*-?\s*total|total|order total|items? subtotal|item\(s\) subtotal|merchandise subtotal|grand total|amount due|balance due|balance)\b/i.test(ocrFix(l))) break;
    const q = l.match(QTY_LINE);
    if (q) { qtyLines.push({ at: items.length, qty: Number(q[1]), unit: Number(q[2].replace(',', '')) }); continue; }
    if (!hasMoney(l)) continue;
    const firstMoney = l.search(MONEY_AT);
    let name = l.slice(0, firstMoney).trim();
    let qty = 1;
    // "2 of: …" (Amazon), "2 x …", "Qty: 3", "× 2", "2 @ 4.50"
    const of = name.match(/^(\d{1,3})\s*(?:of:|x\s|×\s)\s*/i);
    if (of) { qty = Number(of[1]); name = name.slice(of[0].length); }
    const inline = l.match(/\b(\d{1,3})\s*(?:@|×|x)\s*\$?\d+[.,]\d{2}/i) || name.match(/(?:qty|quantity)[:\s]*(\d{1,3})\b/i) || name.match(/\s(?:x|×)\s?(\d{1,3})$/i);
    if (inline) qty = Number(inline[1]);
    name = name.replace(/(?:qty|quantity)[:\s]*\d{1,3}\b/i, '').replace(/\s(?:x|×)\s?\d{1,3}$/i, '').replace(/\b\d{1,3}\s*(?:@|×|x)\s*$/i, '');
    if (!name || !/[a-z]{2}/i.test(name) || notItem(name)) continue;
    const amounts = moneyIn(l);
    const amount = amounts.length ? amounts[amounts.length - 1] : null;
    if (amount != null && (amount <= 0 || /[-–(]\$?\d/.test(l.slice(firstMoney, firstMoney + 3)))) continue; // a credit / discount line
    // a quantity column: "Filter  2  $34.99  $69.98"
    if (!of && !inline) {
      const cols = segs(l.slice(0, l.lastIndexOf(String(l.match(MONEY_AT)?.[0] ?? '')) + 1 || l.length));
      const small = segs(l).slice(1).filter((c) => /^\d{1,3}$/.test(c)).map(Number);
      if (small.length && amounts.length >= 2 && Math.abs(amounts[0] * small[0] - amount) < 0.02) qty = small[0];
      else if (/^\d{1,3}\s+[A-Za-z]/.test(name) && cols.length) { const lead = Number(name.match(/^\d{1,3}/)[0]); if (lead > 0 && lead < 100) { qty = lead; } }
    }
    name = name.replace(/^\d{1,3}\s+(?=[A-Za-z])/, '');
    name = cleanName(name);
    if (!/[a-z]{2}/i.test(name) || notItem(name)) continue;
    // a name that wraps onto the next line(s): short, no price, not a label/sentence/code
    for (let k = i + 1; k <= i + 2 && k < lines.length; k++) {
      const nx = lines[k];
      if (!nx || hasMoney(nx) || /[:#.!?]/.test(nx) || nx.split(/\s+/).length > 8 || notItem(nx) || QTY_LINE.test(nx)) break;
      if (/^[A-Z0-9/-]{3,14}$/.test(nx) || /\s{2,}/.test(nx)) break; // a product code, or another table row
      if (/^(items?|order|ship|sold|bill|payment|thank|return|visit|www|http|condition|qty)/i.test(nx)) break;
      name = `${name} ${nx}`.replace(/\s+/g, ' ');
      i = k;
    }
    started = true;
    items.push({ name: name.slice(0, 120), qty, amount });
    if (items.length >= MAX_ITEMS) break;
  }
  // Standalone "2 @ 12.99" lines: give the quantity to the neighbouring item whose price matches.
  for (const ql of qtyLines) {
    const total = Math.round(ql.qty * ql.unit * 100) / 100;
    const cand = [items[ql.at], items[ql.at - 1]].find((x) => x && x.amount != null && Math.abs(x.amount - total) < 0.02);
    if (cand) cand.qty = ql.qty;
  }
  // The same thing on several lines (two nights of "Guest Room"): one line with the count.
  const merged = [];
  for (const it of items) {
    const same = merged.find((x) => x.name.toLowerCase() === it.name.toLowerCase() && x.amount === it.amount);
    if (same) same.qty += it.qty; else merged.push({ ...it });
  }
  return merged;
}

/** Items as the note text: one per line, "×2" for more than one. */
export function itemsNote(items, max = 8) {
  const list = (items || []).filter((x) => x?.name);
  if (!list.length) return '';
  const shown = list.slice(0, max).map((x) => `${x.name}${num(x.qty) > 1 ? ` ×${num(x.qty)}` : ''}`);
  if (list.length > max) shown.push(`+${list.length - max} more`);
  return shown.join('\n');
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ---------------------------------------------------------------- financing
/** True when part of the price is paid later in installments (Apple Card Monthly Installments, Affirm, Klarna…). */
export function isFinanced(text) {
  return /\b(monthly installments?|financed by|installment plan|payment plan|pay in 4|affirm|klarna|afterpay|sezzle|0% apr|\d+ monthly payments)\b/i.test(String(text || ''));
}
/** The order's full total (the largest "Total" amount printed), for financed purchases. */
export function fullTotal(text) {
  let best = null;
  for (const l of linesOf(text)) {
    if (!/^\s*(order\s+)?total\b/i.test(l) || /sub\s*-?\s*total/i.test(l)) continue;
    for (const a of moneyIn(l)) if (a > 0 && (best == null || a > best)) best = a;
  }
  return best;
}

// ---------------------------------------------------------------- checking the online reader
/**
 * Combines what the online reader found with what's printed in a PDF's text. For PDFs a value is only kept if
 * it's really in the text; anything missing is filled in from the text. For photos (no text) the reader's values
 * are cleaned up (only 4 digits of a card, a known brand). Returns { order_number, card_brand, card_last4, items, total? }.
 */
export function refineExtras(read, text) {
  const t = String(text || '');
  const hasText = t.replace(/\s/g, '').length > 30;
  const brandOf = (b) => BRANDS.find(([re]) => re.test(String(b || '')))?.[1] || (WALLET.test(String(b || '')) ? String(b).trim() : null);
  let order = orderToken(read?.order_number);
  let last4 = String(read?.card_last4 || '').replace(/\D/g, '').slice(-4);
  if (last4.length !== 4) last4 = null;
  let brand = brandOf(read?.card_brand);
  let items = Array.isArray(read?.items) ? read.items.filter((x) => x && String(x.name || '').trim()).map((x) => ({ name: String(x.name).trim().replace(/\s+/g, ' ').slice(0, 120), qty: num(x.qty) || 1, amount: x.amount == null ? null : num(x.amount) })) : [];
  items = items.filter((x) => !notItem(x.name));
  const out = {};
  if (hasText) {
    const ft = flat(t);
    if (order && !ft.includes(flat(order))) order = null;
    order = findOrderNumber(t) || order;
    const c = findCard(t);
    if (last4 && !t.includes(last4)) last4 = null;
    last4 = c.last4 || last4;
    brand = c.brand || brand;
    // Keep the reader's items that are really in the PDF (their first words); otherwise read them from the text.
    const real = items.filter((x) => ft.includes(flat(x.name.split(' ').slice(0, 3).join(' '))));
    items = real.length >= Math.max(1, Math.ceil(items.length * 0.6)) ? real : findItems(t);
    if (isFinanced(t)) { const full = fullTotal(t); if (full) out.total = full; }
  }
  return { ...out, order_number: order || null, card_brand: brand || null, card_last4: last4 || null, items };
}
