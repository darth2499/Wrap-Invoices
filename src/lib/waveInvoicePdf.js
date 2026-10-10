// Reads a Wave invoice PDF exactly, from its text (no AI): every line item on every page,
// with its description lines, plus dates, client, discount, payments and notes.
// Returns null when the PDF doesn't look like a Wave invoice or the lines don't add up to its total,
// so the caller can fall back to the AI reader.

// "$1,700.00", "-$100.00", "$-100.00" and "($100.00)" (newer Wave PDFs show discounts in brackets)
import { findDates, guessOrder } from './dateText.js';

const MONEY = String.raw`\(?-?\$-?[\d,]+\.\d{2}\)?`;
const ROW = new RegExp(String.raw`^(.+?)\s{2,}(\d+(?:\.\d+)?)\s{2,}(${MONEY})\s{2,}(${MONEY})$`);
// Older Wave invoices have only "Items  Amount" columns (each line is 1 × its amount).
const ROW_AMOUNT_ONLY = new RegExp(String.raw`^(.+?)\s{2,}(${MONEY})$`);
const HEADER = /^Items(\s{2,}Quantity\s{2,}(?:Price|Rate))?\s{2,}Amount$/i;
const LABELLED = new RegExp(String.raw`^(.+?):\s+(${MONEY})$`);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const amt = (s) => {
  const neg = /-|\(/.test(s);
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return Math.round((neg ? -n : n) * 100) / 100;
};

/**
 * "May 31, 2026" → "2026-05-31" (no time zones involved). Also "31 May 2026", "2026-05-31", and numeric dates
 * (31/05/2026 or 05/31/2026: a number over 12 decides, otherwise this device's usual order).
 */
export function longDate(s) {
  const v = String(s || '').trim();
  const m = v.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  const f = findDates(v, null, guessOrder([v]));
  return f && f.start === 0 ? f.dates[0] : null;
}

// The right-hand "Label: value" fields sometimes share a text row with the left column
// ("BILL TO  Invoice Number:  214", "Chad Thomas  Invoice Date:  September 27, 2026"): split those apart.
const FIELD_AT = /\s{2,}(?=(?:Invoice Number|Invoice Date|Payment Due|Amount Due(?: \(\w+\))?|P\.?O\.?\/?S\.?O\.? Number|Due Date):)/i;

export function parseWaveInvoiceText(text) {
  const all = String(text || '').split('\n').flatMap((l) => l.split(FIELD_AT)).map((l) => l.trim()).filter(Boolean);
  const field = (label) => {
    const re = new RegExp(`^${label}:?\\s+(.+)$`, 'i');
    for (const l of all) { const m = l.match(re); if (m) return m[1].trim(); }
    return null;
  };
  const number = field('Invoice Number')?.replace(/^#/, '');
  if (!number || !all.some((l) => HEADER.test(l))) return null;

  // ----- client (the "BILL TO" block; the right-hand column's "Label: value" lines are mixed in) -----
  const isLabel = (l) => /^(Invoice Number|Invoice Date|Payment Due|Amount Due|P\.?O\.?\/?S\.?O\.? Number)\b.*:/i.test(l);
  let client = null;
  let email = null;
  const address = [];
  const bt = all.findIndex((l) => /^BILL TO$/i.test(l));
  if (bt >= 0) {
    for (const l of all.slice(bt + 1)) {
      if (HEADER.test(l)) break;
      if (isLabel(l)) continue;
      if (/^\S+@\S+\.\S+$/.test(l)) { email = email || l; continue; }
      if (/^[\d\s()+.-]{7,}$/.test(l)) continue; // phone number
      if (!client) { client = l; continue; }
      if (l === client || (!address.length && !/\d/.test(l))) continue; // contact name under the company
      address.push(l);
    }
  }

  // ----- line items (rows + the description lines under each) -----
  const lines = [];
  let inItems = false;
  let cur = null;
  const totalsAt = [];
  let amountOnly = false;
  for (const [i, l] of all.entries()) {
    // The item list can continue on the next page, even partway through one item's description lines
    // ("Uber to EWR ($127.98)" at the top of page 2 still belongs to the item above it), so the current item
    // carries over the page break and the next page's header.
    if (HEADER.test(l)) { inItems = true; amountOnly = !/Quantity/i.test(l); continue; }
    if (!inItems) continue;
    if (/^Page \d+ of \d+/i.test(l) || l.startsWith('--- page break')) { inItems = false; continue; }
    const row = !amountOnly && l.match(ROW);
    if (row) {
      cur = { kind: 'labor', item: row[1].trim(), qty: Number(row[2]), rate: amt(row[3]), amount: amt(row[4]), extra: [] };
      lines.push(cur);
      continue;
    }
    const row2 = amountOnly && !LABELLED.test(l) && l.match(ROW_AMOUNT_ONLY);
    if (row2) {
      cur = { kind: 'labor', item: row2[1].trim(), qty: 1, rate: amt(row2[2]), amount: amt(row2[2]), extra: [] };
      lines.push(cur);
      continue;
    }
    if (LABELLED.test(l) || /^Notes \/ Terms$/i.test(l)) { inItems = false; cur = null; totalsAt.push(i); continue; }
    if (cur) cur.extra.push(l);
  }
  if (!lines.length) return null;
  for (const ln of lines) {
    // Keep every description line, line breaks included (e.g. "Salesforce (07/20)" then "- 1 Day ($750)" …).
    ln.description = ln.extra.join('\n');
    ln.note = '';
    delete ln.extra;
  }

  // ----- totals, discount, tax, payments -----
  let subtotal = null;
  let total = null;
  let amountDue = null;
  let discount = 0;
  let tax = 0;
  const payments = [];
  for (const l of all.slice(totalsAt[0] ?? 0)) {
    const m = l.match(LABELLED);
    if (!m) continue;
    const [label, value] = [m[1].trim(), amt(m[2])];
    if (/^Sub-?total$/i.test(label)) subtotal = value;
    else if (/^Total$/i.test(label)) total = value;
    else if (/^Amount Due/i.test(label)) amountDue = value;
    else if (/^Payment on /i.test(label)) {
      const pm = label.match(/^Payment on (.+?\d{4})(?: using (?:an? )?(.+))?$/i);
      payments.push({ date: longDate(pm?.[1]), amount: Math.abs(value), method: pm?.[2] ? pm[2].replace(/^\w/, (c) => c.toUpperCase()) : null });
    } else if (/discount/i.test(label) || value < 0) discount += Math.abs(value);
    else tax += value;
  }
  if (total == null) return null;

  // Notes / Terms
  const ni = all.findIndex((l) => /^Notes \/ Terms$/i.test(l));
  const notes = ni >= 0 ? all.slice(ni + 1).filter((l) => !/^Page \d+ of \d+/i.test(l) && !l.startsWith('--- page break')).join('\n') || null : null;

  // Only trust it if everything adds up to the invoice total.
  const sum = Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100;
  if (subtotal != null && Math.abs(subtotal - sum) > 0.01) return null;
  if (Math.abs(sum - discount + tax - total) > 0.01) return null;

  return {
    number,
    client_name: client,
    client_email: email,
    client_address: address.join('\n') || null,
    issue_date: longDate(field('Invoice Date')),
    due_date: longDate(field('Payment Due')),
    total,
    amount_due: amountDue ?? total - payments.reduce((t, p) => t + p.amount, 0),
    discount: Math.round(discount * 100) / 100,
    notes,
    payments,
    lines,
    reader: 'exact',
  };
}
