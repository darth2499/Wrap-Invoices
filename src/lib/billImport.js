// Importing an invoice someone sent you (from Wave, QuickBooks, FreshBooks, a Word template, a photo…) into
// Crew payouts as a bill to pay. Text PDFs from Wave are read exactly; everything else by the reader, and every
// result goes through the same checks, so a number that doesn't add up is shown to you, never saved quietly.
import { num, round2, todayISO, addDays } from './format.js';
import { pdfText, pdfFirstPageImage, blobToBase64 } from './pdftext.js';
import { compressPhoto } from './scan.js';

const r2 = (n) => round2(num(n));
const near = (a, b, tol = 0.011) => Math.abs(num(a) - num(b)) <= tol;

/** Reads the file and returns { bill, problems, text }. bill uses the reader's fields (from_name, lines, total…). */
export async function readBill(file, api) {
  const isPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
  let text = '';
  let payload;
  if (isPdf) {
    text = await pdfText(file, 30).catch(() => '');
    payload = text.replace(/\s/g, '').length > 30
      ? { text }
      : { image_b64: await blobToBase64(await pdfFirstPageImage(file, 2000)), image_mime: 'image/jpeg' };
  } else {
    payload = { image_b64: await blobToBase64(await compressPhoto(file, { maxSide: 2000, quality: 0.85 })), image_mime: 'image/jpeg' };
  }
  let bill = await api.readBill(payload);
  if (bill?.is_invoice === false) throw new Error('This doesn’t look like an invoice');
  // Wave text PDFs: the numbers come from the PDF's own text (exact), the sender from the reader.
  if (text) {
    try {
      const { parseWaveInvoiceText } = await import('./waveInvoicePdf.js');
      const exact = parseWaveInvoiceText(text);
      if (exact) bill = { ...bill, number: exact.number || bill.number, issue_date: exact.issue_date || bill.issue_date, due_date: exact.due_date || bill.due_date, lines: exact.lines, total: exact.total, discount: exact.discount, amount_due: exact.amount_due, payments: exact.payments, reader: 'exact' };
    } catch { /* the reader's version is used */ }
  }
  bill = tidy(bill);
  return { bill, problems: billProblems(bill, text), text };
}

/** Fills in what can be worked out (amount due from payments, due date from "Net 30"), and cleans numbers. */
export function tidy(b) {
  const out = { ...b, lines: (b.lines || []).map((l) => ({ ...l, qty: l.qty == null ? 1 : num(l.qty), rate: l.rate == null ? null : r2(l.rate), amount: l.amount == null ? null : r2(l.amount) })) };
  for (const l of out.lines) {
    if (l.amount == null && l.rate != null) l.amount = r2(l.qty * l.rate);
    if (l.rate == null && l.amount != null) l.rate = l.qty ? r2(l.amount / l.qty) : l.amount;
  }
  const paid = (out.payments || []).reduce((t, p) => t + num(p.amount), 0);
  if (out.total == null && out.lines.length) out.total = r2(out.lines.reduce((t, l) => t + num(l.amount), 0) - num(out.discount) + num(out.tax) + num(out.shipping));
  if (out.amount_due == null && out.total != null) out.amount_due = r2(out.total - paid);
  if (!out.due_date && out.issue_date) {
    const net = String(out.terms || '').match(/net\s*(\d{1,3})/i);
    if (net) out.due_date = addDays(out.issue_date, Number(net[1]));
    else if (/due (on|upon) receipt/i.test(out.terms || '')) out.due_date = out.issue_date;
  }
  return out;
}

/**
 * Everything that doesn't add up or looks wrong: [{ field, message }]. field: total | due | lines | issue_date |
 * due_date | from_name | number. An empty list means it all checks out.
 */
export function billProblems(b, text = '') {
  const out = [];
  const add = (field, message) => out.push({ field, message });
  if (!String(b.from_name || '').trim()) add('from_name', 'Who sent it? The sender’s name wasn’t found.');
  if (!String(b.number || '').trim()) add('number', 'No invoice number found.');
  if (b.total == null || num(b.total) <= 0) add('total', 'No total found.');
  const lines = b.lines || [];
  for (const l of lines) {
    if (l.amount != null && l.rate != null && l.qty && !near(r2(l.qty * l.rate), l.amount, Math.max(0.011, Math.abs(num(l.amount)) * 0.01))) {
      add('lines', `${l.item || 'A line'}: ${l.qty} × ${num(l.rate).toFixed(2)} isn’t ${num(l.amount).toFixed(2)}.`);
    }
  }
  const sum = r2(lines.reduce((t, l) => t + num(l.amount), 0));
  if (lines.length && b.subtotal != null && !near(sum, b.subtotal)) add('lines', `The lines add up to ${sum.toFixed(2)}, but the subtotal says ${num(b.subtotal).toFixed(2)}.`);
  if (b.total != null && (lines.length || b.subtotal != null)) {
    const base = b.subtotal != null ? num(b.subtotal) : sum;
    const expect = r2(base - Math.abs(num(b.discount)) + num(b.tax) + num(b.shipping));
    if (!near(expect, b.total, Math.max(0.011, num(b.total) * 0.005))) add('total', `Subtotal − discount + tax comes to ${expect.toFixed(2)}, but the total says ${num(b.total).toFixed(2)}.`);
  }
  if (b.amount_due != null && b.total != null && num(b.amount_due) > num(b.total) + 0.011) add('due', 'The amount due is more than the total.');
  if (b.amount_due != null && num(b.amount_due) < 0) add('due', 'The amount due is below zero.');
  const today = todayISO();
  if (!b.issue_date) add('issue_date', 'No invoice date found.');
  else if (b.issue_date > addDays(today, 31)) add('issue_date', 'The invoice date is more than a month from now.');
  else if (b.issue_date < '2000-01-01') add('issue_date', 'The invoice date looks wrong.');
  if (b.due_date && b.issue_date && b.due_date < b.issue_date) add('due_date', 'It’s due before it was sent.');
  // A text PDF must actually contain the total (catches a misread digit).
  const flat = String(text || '').replace(/[\s,$]/g, '');
  if (flat.length > 30 && b.total != null && !flat.includes(num(b.total).toFixed(2))) add('total', `The total (${num(b.total).toFixed(2)}) doesn’t appear anywhere in the PDF.`);
  return out;
}

/** A fingerprint of the file, so the same invoice can't be imported twice into your Wrap. */
export async function fileKey(file, userId = '') {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const salt = new TextEncoder().encode(`bill:${userId}:`);
  const all = new Uint8Array(salt.length + bytes.length);
  all.set(salt); all.set(bytes, salt.length);
  const d = await crypto.subtle.digest('SHA-256', all);
  return `file:${[...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 48)}`;
}
