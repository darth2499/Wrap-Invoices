// App-wide data: loads everything once, keeps it in memory, and offers helpers to change it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api/index.js';
import { TABLES } from './api/tables.js';
import { paidFor } from './lib/calc.js';
import { DEMO } from './config.js';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ user, children }) {
  const [db, setDb] = useState(null);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const dbRef = useRef(null);
  dbRef.current = db;

  const load = useCallback(async () => {
    try {
      setDb(await api.loadAll(user));
    } catch (e) {
      setError(e.message);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // opts.onDone runs once when a toast goes away without its action being tapped (timed out or closed with ×).
  const settled = useRef(new Set());
  const finish = useCallback((t, acted) => {
    if (settled.current.has(t.id)) return;
    settled.current.add(t.id);
    setToasts((x) => x.filter((y) => y.id !== t.id));
    if (!acted) t.onDone?.();
  }, []);
  const toast = useCallback((text, opts = {}) => {
    const t = { id: Math.random().toString(36).slice(2), text, ...opts };
    setToasts((x) => [...x, t]);
    setTimeout(() => finish(t, false), opts.ms || (opts.action ? 7000 : 4000));
  }, [finish]);

  /** Shows a confirm dialog; resolves true/false. */
  const confirm = useCallback(
    (opts) => new Promise((resolve) => setDialog({ ...opts, resolve: (v) => { setDialog(null); resolve(v); } })),
    [],
  );

  const reload = useCallback(async (...tables) => {
    const list = tables.length ? tables : TABLES;
    const fresh = await Promise.all(list.map((t) => (t === 'profile' ? api.getProfile() : api.reload(t))));
    setDb((d) => {
      const next = { ...d };
      list.forEach((t, i) => (next[t] = fresh[i]));
      return next;
    });
  }, []);

  // Pick up changes made elsewhere (client opened/accepted a link, another device) when you come back to the app.
  useEffect(() => {
    let last = Date.now();
    const on = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 30000 && dbRef.current) {
        last = Date.now();
        reload('invoices', 'invoice_events', 'payments', 'receipts', 'profile').catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      window.removeEventListener('focus', on);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A client opens an invoice (or accepts a quote) while you're in Wrap: show it right away.
  const loaded = !!db;
  useEffect(() => {
    if (!loaded || !api.live) return undefined;
    const off = api.live((row) => {
      const prev = dbRef.current?.invoices.find((i) => i.id === row.id);
      if (!prev) return;
      setDb((d) => ({ ...d, invoices: d.invoices.map((i) => (i.id === row.id ? { ...i, ...row } : i)) }));
      const who = dbRef.current.clients.find((c) => c.id === row.client_id)?.name || 'Your client';
      const view = { label: 'View', run: () => { window.location.hash = `#/invoices/${row.id}`; } };
      if (Number(row.view_count) > Number(prev.view_count || 0)) toast(`${who} just opened ${row.kind === 'quote' ? 'quote' : 'invoice'} #${row.number}`, { action: view, ms: 8000 });
      else if (Number(row.reminders_sent) > Number(prev.reminders_sent || 0)) toast(`Automatic reminder sent to ${who} for #${row.number}`, { action: view, ms: 8000 });
      else if (row.status === 'accepted' && prev.status !== 'accepted') toast(`${who} accepted quote #${row.number}`, { action: view, ms: 8000 });
      reload('invoice_events').catch(() => {});
    });
    return off;
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Demo: now and then a "client" opens one of the sent invoices, so you can see live notifications.
  // Soon after you arrive, then further apart; at most 5 in any hour.
  useEffect(() => {
    if (!loaded || !DEMO) return undefined;
    const gaps = [20, 150, 480, 1080, 1800].map((x) => x * 1000);
    let n = 0;
    let timer;
    const tick = async () => {
      let log = [];
      try { log = (JSON.parse(localStorage.getItem('wrap_demo_views')) || []).filter((t) => Date.now() - t < 3600_000); } catch { /* none */ }
      const pool = (dbRef.current?.invoices || []).filter((i) => i.status === 'sent' && i.share_token);
      if (log.length < 5 && pool.length) {
        const inv = pool[Math.floor(Math.random() * pool.length)];
        await api.publicCall('view', { token: inv.share_token }).catch(() => {});
        await reload('invoices').catch(() => {});
        const who = dbRef.current.clients.find((c) => c.id === inv.client_id)?.name || 'Your client';
        toast(`${who} just opened invoice #${inv.number}`, { action: { label: 'View', run: () => { window.location.hash = `#/invoices/${inv.id}`; } }, ms: 8000 });
        try { localStorage.setItem('wrap_demo_views', JSON.stringify([...log, Date.now()])); } catch { /* not saved */ }
      }
      n += 1;
      if (n < gaps.length) timer = setTimeout(tick, gaps[n]);
    };
    timer = setTimeout(tick, gaps[0]);
    return () => clearTimeout(timer);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const ops = useMemo(() => ({
    async insert(table, row) {
      const out = await api.insert(table, row);
      const rows = Array.isArray(out) ? out : [out];
      setDb((d) => ({ ...d, [table]: [...d[table], ...rows] }));
      return out;
    },
    async update(table, id, patch) {
      const out = await api.update(table, id, patch);
      const key = table === 'invites' ? 'email' : 'id';
      setDb((d) => ({ ...d, [table]: d[table].map((r) => (r[key] === id ? out : r)) }));
      return out;
    },
    async remove(table, id) {
      await api.remove(table, id);
      const key = table === 'invites' ? 'email' : 'id';
      setDb((d) => ({ ...d, [table]: d[table].filter((r) => r[key] !== id) }));
    },
    async updateProfile(patch) {
      const out = await api.updateProfile(patch);
      setDb((d) => ({ ...d, profile: out }));
      return out;
    },
  }), []);

  // Handy lookups derived from the data.
  const derived = useMemo(() => {
    if (!db) return null;
    const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
    const paid = {};
    for (const p of db.payments) paid[p.invoice_id] = (paid[p.invoice_id] || 0) + Number(p.amount);
    const linesBy = {};
    for (const l of db.invoice_lines) (linesBy[l.invoice_id] ||= []).push(l);
    Object.values(linesBy).forEach((ls) => ls.sort((a, b) => a.position - b.position));
    return {
      clients: byId(db.clients),
      projects: byId(db.projects),
      invoices: byId(db.invoices),
      receipts: byId(db.receipts),
      crew: byId(db.crew_members),
      paid,
      paidFor: (id) => paid[id] || 0,
      linesFor: (id) => linesBy[id] || [],
    };
  }, [db]);

  const value = { user, db, derived, error, reload, load, toast, confirm, ...ops, setDb, api, paidFor };
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'err' : ''}`}>
            <span className="grow">{t.text}</span>
            {t.action && (
              <button className="toast-act" onClick={() => { t.action.run(); finish(t, true); }}>{t.action.label}</button>
            )}
            <button className="toast-x" aria-label="Dismiss" onClick={() => finish(t, false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        ))}
      </div>
      {dialog && <ConfirmDialog {...dialog} />}
    </Ctx.Provider>
  );
}

function ConfirmDialog({ title, body, ok = 'OK', cancel = 'Cancel', danger, resolve }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && resolve(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resolve]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && resolve(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="cd-title" style={{ maxWidth: 440 }}>
        <div className="modal-head"><h2 id="cd-title">{title}</h2></div>
        <div className="modal-body"><div style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>{body}</div></div>
        <div className="modal-foot">
          {cancel && <button className="btn" onClick={() => resolve(false)}>{cancel}</button>}
          <button className={`btn primary ${danger ? 'danger' : ''}`} style={danger ? { background: 'var(--bad)', borderColor: 'var(--bad)', color: '#fff' } : null} onClick={() => resolve(true)} autoFocus>{ok}</button>
        </div>
      </div>
    </div>
  );
}
