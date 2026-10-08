// Import clients and past invoices from CSV (e.g. Wave exports) or from Wave invoice PDFs.
import { num, round2, todayISO, addDays } from './format.js';
import { totals } from './calc.js';
import { looksSame } from './receipts.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Finds the CSV column that best matches one of the candidate names. */
export function guessColumn(headers, candidates) {
  const h = headers.map((x) => [x, norm(x)]);
  for (const c of candidates) {
    const hit = h.find(([, n]) => n === norm(c));
    if (hit) return hit[0];
  }
  for (const c of candidates) {
    const hit = h.find(([, n]) => n.includes(norm(c)));
    if (hit) return hit[0];
  }
  return '';
}

export const CLIENT_FIELDS = [
  { key: 'name', label: 'Name', guess: ['customer name', 'customer', 'company name', 'name', 'contact name'] },
  { key: 'email', label: 'Email', guess: ['email', 'email address', 'e-mail'] },
  { key: 'phone', label: 'Phone', guess: ['phone', 'phone number', 'mobile'] },
  { key: 'address1', label: 'Address line 1', guess: ['address line 1', 'address 1', 'address1', 'street', 'address'] },
  { key: 'address2', label: 'Address line 2', guess: ['address line 2', 'address 2', 'address2'] },
  { key: 'city', label: 'City', guess: ['city'] },
  { key: 'state', label: 'State', guess: ['province/state', 'state', 'province', 'region'] },
  { key: 'zip', label: 'ZIP', guess: ['postal code/zip code', 'postal code', 'zip code', 'zip', 'postcode'] },
  { key: 'country', label: 'Country', guess: ['country'] },
  { key: 'first', label: 'Contact first name', guess: ['contact first name', 'first name'] },
  { key: 'last', label: 'Contact last name', guess: ['contact last name', 'last name'] },
];

export const INVOICE_FIELDS = [
  { key: 'number', label: 'Invoice number', guess: ['invoice number', 'invoice #', 'invoice no', 'number', 'invoice'] },
  { key: 'client', label: 'Customer', guess: ['customer name', 'customer', 'client', 'bill to'] },
  { key: 'date', label: 'Invoice date', guess: ['invoice date', 'date', 'issue date', 'created'] },
  { key: 'due', label: 'Due date', guess: ['due date', 'payment due', 'due'] },
  { key: 'total', label: 'Invoice total', guess: ['invoice total', 'total', 'amount'] },
  { key: 'amount_due', label: 'Amount still due', guess: ['amount due', 'balance due', 'balance', 'outstanding'] },
  { key: 'item', label: 'Line item (optional)', guess: ['product', 'item', 'product name', 'item name'] },
  { key: 'description', label: 'Line description (optional)', guess: ['description', 'item description', 'product description'] },
  { key: 'qty', label: 'Quantity (optional)', guess: ['quantity', 'qty'] },
  { key: 'price', label: 'Price (optional)', guess: ['price', 'unit price', 'rate'] },
];

export function autoMap(headers, fields) {
  return Object.fromEntries(fields.map((f) => [f.key, guessColumn(headers, f.guess)]));
}

/** Parses many date styles into YYYY-MM-DD. */
export function toDate(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function clientsFromCsv(rows, map) {
  const get = (r, k) => (map[k] ? r[map[k]] : '');
  return rows
    .map((r) => {
      const cityLine = [get(r, 'city'), [get(r, 'state'), get(r, 'zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const address = [get(r, 'address1'), get(r, 'address2'), cityLine, get(r, 'country')].filter(Boolean).join('\n');
      const contact = [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' ');
      return { name: get(r, 'name'), email: get(r, 'email') || null, phone: get(r, 'phone') || null, address: address || null, notes: contact && contact !== get(r, 'name') ? `Contact: ${contact}` : null };
    })
    .filter((c) => c.name && !/^n\/?a$/i.test(c.name.trim()));
}

/** Groups CSV rows into invoices (one row per invoice, or one row per line item). */
export function invoicesFromCsv(rows, map, { assume = 'unpaid' } = {}) {
  const get = (r, k) => (map[k] ? r[map[k]] : '');
  const groups = new Map();
  for (const r of rows) {
    const number = String(get(r, 'number')).replace(/^#/, '').trim();
    if (!number) continue;
    if (!groups.has(number)) groups.set(number, []);
    groups.get(number).push(r);
  }
  return [...groups.entries()].map(([number, rs]) => {
    const first = rs[0];
    const lines = map.item || map.description
      ? rs.map((r) => {
          const qty = num(get(r, 'qty')) || 1;
          const price = num(get(r, 'price'));
          return { kind: 'labor', item: get(r, 'item') || get(r, 'description') || 'Item', description: get(r, 'item') ? get(r, 'description') : '', qty, rate: price, amount: round2(qty * price) };
        })
      : [];
    let total = num(get(first, 'total'));
    if (!total && lines.length) total = round2(lines.reduce((s, l) => s + l.amount, 0));
    if (!lines.length) lines.push({ kind: 'labor', item: 'Imported invoice', description: 'Imported from previous invoicing app', qty: 1, rate: total, amount: total });
    // No "amount due" column: use what the person chose (unpaid by default, so nothing is wrongly marked paid).
    const amountDue = map.amount_due ? num(get(first, 'amount_due')) : assume === 'paid' ? 0 : total;
    const date = toDate(get(first, 'date')) || todayISO();
    return { number, client: get(first, 'client'), date, due: toDate(get(first, 'due')) || addDays(date, 30), total, amountDue, lines };
  });
}

/** Creates clients and invoices. store: the app store (insert/rpc/reload). */
export async function importInvoices(list, { db, api, onStep = () => {} }) {
  const clientsByName = new Map(db.clients.map((c) => [norm(c.name), c]));
  const existingNumbers = new Set(db.invoices.filter((i) => i.kind === 'invoice').map((i) => String(i.number)));
  let created = 0;
  const skipped = [];
  for (const [i, inv] of list.entries()) {
    onStep(`Importing ${i + 1} / ${list.length}`);
    if (existingNumbers.has(String(inv.number))) { skipped.push(`#${inv.number} (number already used)`); continue; }
    let client = clientsByName.get(norm(inv.client));
    if (!client && inv.client) {
      client = await api.insert('clients', { name: inv.client, email: inv.clientEmail || null, address: inv.clientAddress || null });
      clientsByName.set(norm(inv.client), client);
    }
    const t = totals(inv.lines, 'amount', inv.discount || 0);
    const id = await api.rpc('save_invoice', {
      inv: {
        number: String(inv.number), client_id: client?.id || null, issue_date: inv.date, due_date: inv.due, notes: inv.notes || null,
        discount_type: 'amount', discount_value: round2(inv.discount || 0), ...t, terms: null,
      },
      lines: inv.lines,
      summary: null,
    });
    const total = t.total;
    await api.update('invoices', id, { status: 'sent', sent_at: new Date(inv.date + 'T12:00:00').toISOString() });
    let pays = inv.payments?.length ? inv.payments : [];
    if (!pays.length) {
      const paid = round2(total - num(inv.amountDue));
      if (paid > 0) pays = [{ date: inv.amountDue > 0 ? inv.date : inv.due, amount: paid, method: 'Imported' }];
    }
    if (pays.length) {
      await api.insert('payments', pays.map((p) => ({ invoice_id: id, paid_on: toDate(p.date) || inv.due, amount: round2(p.amount), method: p.method || 'Imported' })));
    }
    existingNumbers.add(String(inv.number));
    created++;
  }
  // Keep the "next invoice #" counter ahead of anything imported.
  const maxNum = Math.max(0, ...[...existingNumbers].filter((n) => /^\d+$/.test(String(n))).map(Number));
  if (maxNum >= (db.profile.next_invoice_number || 1)) await api.updateProfile({ next_invoice_number: maxNum + 1 });
  return { created, skipped };
}

/** Adds expenses (no receipt image) — e.g. from Wave — skipping ones that are already in Wrap. */
export async function importExpenses(list, { db, api, onStep = () => {} }) {
  const known = db.receipts;
  const rows = [];
  let skipped = 0;
  for (const e of list) {
    const row = { vendor: e.vendor, receipt_date: e.date, total: e.amount, category: e.category, notes: e.notes, status: 'confirmed', ai: { source: 'wave', wave_account: e.waveAccount, wave_id: e.waveId } };
    // Only compare with what was already in Wrap: two identical charges in the same export are real (e.g. two bag fees).
    if (known.some((r) => (r.ai?.wave_id && r.ai.wave_id === e.waveId) || looksSame(r, row))) { skipped++; continue; }
    rows.push(row);
  }
  for (let i = 0; i < rows.length; i += 200) {
    onStep(`Adding expenses ${Math.min(i + 200, rows.length)} / ${rows.length}`);
    await api.insert('receipts', rows.slice(i, i + 200));
  }
  return { created: rows.length, skipped };
}

/** Reads a Wave invoice PDF (its text, pulled out in the browser) and returns an import-ready invoice. */
export async function invoiceFromPdf(file, api) {
  const { pdfText, pdfFirstPageImage, blobToBase64 } = await import('./pdftext.js');
  const text = await pdfText(file);
  const payload = text.replace(/\s/g, '').length > 30
    ? { text }
    : { image_b64: await blobToBase64(await pdfFirstPageImage(file, 2000)), image_mime: 'image/jpeg' };
  const r = await api.readInvoicePdf(payload);
  return {
    number: String(r.number || '').replace(/^#/, ''),
    client: r.client_name,
    clientEmail: r.client_email,
    clientAddress: r.client_address,
    date: toDate(r.issue_date) || todayISO(),
    due: toDate(r.due_date) || addDays(toDate(r.issue_date) || todayISO(), 30),
    total: num(r.total),
    amountDue: num(r.amount_due),
    notes: r.notes || null,
    payments: (r.payments || []).map((p) => ({ date: p.date, amount: num(p.amount), method: p.method })),
    lines: (r.lines || []).map((l) => ({ kind: 'labor', item: l.item, description: l.description || '', note: l.note || '', qty: num(l.qty) || 1, rate: num(l.rate), amount: num(l.amount) })),
    fileName: file.name,
  };
}
