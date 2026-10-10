// Things you do to invoices, shared by several screens.
import { totals, compileJobs, otRule } from './calc.js';
import { pdfFileName } from './format.js';
// The PDF maker (pdf-lib) only loads the first time you download or email a PDF.
const pdfLib = () => import('./pdf.js');
import { buildInvoiceZip, downloadBlob } from './files.js';
import { mmdd, round2, todayISO, num, money } from './format.js';
import { shareUrl } from '../router.js';

export const RELOAD_INVOICE = ['invoices', 'invoice_lines', 'invoice_events', 'invoice_revisions', 'payments'];

/** Saves an invoice + lines. Keeps the number counter ahead of numbers you type yourself. */
export async function saveInvoice(s, inv, lines, summary = null) {
  const t = totals(lines, inv.discount_type, inv.discount_value);
  const id = await s.api.rpc('save_invoice', {
    inv: { ...inv, ...t },
    lines: lines.map((l, i) => ({ ...l, position: i, amount: round2(l.amount) })),
    summary,
  });
  const n = parseInt(String(inv.number).replace(/\D/g, ''), 10);
  const key = inv.kind === 'quote' ? 'next_quote_number' : 'next_invoice_number';
  if (Number.isFinite(n) && n >= (s.db.profile[key] || 1)) await s.updateProfile({ [key]: n + 1 });
  await s.reload(...RELOAD_INVOICE);
  return id;
}

export async function logEvent(s, invoiceId, type, detail = null) {
  await s.insert('invoice_events', { invoice_id: invoiceId, type, detail });
}

/** Copies the client link. Copying a draft's link marks it as sent. */
export async function copyLink(s, inv) {
  // The private link is only created the first time you send.
  const token = inv.share_token || (await s.api.rpc('share_link', { p_invoice: inv.id }));
  if (!token) throw new Error('Couldn’t create the link');
  const url = shareUrl(token);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    window.prompt('Copy this link:', url);
  }
  if (inv.status === 'draft' || !inv.sent_at) {
    await s.update('invoices', inv.id, { status: 'sent', sent_at: new Date().toISOString() });
    await logEvent(s, inv.id, 'sent', 'Client link copied');
    s.toast('Link copied — marked as sent');
  } else {
    if (!inv.share_token) await s.reload('invoices');
    s.toast('Link copied');
  }
}

export async function markSent(s, inv) {
  await s.update('invoices', inv.id, { status: 'sent', sent_at: new Date().toISOString() });
  await logEvent(s, inv.id, 'sent', 'Marked as sent');
}

export async function recordPayment(s, inv, { amount, paid_on, method, note }) {
  // A payment on a draft means it went out somehow — count it as sent so status/paid work.
  if (inv.status === 'draft') await s.update('invoices', inv.id, { status: 'sent', sent_at: new Date().toISOString() });
  await s.insert('payments', { invoice_id: inv.id, amount: round2(amount), paid_on: paid_on || todayISO(), method: method || null, note: note || null });
  await logEvent(s, inv.id, 'payment', `${money(amount)} received${method ? ` (${method})` : ''}`);
  await s.reload('invoices', 'payments');
}

export async function deletePayment(s, p) {
  await s.remove('payments', p.id);
  await s.reload('invoices');
}

/**
 * What you can do to end an invoice:
 *  - Before the client has opened it (and nothing's been paid), it can simply be deleted.
 *  - Once they've seen it or paid something, it's voided instead, so your records stay complete.
 *  - Saved but never actually sent: it can go back to being a draft.
 */
export function lifecycle(s, inv) {
  const isQuote = inv.kind === 'quote';
  const seen = num(inv.view_count) > 0;
  const paid = s.db.payments.some((p) => p.invoice_id === inv.id);
  const canDelete = isQuote || inv.status === 'draft' || (!seen && !paid);
  return {
    canDelete,
    canVoid: !isQuote && !canDelete && !['draft', 'void'].includes(inv.status),
    canUndraft: !isQuote && inv.status === 'sent' && !inv.sent_at && !seen && !paid,
  };
}

/** "Save" a draft from a list: it's finished and ready to send (it only says Sent once it's actually sent). */
export async function finalizeDraft(s, inv) {
  await s.update('invoices', inv.id, { status: 'sent', sent_at: null });
  await logEvent(s, inv.id, 'edited', 'Saved — ready to send');
  await s.reload('invoices', 'invoice_events');
  s.toast(`#${inv.number} saved — ready to send`, { action: { label: 'Send', run: () => { window.location.hash = `#/invoices/${inv.id}?do=send`; } } });
}

export async function moveToDraft(s, inv) {
  await s.update('invoices', inv.id, { status: 'draft', sent_at: null });
  await logEvent(s, inv.id, 'edited', 'Moved back to draft');
  await s.reload('invoices', 'invoice_events');
  s.toast('Moved back to draft');
}

export async function voidInvoice(s, inv) {
  await s.update('invoices', inv.id, { status: 'void', voided_at: new Date().toISOString() });
  await logEvent(s, inv.id, 'voided', null);
}

export async function unvoidInvoice(s, inv) {
  await s.update('invoices', inv.id, { status: inv.sent_at ? 'sent' : 'draft', voided_at: null });
  await s.api.rpc('refresh_invoice_status', { inv: inv.id });
  await logEvent(s, inv.id, 'edited', 'Void undone');
  await s.reload('invoices');
}

/**
 * Deletes with an Undo instead of asking first: the invoice disappears right away, and the toast says what goes
 * with it. Tap Undo and it's back untouched. When the toast goes away (or you close the page), it's deleted for good.
 * Returns true (it's gone from view).
 */
export async function confirmDelete(s, inv) {
  const pays = s.db.payments.filter((p) => p.invoice_id === inv.id).length;
  let snapshot = null;
  s.setDb((d) => {
    snapshot = { index: d.invoices.findIndex((i) => i.id === inv.id), row: d.invoices.find((i) => i.id === inv.id) };
    return { ...d, invoices: d.invoices.filter((i) => i.id !== inv.id) };
  });
  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    window.removeEventListener('pagehide', commit);
    try { await deleteInvoice(s, inv); } catch (e) { restore(); s.toast(`Couldn’t delete #${inv.number}: ${e.message}`, { error: true }); }
  };
  const restore = () => s.setDb((d) => {
    if (!snapshot?.row || d.invoices.some((i) => i.id === inv.id)) return d;
    const list = [...d.invoices];
    list.splice(Math.max(0, Math.min(snapshot.index, list.length)), 0, snapshot.row);
    return { ...d, invoices: list };
  });
  window.addEventListener('pagehide', commit); // leaving the page counts as letting the toast go
  const extra = [pays && `${pays === 1 ? 'its payment' : `${pays} payments`}`, inv.share_token && 'its client link'].filter(Boolean);
  s.toast(`#${inv.number} deleted${extra.length ? ` with ${extra.join(' and ')}` : ''}`, {
    ms: 8000,
    action: { label: 'Undo', run: () => { done = true; window.removeEventListener('pagehide', commit); restore(); } },
    onDone: commit,
  });
  return true;
}

export async function deleteInvoice(s, inv) {
  const attached = s.db.receipts.filter((r) => r.invoice_id === inv.id);
  for (const r of attached) await s.update('receipts', r.id, { invoice_id: null, billable: false });
  await s.remove('invoices', inv.id);
  await s.reload(...RELOAD_INVOICE, 'receipts', 'mileage_trips', 'crew_payouts');
}

export async function convertQuote(s, quote) {
  const lines = s.derived.linesFor(quote.id).map(({ id, invoice_id, owner_id, ...l }) => l);
  const number = String(await s.api.rpc('take_number', { p_kind: 'invoice' }));
  const p = s.db.profile;
  const issue = todayISO();
  const due = new Date();
  due.setDate(due.getDate() + (p.default_terms_days || 30));
  const id = await saveInvoice(s, {
    kind: 'invoice', number, client_id: quote.client_id, project_id: quote.project_id, issue_date: issue,
    due_date: due.toISOString().slice(0, 10), terms: `Net ${p.default_terms_days || 30}`, notes: quote.notes, mode: quote.mode,
    jobs: quote.jobs, discount_type: quote.discount_type, discount_value: quote.discount_value, deposit_percent: quote.deposit_percent,
    auto_remind: p.auto_remind_default, quote_id: quote.id,
  }, lines);
  await s.update('invoices', quote.id, { status: 'converted', converted_invoice_id: id });
  await logEvent(s, quote.id, 'converted', `Turned into invoice #${number}`);
  await s.reload('invoices', 'profile');
  return id;
}

function receiptLine(r) {
  const item = r.category === 'Parking & tolls' ? 'Parking' : r.category === 'Meals' ? 'Meal' : r.category === 'Travel' ? 'Travel' : r.vendor || 'Expense';
  const desc = [r.vendor && item !== r.vendor ? r.vendor : null, r.receipt_date ? `(${mmdd(r.receipt_date)})` : null].filter(Boolean).join(' ');
  return { kind: 'expense', item, description: desc, qty: 1, rate: num(r.total), amount: round2(num(r.total)), receipt_id: r.id, note: '' };
}

/**
 * Bills (on=true) or un-bills (on=false) one or more receipts on an invoice, rebuilding its lines once
 * and saving (a sent invoice keeps the old version in History).
 * Advanced invoices: a receipt already used by a job expense stays there (amount kept in sync);
 * otherwise it goes under "Other items".
 */
export async function setBillableMany(s, inv, receipts, on) {
  if (!receipts.length) return;
  const ids = new Set(receipts.map((r) => r.id));
  for (const r of receipts) await s.update('receipts', r.id, { billable: on, invoice_id: inv.id });
  const current = s.derived.linesFor(inv.id).map(({ id, owner_id, invoice_id, ...l }) => l);
  let jobs = inv.jobs;
  let lines;
  if (inv.mode === 'advanced' && jobs) {
    const inJobs = new Set();
    const nextJobs = (jobs.jobs || []).map((j) => ({
      ...j,
      expenses: (j.expenses || [])
        .filter((e) => on || !ids.has(e.receipt_id))
        .map((e) => {
          if (!ids.has(e.receipt_id)) return e;
          inJobs.add(e.receipt_id);
          const r = receipts.find((x) => x.id === e.receipt_id);
          return { ...e, amount: num(r.total) };
        }),
    }));
    let other = (jobs.other || []).filter((o) => !ids.has(o.receipt_id));
    if (on) {
      for (const r of receipts) {
        if (inJobs.has(r.id)) continue;
        const l = receiptLine(r);
        other = [...other, { id: r.id, item: l.item, note: l.description, amount: l.amount, receipt_id: r.id }];
      }
    }
    jobs = { ...jobs, jobs: nextJobs, other };
    const client = s.derived.clients[inv.client_id];
    lines = compileJobs(jobs, otRule(s.db.profile, client), s.db.day_types);
  } else {
    lines = current.filter((l) => !ids.has(l.receipt_id));
    if (on) lines = [...lines, ...receipts.map(receiptLine)];
  }
  const { id, kind, number, client_id, project_id, issue_date, due_date, terms, notes, mode, discount_type, discount_value, deposit_percent, auto_remind } = inv;
  const what = receipts.length === 1 ? `${receipts[0].vendor || 'receipt'} (${money(receipts[0].total)})` : `${receipts.length} receipts`;
  await saveInvoice(s, { id, kind, number, client_id, project_id, issue_date, due_date, terms, notes, mode, jobs, discount_type, discount_value, deposit_percent, auto_remind }, lines,
    inv.status !== 'draft' ? `${on ? 'Added' : 'Removed'} reimbursable ${what}` : null);
  await s.reload('receipts');
}

export async function attachReceipts(s, inv, ids) {
  for (const id of ids) await s.update('receipts', id, { invoice_id: inv.id });
}

export function setBillable(s, inv, receipt, on) {
  return setBillableMany(s, inv, [receipt], on);
}

export async function detachReceipt(s, inv, receipt) {
  if (receipt.billable) await setBillable(s, inv, receipt, false);
  await s.update('receipts', receipt.id, { invoice_id: null, billable: false });
}

/** Everything the PDF needs, from the signed-in person's data. */
export async function invoiceBundle(s, inv) {
  const p = s.db.profile;
  const client = s.derived.clients[inv.client_id] || null;
  const lines = s.derived.linesFor(inv.id);
  const payments = s.db.payments.filter((x) => x.invoice_id === inv.id).sort((a, b) => (a.paid_on < b.paid_on ? -1 : 1));
  const receipts = s.db.receipts.filter((r) => r.invoice_id === inv.id).sort((a, b) => String(a.receipt_date || '').localeCompare(String(b.receipt_date || '')));
  const keys = [p.logo_key, ...receipts.map((r) => r.file_key)].filter(Boolean);
  const urls = keys.length ? await s.api.files.urls(keys) : {};
  return { business: p, client, lines, payments, receipts: receipts.map((r) => ({ ...r, url: urls[r.file_key] })), logoUrl: p.logo_key ? urls[p.logo_key] : null };
}

export async function downloadPdf(s, inv) {
  const b = await invoiceBundle(s, inv);
  const { buildInvoicePdf, imageBytes } = await pdfLib();
  const logo = b.logoUrl ? await imageBytes(b.logoUrl) : null;
  const bytes = await buildInvoicePdf({ ...b, invoice: inv, logo });
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), pdfFileName(inv));
}

export async function downloadZip(s, inv) {
  const b = await invoiceBundle(s, inv);
  const { buildInvoicePdf, imageBytes } = await pdfLib();
  const logo = b.logoUrl ? await imageBytes(b.logoUrl) : null;
  const bytes = await buildInvoicePdf({ ...b, invoice: inv, logo });
  const zip = await buildInvoiceZip(bytes, pdfFileName(inv), b.receipts, b.lines);
  downloadBlob(zip, pdfFileName(inv).replace(/\.pdf$/, '_with_receipts.zip'));
}
