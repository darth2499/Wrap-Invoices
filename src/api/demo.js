// Demo backend: same interface as supabase.js, but everything lives in this browser
// (localStorage for data, IndexedDB for files). Used when no Supabase settings are configured.
import { TABLES } from './tables.js';
import { seedDemo } from './demoSeed.js';
import { uid, todayISO, round2, num } from '../lib/format.js';

const KEY = 'wrap_demo_v1';
export const DEMO_UID = '00000000-0000-4000-8000-000000000001';
const token = () => (uid() + uid()).replace(/-/g, '');

let state = null;
function load() {
  if (state) return state;
  try {
    state = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    state = null;
  }
  if (!state) {
    state = seedDemo(DEMO_UID, token);
    save();
  }
  return state;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Demo storage full', e);
  }
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const nowTs = () => new Date().toISOString();

const DEFAULTS = {
  clients: () => ({ statement_token: token(), archived: false, expects_1099: false }),
  projects: () => ({ archived: false }),
  catalog_items: () => ({ kind: 'labor', unit: 'day', rate: 0, archived: false, position: 0, ot_eligible: false }),
  invoices: () => ({ status: 'draft', share_token: token(), view_count: 0, version: 1, reminders_sent: 0, auto_remind: false, mode: 'basic', discount_type: 'amount', discount_value: 0 }),
  receipts: () => ({ status: 'review', billable: false }),
  payments: () => ({ paid_on: todayISO() }),
  mileage_trips: () => ({ billable: false, round_trip: false }),
};

function checkUnique(table, row) {
  const rows = state[table];
  if (table === 'receipts' && row.file_hash && rows.some((r) => r.id !== row.id && r.file_hash === row.file_hash)) {
    throw new Error('duplicate key value violates unique constraint "receipts_owner_id_file_hash_key"');
  }
  if (table === 'invoices' && rows.some((r) => r.id !== row.id && r.kind === row.kind && String(r.number) === String(row.number))) {
    throw new Error('duplicate key value violates unique constraint "invoices_owner_id_kind_number_key"');
  }
}

function refreshStatus(invoiceId) {
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv || inv.kind !== 'invoice' || ['void', 'draft'].includes(inv.status)) return;
  const paid = state.payments.filter((p) => p.invoice_id === invoiceId).reduce((s, p) => s + num(p.amount), 0);
  if (paid >= num(inv.total) && num(inv.total) > 0) inv.status = 'paid';
  else if (inv.status === 'paid') inv.status = 'sent';
}

function insertRow(table, row) {
  const r = { id: uid(), owner_id: DEMO_UID, created_at: nowTs(), ...(DEFAULTS[table]?.() || {}), ...row };
  if (table === 'invites') delete r.id;
  checkUnique(table, r);
  state[table].push(r);
  if (table === 'payments') refreshStatus(r.invoice_id);
  return r;
}

const pk = (table) => (table === 'invites' ? 'email' : 'id');

// Tiny IndexedDB wrapper for demo files.
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('wrap_demo_files', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(key, blob) {
  const db = await idb();
  await new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(blob, key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', 'readonly');
    const r = tx.objectStore('files').get(key);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function idbDel(key) {
  const db = await idb();
  await new Promise((res) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(key);
    tx.oncomplete = res;
    tx.onerror = res;
  });
}
const urlCache = new Map();

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export const api = {
  mode: 'demo',

  auth: {
    async getUser() {
      return localStorage.getItem('wrap_demo_signed_out') ? null : { id: DEMO_UID, email: 'demo@wrap.app' };
    },
    onChange() {
      return () => {};
    },
    async signIn() {
      localStorage.removeItem('wrap_demo_signed_out');
      window.location.reload();
    },
    async connectGmail() {
      load().profile.gmail_email = 'you@gmail.com';
      save();
      window.location.reload();
    },
    async signOut() {
      localStorage.setItem('wrap_demo_signed_out', '1');
      window.location.reload();
    },
  },

  async loadAll() {
    load();
    const db = { profile: clone(state.profile), invites: clone(state.invites) };
    for (const t of TABLES) db[t] = clone(state[t]);
    return db;
  },
  async reload(table) {
    load();
    return clone(state[table]);
  },
  async getProfile() {
    load();
    return clone(state.profile);
  },
  async insert(table, rows) {
    load();
    const many = Array.isArray(rows);
    const out = (many ? rows : [rows]).map((r) => insertRow(table, r));
    save();
    return clone(many ? out : out[0]);
  },
  async update(table, id, patch) {
    load();
    const row = state[table].find((r) => r[pk(table)] === id);
    if (!row) throw new Error('Not found');
    const next = { ...row, ...patch };
    checkUnique(table, next);
    Object.assign(row, patch);
    if (table === 'invoices') row.updated_at = nowTs();
    if (table === 'payments') refreshStatus(row.invoice_id);
    save();
    return clone(row);
  },
  async updateProfile(patch) {
    load();
    const { is_admin, ...rest } = patch;
    Object.assign(state.profile, rest);
    save();
    return clone(state.profile);
  },
  async remove(table, id) {
    load();
    const row = state[table].find((r) => r[pk(table)] === id);
    state[table] = state[table].filter((r) => r[pk(table)] !== id);
    if (table === 'invoices') {
      for (const t of ['invoice_lines', 'invoice_events', 'invoice_revisions', 'payments']) state[t] = state[t].filter((r) => r.invoice_id !== id);
      state.receipts.forEach((r) => r.invoice_id === id && (r.invoice_id = null));
    }
    if (table === 'clients' && state.invoices.some((i) => i.client_id === id)) {
      state.clients.push(row);
      throw new Error('This client has invoices. Archive it instead.');
    }
    if (table === 'payments' && row) refreshStatus(row.invoice_id);
    save();
  },
  async upsert(table, rows) {
    load();
    const out = [];
    for (const r of rows) {
      const existing = state[table].find((x) => x[pk(table)] === r[pk(table)]);
      if (existing) {
        Object.assign(existing, r);
        out.push(existing);
      } else out.push(insertRow(table, r));
    }
    save();
    return clone(out);
  },

  async rpc(name, args) {
    load();
    if (name === 'take_number') {
      const k = args.p_kind === 'quote' ? 'next_quote_number' : 'next_invoice_number';
      const kind = args.p_kind === 'quote' ? 'quote' : 'invoice';
      let n = state.profile[k];
      while (state.invoices.some((i) => i.kind === kind && String(i.number) === String(n))) n++;
      state.profile[k] = n + 1;
      save();
      return n;
    }
    if (name === 'refresh_invoice_status') {
      refreshStatus(args.inv);
      save();
      return null;
    }
    if (name === 'wipe_my_data') {
      for (const t of TABLES) state[t] = [];
      save();
      return null;
    }
    if (name === 'save_invoice') {
      const { inv, lines, summary } = args;
      const id = inv.id || uid();
      let row = state.invoices.find((i) => i.id === id);
      if (row && row.status !== 'draft') {
        state.invoice_revisions.push({
          id: uid(), owner_id: DEMO_UID, invoice_id: id, version: row.version, summary: summary || null, created_at: nowTs(),
          snapshot: { invoice: clone(row), lines: clone(state.invoice_lines.filter((l) => l.invoice_id === id).sort((a, b) => a.position - b.position)) },
        });
        state.invoice_events.push({ id: uid(), owner_id: DEMO_UID, invoice_id: id, type: 'edited', detail: summary || `Invoice updated (version ${row.version + 1})`, created_at: nowTs() });
      }
      const fields = ['number', 'client_id', 'project_id', 'issue_date', 'due_date', 'terms', 'notes', 'mode', 'jobs', 'discount_type', 'discount_value', 'deposit_percent', 'subtotal', 'discount_total', 'tax_total', 'total', 'auto_remind'];
      const patch = {};
      for (const f of fields) if (f in inv) patch[f] = inv[f] === '' ? null : inv[f];
      if (row) {
        checkUnique('invoices', { ...row, ...patch });
        const bump = row.status !== 'draft';
        Object.assign(row, patch, { updated_at: nowTs(), version: bump ? row.version + 1 : row.version });
      } else {
        row = { id, owner_id: DEMO_UID, kind: inv.kind || 'invoice', quote_id: inv.quote_id || null, created_at: nowTs(), updated_at: nowTs(), ...DEFAULTS.invoices(), ...patch };
        checkUnique('invoices', row);
        state.invoices.push(row);
        state.invoice_events.push({ id: uid(), owner_id: DEMO_UID, invoice_id: id, type: 'created', detail: null, created_at: nowTs() });
      }
      state.invoice_lines = state.invoice_lines.filter((l) => l.invoice_id !== id);
      (lines || []).forEach((l, i) =>
        state.invoice_lines.push({ id: uid(), owner_id: DEMO_UID, invoice_id: id, position: i, kind: l.kind || 'labor', item: l.item || '', description: l.description || null, note: l.note || null, qty: num(l.qty), rate: num(l.rate), amount: num(l.amount), tax_rate: num(l.tax_rate), day_type: l.day_type || null, receipt_id: l.receipt_id || null }),
      );
      refreshStatus(id);
      save();
      return id;
    }
    throw new Error(`Unknown function ${name}`);
  },

  files: {
    async upload(blob, { folder = 'receipts', ext = 'bin', key } = {}) {
      const k = key || `${DEMO_UID}/${folder}/${uid()}.${ext}`;
      await idbPut(k, blob);
      urlCache.delete(k);
      return k;
    },
    async urls(keys) {
      const out = {};
      for (const k of keys.filter(Boolean)) {
        if (!urlCache.has(k)) {
          const blob = await idbGet(k);
          if (blob) urlCache.set(k, URL.createObjectURL(blob));
        }
        if (urlCache.has(k)) out[k] = urlCache.get(k);
      }
      return out;
    },
    async remove(keys) {
      for (const k of keys.filter(Boolean)) await idbDel(k);
    },
  },

  // In demo mode there's no AI: fake a plausible read so the review screen can be tried.
  async readReceipt(key, mime, extra = {}) {
    await delay(700);
    if (extra.text) {
      // PDF receipts: a simple text read so the demo shows real values.
      const lines = extra.text.split('\n').map((l) => l.trim()).filter(Boolean);
      const tot = extra.text.match(/total[^\d$]*\$?\s*([\d,]+\.\d{2})/i);
      const dm = extra.text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      return {
        is_receipt: true, vendor: lines[0] || null, total_paid: tot ? Number(tot[1].replace(/,/g, '')) : null,
        date: dm ? `${dm[3].length === 2 ? '20' + dm[3] : dm[3]}-${dm[1].padStart(2, '0')}-${dm[2].padStart(2, '0')}` : todayISO(),
        subtotal: null, tax: null, tip: null, currency: 'USD', amounts: [], category: 'Travel', confidence: 'medium', check: 'unknown',
        reasoning: 'Demo mode: read from the PDF’s text with a simple rule. The live reader is smarter.', demo: true,
      };
    }
    const vendors = ['Parking', 'Oyamel', 'Delta Hotels', 'United Baggage', 'Uber', 'B&H Photo'];
    const v = vendors[Math.floor(Math.random() * vendors.length)];
    const subtotal = round2(10 + Math.random() * 80);
    const tax = round2(subtotal * 0.0925);
    const total = round2(subtotal + tax);
    return {
      is_receipt: true, vendor: v, date: todayISO(), total_paid: total, subtotal, tax, tip: null, currency: 'USD',
      reasoning: 'Demo mode makes up these numbers. Once Supabase and the free Cloudflare reader are connected, real receipts are read.',
      amounts: [{ label: 'Subtotal', amount: subtotal }, { label: 'Tax', amount: tax }],
      category: v === 'Oyamel' ? 'Meals' : v === 'B&H Photo' ? 'Supplies' : v === 'Parking' ? 'Parking & tolls' : 'Travel',
      confidence: 'medium', check: 'ok', demo: true,
    };
  },
  async readInvoicePdf() {
    await delay(500);
    throw new Error('Reading Wave PDFs needs the live backend (the free Cloudflare reader). Use CSV import in demo mode.');
  },

  async gmail(action, payload) {
    load();
    await delay(400);
    if (action === 'disconnect') {
      state.profile.gmail_email = null;
      save();
      return { ok: true };
    }
    if (action === 'send') {
      if (payload.type === 'statement') return { ok: true };
      const inv = state.invoices.find((i) => i.id === payload.invoice_id);
      const isReminder = payload.type === 'reminder';
      if (isReminder) {
        inv.last_reminder_at = nowTs();
        inv.reminders_sent = (inv.reminders_sent || 0) + 1;
      } else {
        inv.sent_at = nowTs();
        if (inv.status === 'draft') inv.status = 'sent';
      }
      state.invoice_events.push({ id: uid(), owner_id: DEMO_UID, invoice_id: inv.id, type: isReminder ? 'reminder' : 'sent', detail: `${isReminder ? 'Reminder' : 'Emailed'} to ${payload.to} (demo — not really sent)`, created_at: nowTs() });
      save();
      return { ok: true };
    }
    return { ok: true };
  },

  /** Demo stand-in for the server-made PDF (the real one is built in the "public" function). */
  async publicPdf(token) {
    const data = await api.publicCall('invoice', { token, preview: true });
    if (data.state !== 'open') throw new Error('This link is no longer active');
    const { buildInvoicePdf, imageBytes } = await import('../lib/pdf.js');
    const logo = data.business?.logo_url ? await imageBytes(data.business.logo_url) : null;
    return buildInvoicePdf({
      business: data.business, invoice: data.invoice, client: data.client, lines: data.lines, payments: data.payments, logo,
      verify: { url: `${window.location.href.split('#')[0]}#/i/${token}`, code: data.invoice.verify_code },
    });
  },

  async publicCall(action, payload) {
    load();
    await delay(200);
    const biz = { ...state.profile, logo_url: null };
    if (state.profile.logo_key) biz.logo_url = (await api.files.urls([state.profile.logo_key]))[state.profile.logo_key];
    if (action === 'statement') {
      const client = state.clients.find((c) => c.statement_token === payload.token);
      if (!client) throw new Error('Link not found');
      const invoices = state.invoices
        .filter((i) => i.client_id === client.id && i.kind === 'invoice' && i.status === 'sent')
        .sort((a, b) => (a.issue_date < b.issue_date ? -1 : 1))
        .map((i) => {
          const paid = state.payments.filter((p) => p.invoice_id === i.id).reduce((s, p) => s + num(p.amount), 0);
          return { number: i.number, issue_date: i.issue_date, due_date: i.due_date, total: i.total, status: i.status, share_token: i.share_token, paid, due: num(i.total) - paid };
        });
      return { business: biz, client, invoices, total_due: invoices.reduce((s, i) => s + i.due, 0) };
    }
    const inv = state.invoices.find((i) => i.share_token === payload.token);
    if (!inv) throw new Error('Link not found');
    if (action === 'accept_quote') {
      inv.status = 'accepted';
      state.invoice_events.push({ id: uid(), owner_id: DEMO_UID, invoice_id: inv.id, type: 'accepted', detail: payload.name ? `Accepted by ${payload.name}` : 'Accepted by client', created_at: nowTs() });
      save();
      return { ok: true };
    }
    const base = { business: biz, kind: inv.kind, number: inv.number };
    if (inv.status === 'void') return { ...base, state: 'void' };
    if (inv.status === 'paid') return { ...base, state: 'paid', total: inv.total };
    if (!payload.preview) {
      inv.view_count = (inv.view_count || 0) + 1;
      inv.first_viewed_at = inv.first_viewed_at || nowTs();
      inv.last_viewed_at = nowTs();
      save();
    }
    const receipts = state.receipts.filter((r) => r.invoice_id === inv.id);
    const urls = await api.files.urls(receipts.map((r) => r.file_key));
    return {
      ...base,
      state: 'open',
      invoice: { ...clone(inv), verify_code: 'DEMO-0000' },
      client: clone(state.clients.find((c) => c.id === inv.client_id) || null),
      lines: clone(state.invoice_lines.filter((l) => l.invoice_id === inv.id).sort((a, b) => a.position - b.position)),
      payments: clone(state.payments.filter((p) => p.invoice_id === inv.id)),
      receipts: receipts.map((r) => ({ id: r.id, vendor: r.vendor, date: r.receipt_date, total: r.total, billable: r.billable, mime: r.mime, url: urls[r.file_key] || null })),
    };
  },
};

export function resetDemo() {
  localStorage.removeItem(KEY);
  state = null;
}
