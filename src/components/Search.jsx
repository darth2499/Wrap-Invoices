// Search everything: invoices, quotes, clients, receipts and every page/setting. Opens with ⌘K / Ctrl+K or the search button.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { Icon } from './ui.jsx';
import { money, fmtDate } from '../lib/format.js';
import { go } from '../router.js';

const PAGES = [
  ['Overview', '/', 'overview'], ['Invoices', '/invoices', 'invoice'], ['New invoice', '/invoices/new', 'plus'], ['Quotes', '/quotes', 'quote'],
  ['New quote', '/invoices/new?kind=quote', 'plus'], ['Calendar', '/calendar', 'calendar'], ['Receipts', '/expenses', 'receipt'],
  ['Mileage', '/expenses/mileage', 'car'], ['Crew payouts', '/expenses/crew', 'crew'], ['Clients', '/clients', 'clients'],
  ['Profit & loss', '/reports/overview', 'reports'], ['Unpaid by client', '/reports/unpaid', 'reports'], ['Quarterly taxes', '/reports/quarterly', 'reports'],
  ['1099s', '/reports/1099', 'reports'], ['Tax export', '/reports/export', 'reports'], ['Business details', '/settings?section=business', 'settings'],
  ['Invoice look & templates', '/settings?section=look', 'settings'], ['Rates & saved items', '/settings?section=rates', 'settings'],
  ['Email & reminders · Gmail', '/settings?section=email', 'mail'], ['People & invites', '/settings?section=people', 'user'],
  ['Data, backup & import', '/settings?section=data', 'database'],
].map(([label, path, icon]) => ({ type: 'Pages', label, sub: '', path, icon }));

export function useSearchShortcut(setOpen) {
  useEffect(() => {
    const on = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [setOpen]);
}

export default function Search({ onClose }) {
  const { db, derived } = useStore();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (...fields) => words.length > 0 && words.every((w) => fields.some((f) => String(f ?? '').toLowerCase().includes(w)));
    if (!words.length) return PAGES.slice(0, 8);
    const out = [];
    const take = (list, n) => out.push(...list.slice(0, n));
    take(PAGES.filter((p) => hit(p.label, p.type)), 4);
    take(db.invoices.filter((inv) => {
      const c = derived.clients[inv.client_id];
      const lines = derived.linesFor(inv.id).map((l) => `${l.item} ${l.description || ''} ${l.note || ''}`).join(' ');
      return hit(inv.number, `#${inv.number}`, c?.name, inv.notes, lines, inv.total, money(inv.total), inv.status, inv.kind);
    }).sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date))).map((inv) => ({
      type: inv.kind === 'quote' ? 'Quotes' : 'Invoices', label: `#${inv.number} · ${derived.clients[inv.client_id]?.name || 'No client'}`,
      sub: `${fmtDate(inv.issue_date)} · ${money(inv.total)}${inv.notes ? ` · ${inv.notes}` : ''}`, path: `/invoices/${inv.id}`, icon: inv.kind === 'quote' ? 'quote' : 'invoice',
    })), 8);
    take(db.clients.filter((c) => hit(c.name, c.email, c.phone, c.address, c.notes)).map((c) => ({ type: 'Clients', label: c.name, sub: c.email || '', path: `/clients/${c.id}`, icon: 'clients' })), 5);
    take(db.receipts.filter((r) => hit(r.vendor, r.category, r.notes, r.total, money(r.total), r.receipt_date)).sort((a, b) => String(b.receipt_date).localeCompare(String(a.receipt_date))).map((r) => ({
      type: 'Receipts', label: r.vendor || 'Receipt', sub: `${fmtDate(r.receipt_date)} · ${money(r.total)} · ${r.category || ''}`, path: `/expenses?open=${r.id}`, icon: 'receipt',
    })), 6);
    return out;
  }, [q, db, derived]);

  useEffect(() => setI(0), [q]);
  const pick = (r) => { onClose(); go(r.path); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(results.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Enter' && results[i]) pick(results[i]);
    else if (e.key === 'Escape') onClose();
  };

  return (
    <div className="scrim search-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-box" role="dialog" aria-label="Search">
        <div className="search-input">
          <Icon name="search" size={18} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search invoices, clients, receipts, settings…" aria-label="Search" />
          <kbd onClick={onClose}>esc</kbd>
        </div>
        <div className="search-results" role="listbox">
          {results.map((r, k) => (
            <div key={`${r.path}${k}`}>
              {(k === 0 || results[k - 1].type !== r.type) && <div className="search-group">{r.type}</div>}
              <button type="button" role="option" aria-selected={k === i} className={`search-item ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => pick(r)}>
                <Icon name={r.icon} size={16} />
                <span className="col" style={{ gap: 0, minWidth: 0 }}>
                  <span className="search-label">{r.label}</span>
                  {r.sub && <span className="search-sub">{r.sub}</span>}
                </span>
              </button>
            </div>
          ))}
          {q && results.length === 0 && <div className="search-empty">No matches</div>}
        </div>
      </div>
    </div>
  );
}
