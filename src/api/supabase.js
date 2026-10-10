// Live backend: Supabase (database + Google sign-in) and edge functions (files, receipt reading, Gmail, client links).
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { TABLES } from './tables.js';
import { takeEarly, publicRequest } from '../lib/publicFast.js';

let client = null;
const sb = () =>
  (client ||= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }));

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const redirectTo = () => window.location.origin + window.location.pathname;

function check({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

async function call(fn, body, { auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
  if (auth) {
    const { data } = await sb().auth.getSession();
    if (!data.session) throw new Error('Please sign in again');
    headers.Authorization = `Bearer ${data.session.access_token}`;
  } else {
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}

async function listAll(table) {
  const page = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const data = check(await sb().from(table).select('*').order(table === 'invites' ? 'email' : 'id').range(from, from + page - 1));
    rows.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return rows;
}

export const api = {
  /** Live updates while the app is open: calls onInvoice(row) when one of your invoices changes (e.g. a client opens it). */
  live(onInvoice) {
    const ch = sb().channel('wrap-invoices')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'invoices' }, (p) => p.new && onInvoice(p.new))
      .subscribe();
    return () => { sb().removeChannel(ch); };
  },
  mode: 'live',

  auth: {
    async getUser() {
      const { data } = await sb().auth.getSession();
      return data.session?.user ?? null;
    },
    onChange(cb) {
      const { data } = sb().auth.onAuthStateChange((event, session) => cb(event, session));
      return () => data.subscription.unsubscribe();
    },
    signIn() {
      return sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
    },
    connectGmail() {
      sessionStorage.setItem('wrap_connect_gmail', '1');
      return sb().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectTo(),
          scopes: GMAIL_SCOPE,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
    },
    signOut() {
      return sb().auth.signOut();
    },
  },

  async loadAll(user) {
    const [profile, ...lists] = await Promise.all([
      sb().from('profiles').select('*').eq('id', user.id).single().then(check),
      ...TABLES.map(listAll),
    ]);
    const db = { profile };
    TABLES.forEach((t, i) => (db[t] = lists[i]));
    if (profile.is_admin) db.invites = await listAll('invites');
    else db.invites = [];
    return db;
  },

  async reload(table) {
    return listAll(table);
  },
  async getProfile() {
    const { data: s } = await sb().auth.getSession();
    return check(await sb().from('profiles').select('*').eq('id', s.session.user.id).single());
  },

  async insert(table, rows) {
    const many = Array.isArray(rows);
    const data = check(await sb().from(table).insert(many ? rows : [rows]).select());
    return many ? data : data[0];
  },
  async update(table, id, patch) {
    const key = table === 'invites' ? 'email' : 'id';
    return check(await sb().from(table).update(patch).eq(key, id).select().single());
  },
  async updateProfile(patch) {
    const { data: s } = await sb().auth.getSession();
    return check(await sb().from('profiles').update(patch).eq('id', s.session.user.id).select().single());
  },
  async remove(table, id) {
    const key = table === 'invites' ? 'email' : 'id';
    check(await sb().from(table).delete().eq(key, id));
  },
  async upsert(table, rows) {
    if (!rows.length) return [];
    return check(await sb().from(table).upsert(rows, { onConflict: table === 'invites' ? 'email' : 'id' }).select());
  },
  async rpc(name, args) {
    return check(await sb().rpc(name, args));
  },

  files: {
    async upload(blob, { folder = 'receipts', ext = 'bin', key } = {}) {
      const { key: k, url } = await call('files', { action: 'upload', folder, ext, key, size: blob.size });
      const res = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } });
      if (!res.ok) throw new Error(`Upload failed (${res.status}). Check the R2 CORS settings in SETUP.md.`);
      return k;
    },
    async urls(keys) {
      const list = [...new Set(keys.filter(Boolean))];
      if (!list.length) return {};
      const out = {};
      for (let i = 0; i < list.length; i += 400) {
        Object.assign(out, (await call('files', { action: 'download', keys: list.slice(i, i + 400) })).urls);
      }
      return out;
    },
    async remove(keys) {
      const list = keys.filter(Boolean);
      if (list.length) await call('files', { action: 'delete', keys: list });
    },
    /** How much of the free storage is used: { used, limit, mine, counted_at } in bytes. */
    usage(recount = false) {
      return call('files', { action: 'usage', recount });
    },
  },

  readReceipt(key, mime, extra = {}) {
    return call('receipt-read', { key, mime, ...extra });
  },
  readInvoicePdf(extra) {
    return call('receipt-read', { mode: 'invoice', ...extra });
  },
  gmail(action, payload = {}) {
    return call('gmail', { action, ...payload });
  },
  async publicCall(action, payload = {}) {
    // Client page: { page, files } promises (see publicFast.js).
    if (action === 'invoice') return takeEarly(payload.token, !!payload.preview) || publicRequest(payload.token, !!payload.preview);
    return call('public', { action, ...payload }, { auth: false });
  },
  /** The invoice PDF, made on the server from the saved invoice. */
  async publicPdf(token) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ action: 'pdf', token }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  },
};
