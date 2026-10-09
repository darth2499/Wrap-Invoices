import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Empty, Pill, Seg, Icon, Menu } from '../components/ui.jsx';
import * as A from '../lib/actions.js';
import { statusOf, dueText } from '../lib/calc.js';
import { money, fmtDate, num, todayISO, inPeriod, periodOptions } from '../lib/format.js';
import { go, useRoute } from '../router.js';

export default function Invoices({ kind }) {
  const { db, derived } = useStore();
  const route = useRoute();
  const isQuote = kind === 'quote';
  const [filter, setFilter] = useState(route.query.f || (isQuote ? 'open' : 'unpaid'));
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState('all');
  const today = todayISO();

  const rows = useMemo(
    () =>
      db.invoices
        .filter((i) => i.kind === kind)
        .map((i) => {
          const paid = derived.paidFor(i.id);
          return { ...i, paid, due: num(i.total) - paid, st: statusOf(i, paid, today), client: derived.clients[i.client_id], project: derived.projects[i.project_id] };
        }),
    [db.invoices, derived, kind, today],
  );

  const filters = isQuote
    ? [
        { value: 'open', label: 'Open', test: (r) => ['draft', 'sent'].includes(r.status) },
        { value: 'accepted', label: 'Accepted', test: (r) => r.status === 'accepted' },
        { value: 'closed', label: 'Invoiced / declined', test: (r) => ['converted', 'declined', 'void'].includes(r.status) },
        { value: 'all', label: 'All', test: () => true },
      ]
    : [
        { value: 'unpaid', label: 'Unpaid', test: (r) => r.status === 'sent' },
        { value: 'overdue', label: 'Overdue', test: (r) => r.st.key === 'overdue' },
        { value: 'draft', label: 'Drafts', test: (r) => r.status === 'draft' },
        { value: 'paid', label: 'Paid', test: (r) => r.status === 'paid' },
        { value: 'all', label: 'All', test: () => true },
      ];
  const active = filters.find((f) => f.value === filter) || filters[0];
  const s = q.trim().toLowerCase();
  const shown = rows
    .filter(active.test)
    .filter((r) => inPeriod(r.issue_date, period))
    .filter((r) => !s || [r.number, r.client?.name, r.project?.name, r.notes, String(r.total)].some((x) => String(x || '').toLowerCase().includes(s)))
    .sort((a, b) => (['unpaid', 'overdue', 'open'].includes(filter) ? String(a.due_date || '').localeCompare(String(b.due_date || '')) : String(b.issue_date).localeCompare(String(a.issue_date)) || Number(b.number) - Number(a.number)));
  // Click a column title to sort by it; click again to flip the order.
  const [sort, setSort] = useState(null);
  if (sort) {
    const val = COLS[sort.key].sort;
    shown.sort((a, b) => {
      const x = val(a, isQuote);
      const y = val(b, isQuote);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }
  const sum = shown.reduce((t, r) => t + (isQuote || filter === 'paid' || filter === 'all' ? num(r.total) : r.due), 0);

  // Same client more than once in this view → small count next to their name (tap it to show only them).
  // Same client more than once → each of their invoices is numbered 1, 2, 3… oldest first.
  const counts = {};
  const byClient = {};
  for (const r of shown) if (r.client_id) (byClient[r.client_id] ||= []).push(r);
  for (const list of Object.values(byClient)) {
    if (list.length < 2) continue;
    [...list].sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date)) || (Number(a.number) || 0) - (Number(b.number) || 0))
      .forEach((r, i) => { counts[r.id] = { n: i + 1, of: list.length }; });
  }

  // Columns can be dragged into any order (remembered on this device).
  const [cols, setCols] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem('wrap_inv_cols')); if (Array.isArray(saved) && saved.length === DEFAULT_COLS.length && saved.every((k) => COLS[k])) return saved; } catch { /* default */ }
    return DEFAULT_COLS;
  });
  const [drag, setDrag] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const moveCol = (from, to) => {
    if (!from || from === to) return;
    const next = cols.filter((k) => k !== from);
    next.splice(next.indexOf(to) + (cols.indexOf(from) < cols.indexOf(to) ? 1 : 0), 0, from);
    setCols(next);
    try { localStorage.setItem('wrap_inv_cols', JSON.stringify(next)); } catch { /* not saved */ }
  };

  const store = useStore();
  const actions = (r) => {
    const open = r.status !== 'void' && r.status !== 'paid' && (isQuote || r.status !== 'draft');
    return [
      { label: 'Edit', icon: 'edit', onClick: () => go(`/invoices/${r.id}/edit`) },
      open && { label: r.share_token ? 'Send again' : `Send ${isQuote ? 'quote' : 'invoice'}`, icon: 'mail', onClick: () => go(`/invoices/${r.id}?do=send`) },
      !isQuote && r.status === 'sent' && r.sent_at && { label: 'Send reminder', icon: 'bell', onClick: () => go(`/invoices/${r.id}?do=remind`) },
      !isQuote && open && { label: 'Record payment', icon: 'cash', onClick: () => go(`/invoices/${r.id}?do=pay`) },
      { label: 'Download PDF', icon: 'download', onClick: () => A.downloadPdf(store, r).catch((e) => store.toast(e.message, { error: true })) },
      { label: 'Duplicate', icon: 'copy', onClick: () => go(`/invoices/new?from=${r.id}`) },
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => A.confirmDelete(store, r) },
      !isQuote && r.status !== 'draft' && r.status !== 'void' && { label: 'Void', icon: 'x', danger: true, onClick: async () => { if (await store.confirm({ title: `Void invoice #${r.number}?`, body: 'It stays in your records but no longer counts as owed.', ok: 'Void', danger: true })) await A.voidInvoice(store, r); } },
    ];
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{isQuote ? 'Quotes' : 'Invoices'}</h1>
          {isQuote && <p className="muted" style={{ marginTop: 4 }}>Send an estimate; when the client accepts, turn it into an invoice in one click.</p>}
        </div>
        <Button variant="primary" icon="plus" onClick={() => go(isQuote ? '/invoices/new?kind=quote' : '/invoices/new')}>{isQuote ? 'New quote' : 'New invoice'}</Button>
      </div>

      <div className="row wrap between">
        <Seg value={filter} onChange={setFilter} label="Filter" options={filters.map((f) => ({ value: f.value, label: f.label, count: rows.filter(f.test).length }))} />
        <select className="input" style={{ width: 160 }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">{periodOptions(rows.map((r) => r.issue_date)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <div className="search-wrap" style={{ position: 'relative', flex: '0 1 300px', minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted)' }}><Icon name="search" size={16} /></span>
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Search client, number, project…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </div>
      </div>

      <div className="card">
        {shown.length === 0 ? (
          <Empty icon={isQuote ? 'quote' : 'invoice'} title={rows.length ? 'Nothing here' : isQuote ? 'No quotes yet' : 'No invoices yet'}>
            {!rows.length && <Button variant="primary" onClick={() => go(isQuote ? '/invoices/new?kind=quote' : '/invoices/new')}>{isQuote ? 'Create your first quote' : 'Create your first invoice'}</Button>}
          </Empty>
        ) : (
          <>
          <div className="m-list">
            {shown.map((r) => (
              <button type="button" key={r.id} className="m-card" onClick={() => go(`/invoices/${r.id}`)}>
                <span className="who">{r.client?.name || 'No client'}</span>
                <span className="amt num">{money(isQuote || r.status === 'paid' || r.status === 'void' || r.status === 'draft' ? r.total : r.due)}</span>
                <span className="meta">#{r.number} · {['sent'].includes(r.status) && !isQuote ? dueText(r, today) : fmtDate(r.issue_date)}{r.project?.name || r.notes ? ` · ${r.project?.name || r.notes}` : ''}</span>
                <span className="st"><Pill kind={r.st.key}>{r.st.label}</Pill></span>
              </button>
            ))}
            <div className="row between small" style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}><span className="muted">{shown.length} shown</span><strong className="num">{money(sum)}</strong></div>
          </div>
          <div className="table-wrap d-only">
            <table className="table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  {cols.map((k) => (
                    <th key={k} className={`drag-th ${COLS[k].right ? 'right' : ''} ${dragOver === k ? 'drop' : ''}`} draggable
                      onDragStart={(e) => { setDrag(k); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(k); }}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={(e) => { e.preventDefault(); moveCol(drag, k); setDrag(null); setDragOver(null); }}
                      onDragEnd={() => { setDrag(null); setDragOver(null); }}
                      onClick={() => setSort((o) => (o?.key === k ? { key: k, dir: -o.dir } : { key: k, dir: k === 'amount' || k === 'date' ? -1 : 1 }))}
                      aria-sort={sort?.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                      {COLS[k].label(isQuote, filter)}
                      <span className={`sort-arrow ${sort?.key === k ? 'on' : ''}`} aria-hidden="true">{sort?.key === k && sort.dir < 0 ? '↓' : '↑'}</span>
                    </th>
                  ))}
                  <th style={{ width: 48 }} />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="click" onClick={() => go(`/invoices/${r.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(`/invoices/${r.id}`)}>
                    {cols.map((k) => <td key={k} className={COLS[k].right ? 'right num' : undefined}>{COLS[k].cell(r, { isQuote, today, counts, setQ, q })}</td>)}
                    <td className="right" onClick={(e) => e.stopPropagation()}><Menu label="" icon="more" variant="ghost icon" items={actions(r)} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={cols.length + 1} style={{ borderTop: '1px solid var(--line)' }}><span className="row between"><span className="muted small">{shown.length} shown</span><strong className="num">{money(sum)}</strong></span></td></tr>
              </tfoot>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}

const amountOf = (r, isQuote) => money(isQuote || r.status === 'paid' || r.status === 'void' || r.status === 'draft' ? r.total : r.due);
const COLS = {
  status: { sort: (r) => r.st.label, label: () => 'Status', cell: (r) => <Pill kind={r.st.key}>{r.st.label}</Pill> },
  number: { sort: (r) => Number(r.number) || 0, label: () => 'No.', cell: (r) => <span className="num muted">{r.number}</span> },
  client: {
    sort: (r) => (r.client?.name || '').toLowerCase(),
    label: () => 'Client · project',
    cell: (r, { counts, setQ, q }) => (
      <>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontWeight: 500 }}>{r.client?.name || <span className="muted">No client</span>}</span>
          {counts[r.id] && <button type="button" className={`count-badge ${q && q === r.client?.name ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); setQ(q === r.client?.name ? '' : r.client?.name || ''); }} aria-label={`${counts[r.id].n} of ${counts[r.id].of} for ${r.client?.name} — show only them`} title={`${counts[r.id].n} of ${counts[r.id].of}`}>{counts[r.id].n}</button>}
        </div>
        {(r.project || r.notes) && <div className="small muted">{r.project?.name || r.notes}</div>}
      </>
    ),
  },
  date: { sort: (r) => r.issue_date || '', label: () => 'Date', cell: (r) => <span className="muted">{fmtDate(r.issue_date)}</span> },
  due: {
    sort: (r) => r.due_date || '9999',
    label: (isQuote) => (isQuote ? 'Valid until' : 'Due'),
    cell: (r, { isQuote, today }) => <span style={{ color: r.st.key === 'overdue' ? 'var(--bad)' : 'var(--ink-2)' }}>{r.status === 'sent' && !isQuote ? dueText(r, today) : fmtDate(r.due_date)}</span>,
  },
  amount: { sort: (r, isQuote) => num(isQuote || ['paid', 'void', 'draft'].includes(r.status) ? r.total : r.due), right: true, label: (isQuote, filter) => (isQuote || filter === 'paid' ? 'Total' : 'Amount due'), cell: (r, { isQuote }) => amountOf(r, isQuote) },
};
const DEFAULT_COLS = ['status', 'number', 'client', 'date', 'due', 'amount'];
