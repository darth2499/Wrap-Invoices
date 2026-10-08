import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Empty, Pill, Seg, Icon } from '../components/ui.jsx';
import { statusOf, dueText } from '../lib/calc.js';
import { money, fmtDate, num, todayISO } from '../lib/format.js';
import { go, useRoute } from '../router.js';

export default function Invoices({ kind }) {
  const { db, derived } = useStore();
  const route = useRoute();
  const isQuote = kind === 'quote';
  const [filter, setFilter] = useState(route.query.f || (isQuote ? 'open' : 'unpaid'));
  const [q, setQ] = useState('');
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
    .filter((r) => !s || [r.number, r.client?.name, r.project?.name, r.notes, String(r.total)].some((x) => String(x || '').toLowerCase().includes(s)))
    .sort((a, b) => (['unpaid', 'overdue', 'open'].includes(filter) ? String(a.due_date || '').localeCompare(String(b.due_date || '')) : String(b.issue_date).localeCompare(String(a.issue_date)) || Number(b.number) - Number(a.number)));
  const sum = shown.reduce((t, r) => t + (isQuote || filter === 'paid' || filter === 'all' ? num(r.total) : r.due), 0);

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
        <div style={{ position: 'relative', flex: '0 1 300px', minWidth: 200 }}>
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
          <div className="inv-cards">
            {shown.map((r) => (
              <button type="button" key={r.id} className="inv-card" onClick={() => go(`/invoices/${r.id}`)}>
                <span className="who">{r.client?.name || 'No client'}</span>
                <span className="amt num">{money(isQuote || r.status === 'paid' || r.status === 'void' || r.status === 'draft' ? r.total : r.due)}</span>
                <span className="meta">#{r.number} · {['sent'].includes(r.status) && !isQuote ? dueText(r, today) : fmtDate(r.issue_date)}{r.project?.name || r.notes ? ` · ${r.project?.name || r.notes}` : ''}</span>
                <span className="st"><Pill kind={r.st.key}>{r.st.label}</Pill></span>
              </button>
            ))}
            <div className="row between small" style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}><span className="muted">{shown.length} shown</span><strong className="num">{money(sum)}</strong></div>
          </div>
          <div className="table-wrap inv-table">
            <table className="table" style={{ minWidth: 720 }}>
              <thead>
                <tr><th>Status</th><th>No.</th><th>Client · project</th><th>Date</th><th>{isQuote ? 'Valid until' : 'Due'}</th><th className="right">{isQuote || filter === 'paid' ? 'Total' : 'Amount due'}</th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="click" onClick={() => go(`/invoices/${r.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(`/invoices/${r.id}`)}>
                    <td><Pill kind={r.st.key}>{r.st.label}</Pill></td>
                    <td className="num muted">{r.number}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.client?.name || <span className="muted">No client</span>}</div>
                      {(r.project || r.notes) && <div className="small muted">{r.project?.name || r.notes}</div>}
                    </td>
                    <td className="muted">{fmtDate(r.issue_date)}</td>
                    <td style={{ color: r.st.key === 'overdue' ? 'var(--bad)' : 'var(--ink-2)' }}>{['sent'].includes(r.status) && !isQuote ? dueText(r, today) : fmtDate(r.due_date)}</td>
                    <td className="right num">{money(isQuote || r.status === 'paid' || r.status === 'void' || r.status === 'draft' ? r.total : r.due)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={5} className="muted small" style={{ borderTop: '1px solid var(--line)' }}>{shown.length} shown</td><td className="right num" style={{ borderTop: '1px solid var(--line)', fontWeight: 600 }}>{money(sum)}</td></tr>
              </tfoot>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
