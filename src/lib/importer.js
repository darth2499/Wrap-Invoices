import { DEMO } from '../config.js';
// Import clients and past invoices from CSV (e.g. Wave exports) or from Wave invoice PDFs.
import { num, round2, todayISO, addDays } from './format.js';
import { totals } from './calc.js';
import { looksSame } from './receipts.js';
import { datesFromCode } from './shoots.js';

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

/**
 * Adds clients, skipping names already in Wrap (but filling in their missing email/phone/address/notes).
 * Returns the full, updated client list so invoices imported next can link to them.
 */
export async function importClients(list, { db, api }) {
  if (DEMO) throw new Error('Not available in the demo');
  const byName = new Map(db.clients.map((c) => [norm(c.name), c]));
  const seen = new Set();
  const fresh = [];
  let updated = 0;
  for (const c of list) {
    const k = norm(c.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const ex = byName.get(k);
    if (!ex) { fresh.push(c); continue; }
    const patch = {};
    for (const f of ['email', 'phone', 'address', 'notes']) if (!ex[f] && c[f]) patch[f] = c[f];
    if (Object.keys(patch).length) { byName.set(k, await api.update('clients', ex.id, patch)); updated++; }
  }
  for (let i = 0; i < fresh.length; i += 200) {
    for (const c of await api.insert('clients', fresh.slice(i, i + 200))) byName.set(norm(c.name), c);
  }
  return { created: fresh.length, updated, existing: seen.size - fresh.length, clients: [...byName.values()] };
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

/**
 * What a PDF import does with an invoice whose number is already in Wrap:
 *  'fill'   — it came from the Wave CSV (lines without descriptions) and the totals match: the PDF's lines go in.
 *  'skip'   — nothing is different.
 *  'update' — something's different (amounts, lines, notes, dates): the PDF version replaces it.
 *             If the PDF is missing lines that are in Wrap, you choose: add the new lines ('append')
 *             or replace everything ('overwrite'). `removed` says how many lines that affects.
 * Payments always stay.
 */
const lineKey = (l) => [String(l.item || '').trim().toLowerCase(), String(l.description || '').trim(), String(l.note || '').trim(), num(l.qty), round2(num(l.rate))].join('|');
export function pdfMatch(inv, db, choice) {
  const ex = db.invoices.find((i) => i.kind === 'invoice' && String(i.number) === String(inv.number));
  if (!ex) return { action: 'new' };
  const exLines = db.invoice_lines.filter((l) => l.invoice_id === ex.id).sort((a, b) => a.position - b.position);
  if (!inv.lines?.length) return { action: 'skip', ex, reason: 'No line items found in the PDF' };
  const csvOnly = ex.mode !== 'advanced' && !exLines.some((l) => l.description || l.note || l.receipt_id);
  if (csvOnly) {
    const sum = round2(inv.lines.reduce((t, l) => t + num(l.amount), 0));
    const withDiscount = totals(inv.lines, 'amount', ex.discount_total || 0);
    if (Math.abs(withDiscount.total - num(ex.total)) < 0.01) return { action: 'fill', ex, t: withDiscount, discount: num(ex.discount_total) };
    if (Math.abs(sum - num(ex.total)) < 0.01) return { action: 'fill', ex, t: totals(inv.lines, 'amount', 0), discount: 0 };
  }
  const pdfKeys = inv.lines.map(lineKey);
  const exKeys = exLines.map(lineKey);
  const pdfTotal = totals(inv.lines, 'amount', inv.discount || 0).total;
  const same = pdfKeys.length === exKeys.length && pdfKeys.every((k, i) => k === exKeys[i])
    && Math.abs(pdfTotal - num(ex.total)) < 0.01
    && String(inv.notes || '').trim() === String(ex.notes || '').trim()
    && inv.date === ex.issue_date;
  if (same) return { action: 'skip', ex, reason: 'Already up to date' };
  const removed = exKeys.filter((k) => !pdfKeys.includes(k)).length;
  return { action: 'update', ex, exLines, removed, mode: removed ? choice || 'append' : 'overwrite' };
}

/** Creates clients and invoices. store: the app store (insert/rpc/reload). */
export async function importInvoices(list, { db, api, onStep = () => {}, fill = false, choices = {} }) {
  if (DEMO) throw new Error('Not available in the demo');
  const clientsByName = new Map(db.clients.map((c) => [norm(c.name), c]));
  const existingNumbers = new Set(db.invoices.filter((i) => i.kind === 'invoice').map((i) => String(i.number)));
  let created = 0;
  let filled = 0;
  const skipped = [];
  const ids = []; // every invoice added or filled in, so the app can offer "View invoice"
  for (const [i, inv] of list.entries()) {
    onStep(`Importing ${i + 1} / ${list.length}`);
    if (existingNumbers.has(String(inv.number))) {
      const m = fill ? pdfMatch(inv, db, choices[inv.number]) : { action: 'skip', reason: 'number already used' };
      if (m.action === 'fill') { await fillInvoice(m, inv, { db, api }); filled++; ids.push(m.ex.id); }
      else if (m.action === 'update') { await updateInvoice(m, inv, { db, api }); filled++; ids.push(m.ex.id); }
      else skipped.push(`#${inv.number} (${m.reason})`);
      continue;
    }
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
    let pays = inv.payments?.length ? inv.payments : [];
    if (!pays.length) {
      const paid = round2(total - num(inv.amountDue));
      if (paid > 0) pays = [{ date: inv.amountDue > 0 ? inv.date : inv.due, amount: paid, method: null }];
    }
    // A single PDF with nothing paid yet comes in as a draft to check and send from Wrap.
    // History (Wave exports, or PDFs already paid) comes in as sent, since the client already has it.
    if (!(fill && !pays.length)) await api.update('invoices', id, { status: 'sent', sent_at: new Date(inv.date + 'T12:00:00').toISOString() });
    if (pays.length) {
      await api.insert('payments', pays.map((p) => ({ invoice_id: id, paid_on: toDate(p.date) || inv.due, amount: round2(p.amount), method: p.method || null })));
    }
    existingNumbers.add(String(inv.number));
    ids.push(id);
    created++;
  }
  // Keep the "next invoice #" counter ahead of anything imported.
  const maxNum = Math.max(0, ...[...existingNumbers].filter((n) => /^\d+$/.test(String(n))).map(Number));
  if (maxNum >= (db.profile.next_invoice_number || 1)) await api.updateProfile({ next_invoice_number: maxNum + 1 });
  return { created, filled, skipped, ids };
}

/** Brings an invoice in Wrap up to date with its PDF: replace everything, or keep what's there and add the new lines. */
async function updateInvoice({ ex, exLines, mode }, inv, { db, api }) {
  const strip = ({ id, owner_id, invoice_id, position, ...l }) => l;
  const lines = mode === 'append'
    ? [...exLines.map(strip), ...inv.lines.filter((l) => !exLines.some((x) => lineKey(x) === lineKey(l)))]
    : inv.lines;
  const discount = round2(inv.discount || 0);
  const t = totals(lines, 'amount', discount);
  const keep = ['number', 'client_id', 'project_id', 'terms', 'deposit_percent', 'auto_remind'];
  await api.rpc('save_invoice', {
    inv: {
      id: ex.id, ...Object.fromEntries(keep.map((k) => [k, ex[k]])), mode: 'basic', jobs: null,
      issue_date: mode === 'append' ? ex.issue_date : inv.date || ex.issue_date,
      due_date: mode === 'append' ? ex.due_date : inv.due || ex.due_date,
      notes: mode === 'append' ? ex.notes || inv.notes || null : inv.notes ?? ex.notes ?? null,
      discount_type: 'amount', discount_value: discount, ...t,
    },
    lines,
    summary: mode === 'append' ? 'New lines added from the PDF' : 'Updated from the PDF',
  });
  const client = db.clients.find((c) => c.id === ex.client_id);
  if (client) {
    const patch = {};
    if (!client.email && inv.clientEmail) patch.email = inv.clientEmail;
    if (!client.address && inv.clientAddress) patch.address = inv.clientAddress;
    if (Object.keys(patch).length) Object.assign(client, await api.update('clients', client.id, patch));
  }
}

/** Puts a PDF's line details onto an invoice that came in from the Wave CSV. Payments and status stay as they are. */
async function fillInvoice({ ex, t, discount }, inv, { db, api }) {
  const keep = ['number', 'client_id', 'project_id', 'issue_date', 'due_date', 'terms', 'mode', 'jobs', 'deposit_percent', 'auto_remind'];
  await api.rpc('save_invoice', {
    inv: { id: ex.id, ...Object.fromEntries(keep.map((k) => [k, ex[k]])), notes: ex.notes || inv.notes || null, discount_type: 'amount', discount_value: discount, ...t },
    lines: inv.lines,
    summary: 'Line details added from Wave PDF',
  });
  // Fill in the client's email/address if Wave's PDF has them and Wrap doesn't.
  const client = db.clients.find((c) => c.id === ex.client_id);
  if (client) {
    const patch = {};
    if (!client.email && inv.clientEmail) patch.email = inv.clientEmail;
    if (!client.address && inv.clientAddress) patch.address = inv.clientAddress;
    if (Object.keys(patch).length) Object.assign(client, await api.update('clients', client.id, patch));
  }
}

/** Adds expenses (no receipt image) — e.g. from Wave — skipping ones that are already in Wrap. */
export async function importExpenses(list, { db, api, onStep = () => {} }) {
  if (DEMO) throw new Error('Not available in the demo');
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

/**
 * Turns the breakdown you typed into a Wave line into add-ons, so it opens in Wrap as pieces you can edit:
 *   Camera Operator · $2,240.55        →  Camera Operator  $750
 *   Google (10/05)                          ↳ Travel    2 × $375
 *   Travel ($375 x2)                        ↳ Per Diem  3 × $80
 *   Per Diem ($80 x3)                       ↳ Hotel     1 × $500.55
 *   Hotel ($500.55)
 * Only when the pieces add up (the rest is the base price); otherwise the line is left exactly as it was.
 */
export function withAddons(l) {
  if (num(l.qty) !== 1) return l;
  const rows = [l.description, l.note].filter(Boolean).join('\n').split('\n').map((x) => x.trim()).filter(Boolean);
  const MI = /^(.+?)\s*\(\s*([\d,.]+)\s*mi(?:les)?\s*[x×@]\s*\$([\d.]+)\s*\)$/i;
  const ADD = /^(.+?)\s*\(\s*\$([\d,]+(?:\.\d+)?)\s*(?:[x×]\s*(\d+(?:\.\d+)?))?\s*\)$/i;
  const keep = [];
  const items = [];
  for (const row of rows) {
    const mi = row.match(MI);
    const a = !mi && row.match(ADD);
    if (mi) items.push({ label: mi[1].trim(), qty: num(mi[2]), rate: num(mi[3]), unit: 'mi' });
    else if (a) items.push({ label: a[1].trim(), qty: a[3] ? num(a[3]) : 1, rate: num(a[2]) });
    else keep.push(row);
  }
  if (!items.length) return l;
  // "Camera Operator ($750 x2)" is the base itself, not an add-on.
  const baseRow = items.findIndex((x) => x.label.toLowerCase() === String(l.item || '').trim().toLowerCase());
  const base = baseRow >= 0 ? items.splice(baseRow, 1)[0] : null;
  const extra = items.reduce((t, x) => t + x.qty * x.rate, 0);
  const rest = round2(num(l.amount) - extra);
  if (rest < 0 || (base && Math.abs(base.qty * base.rate - rest) > 0.01)) return l;
  return {
    ...l, description: rows.join('\n'), note: '',
    extras: { desc: keep.join('\n'), qty: base ? base.qty : 1, rate: base ? base.rate : rest, base_rate: base ? base.rate : rest, items },
  };
}

/**
 * A line covering several days, e.g. "Google (10/05-10/07)" at $2,250 × 1, comes in as 3 × $750
 * (only when it divides evenly to the cent). With add-ons, the base price is split instead.
 */
// Newer Wave PDFs put the dates on their own line, without brackets: "09/26-09/27 (2 Days)".
const BARE_DATES = /^(\d{2}\/\d{2}(?:\s*-\s*\d{2}\/\d{2})?(?:,\s*\d{2}\/\d{2}(?:\s*-\s*\d{2}\/\d{2})?)*)(?:\s*\(\s*\d+(?:\.\d+)?\s*days?\s*\))?$/i;

export function withDays(l, issueDate) {
  // Rewrite those the way Wrap writes dates ("(09/26-09/27)"), so the Calendar and receipt suggestions see them.
  const fix = (text) => {
    const rows = String(text || '').split('\n');
    const m = rows[0].trim().match(BARE_DATES);
    if (!m) return null;
    rows[0] = `(${m[1].replace(/\s+/g, '')})`;
    return rows.join('\n');
  };
  const fixed = fix(l.extras ? l.extras.desc : l.description);
  if (fixed != null) {
    l = l.extras ? { ...l, extras: { ...l.extras, desc: fixed } } : { ...l, description: fixed };
  }
  const first = String(l.extras ? l.extras.desc : l.description || '').split('\n')[0];
  const m = first.match(/\((\d{2}\/\d{2}(?:-\d{2}\/\d{2})?(?:,\s*\d{2}\/\d{2}(?:-\d{2}\/\d{2})?)*)\)/);
  if (!m) return l;
  const dates = datesFromCode(m[1], issueDate);
  const n = dates.length;
  const out = { ...l, dates };
  if (n < 2 || num(l.qty) !== 1) return out;
  const split = (total) => { const per = round2(total / n); return Math.abs(per * n - total) < 0.005 ? per : null; };
  if (l.extras) {
    const per = num(l.extras.qty) === 1 && split(num(l.extras.rate));
    if (per) out.extras = { ...l.extras, qty: n, rate: per, base_rate: per };
    return out;
  }
  const per = split(num(l.amount));
  return per ? { ...out, qty: n, rate: per } : out;
}

/**
 * Rejects anything that isn't clearly a real invoice before it's imported. Each check names what was wrong.
 *   - an invoice number, an invoice date, a total above $0
 *   - at least one line with an amount above $0, and every line's qty × rate = its amount
 *   - the lines add up to the total (allowing for a discount, and tax up to 30%)
 *   - payments aren't more than the total
 *   - when the PDF has text: the total really appears in it (so a misread or made-up number can't get through)
 * Returns null when it's fine, or the reason it was rejected.
 */
export function invoiceProblem(r, text = '') {
  if (!r || typeof r !== 'object') return 'Nothing could be read from it';
  if (r.is_invoice === false) return 'This doesn’t look like an invoice';
  const fin = (v) => typeof v === 'number' ? Number.isFinite(v) : v !== null && v !== undefined && v !== '' && Number.isFinite(Number(String(v).replace(/[$,\s]/g, '')));
  const n = (v) => Number(String(v ?? '').replace(/[$,\s]/g, ''));
  const number = String(r.number ?? '').replace(/^#/, '').trim();
  if (!number) return 'No invoice number found';
  if (!toDate(r.issue_date)) return 'No invoice date found';
  if (!fin(r.total) || n(r.total) <= 0) return 'The total is $0 or missing';
  const total = n(r.total);
  const lines = Array.isArray(r.lines) ? r.lines : [];
  if (!lines.length) return 'It has no line items';
  let sum = 0;
  for (const l of lines) {
    if (!fin(l.amount)) return `A line (${l.item || 'unnamed'}) has no amount`;
    const amt = n(l.amount);
    sum += amt;
    if (fin(l.qty) && fin(l.rate) && n(l.rate) !== 0) {
      const calc = n(l.qty) * n(l.rate);
      if (Math.abs(calc - amt) > Math.max(0.011, Math.abs(amt) * 0.01)) return `A line (${l.item || 'unnamed'}) doesn’t add up: ${n(l.qty)} × ${n(l.rate)} isn’t ${amt}`;
    }
  }
  if (!lines.some((l) => n(l.amount) > 0)) return 'Every line is $0';
  const net = round2(sum - (fin(r.discount) ? Math.abs(n(r.discount)) : 0));
  if (net <= 0 || total < net - 0.011 - net * 0.005 || total > net * 1.3 + 0.011) return `The lines add up to ${net.toFixed(2)}, but the total says ${total.toFixed(2)}`;
  const paid = (Array.isArray(r.payments) ? r.payments : []).reduce((t, p) => t + (fin(p?.amount) ? n(p.amount) : 0), 0);
  if (paid > total + 0.011) return 'The payments are more than the total';
  if (String(text).replace(/\s/g, '').length > 30) {
    const flat = String(text).replace(/[\s,$]/g, '');
    if (!flat.includes(total.toFixed(2))) return `The total (${total.toFixed(2)}) doesn’t appear anywhere in the PDF`;
  }
  return null;
}

/** Reads a Wave invoice PDF (its text, pulled out in the browser) and returns an import-ready invoice. */
export async function invoiceFromPdf(file, api) {
  const { pdfText, pdfFirstPageImage, blobToBase64 } = await import('./pdftext.js');
  const text = await pdfText(file, 30);
  // Wave PDFs are read exactly from their text (free, instant). Anything else goes to the AI reader.
  const { parseWaveInvoiceText } = await import('./waveInvoicePdf.js');
  let r = parseWaveInvoiceText(text);
  if (!r) {
    const payload = text.replace(/\s/g, '').length > 30
      ? { text }
      : { image_b64: await blobToBase64(await pdfFirstPageImage(file, 2000)), image_mime: 'image/jpeg' };
    r = await api.readInvoicePdf(payload);
  }
  const problem = invoiceProblem(r, text);
  if (problem) throw new Error(`Not imported — ${problem.charAt(0).toLowerCase()}${problem.slice(1)}.`);
  return {
    number: String(r.number || '').replace(/^#/, ''),
    client: r.client_name,
    clientEmail: r.client_email,
    clientAddress: r.client_address,
    date: toDate(r.issue_date) || todayISO(),
    due: toDate(r.due_date) || addDays(toDate(r.issue_date) || todayISO(), 30),
    total: num(r.total),
    amountDue: num(r.amount_due),
    discount: num(r.discount),
    notes: r.notes || null,
    payments: (r.payments || []).map((p) => ({ date: p.date, amount: num(p.amount), method: p.method })),
    lines: (r.lines || []).map((l) => withDays(withAddons({ kind: 'labor', item: l.item, description: l.description || '', note: l.note || '', qty: num(l.qty) || 1, rate: num(l.rate), amount: num(l.amount) }), toDate(r.issue_date) || todayISO())),
    fileName: file.name,
  };
}
