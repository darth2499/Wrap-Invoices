import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Icon, Pill, Empty, Seg } from '../components/ui.jsx';
import { ForecastChart, MonthBars, MONTHS } from '../components/charts.jsx';
import { forecastYear } from '../lib/forecast.js';
import { statusOf, dueText } from '../lib/calc.js';
import { money, moneyK, num, todayISO, plural } from '../lib/format.js';
import { go } from '../router.js';

export default function Overview() {
  const { db, derived } = useStore();
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const name = (db.profile.business_name || '').split(' ')[0];

  const [basis, setBasis] = useState(() => { try { return localStorage.getItem('wrap_chart_basis') || 'billed'; } catch { return 'billed'; } });
  const pickBasis = (v) => { setBasis(v); try { localStorage.setItem('wrap_chart_basis', v); } catch { /* not saved */ } };
  const data = useMemo(() => {
    const open = db.invoices
      .filter((i) => i.kind === 'invoice' && i.status === 'sent')
      .map((i) => ({ ...i, due: num(i.total) - derived.paidFor(i.id), st: statusOf(i, derived.paidFor(i.id), today) }));
    const overdue = open.filter((i) => i.st.key === 'overdue');
    const paidYtd = db.payments.filter((p) => p.paid_on?.startsWith(String(year))).reduce((s, p) => s + num(p.amount), 0);
    const expYtd = db.receipts.filter((r) => r.receipt_date?.startsWith(String(year))).reduce((s, r) => s + num(r.total), 0);
    const byClient = {};
    for (const i of open) byClient[i.client_id] = (byClient[i.client_id] || 0) + i.due;
    const owed = Object.entries(byClient).map(([id, v]) => ({ name: derived.clients[id]?.name || 'No client', id, v })).sort((a, b) => b.v - a.v);
    // last 12 months income (payments) vs expenses (receipts)
    const labels = [];
    const inc = [];
    const billed = [];
    const exp = [];
    const sent = db.invoices.filter((i) => i.kind === 'invoice' && !['draft', 'void'].includes(i.status));
    const d = new Date();
    for (let k = 11; k >= 0; k--) {
      const m = new Date(d.getFullYear(), d.getMonth() - k, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      labels.push(MONTHS[m.getMonth()]);
      inc.push(db.payments.filter((p) => p.paid_on?.startsWith(key)).reduce((s, p) => s + num(p.amount), 0));
      billed.push(sent.filter((i) => i.issue_date?.startsWith(key)).reduce((s, i) => s + num(i.total), 0));
      exp.push(
        db.receipts.filter((r) => r.receipt_date?.startsWith(key)).reduce((s, r) => s + num(r.total), 0)
        + db.crew_payouts.filter((c) => c.paid_on?.startsWith(key)).reduce((s, c) => s + num(c.amount), 0),
      );
    }
    const drafts = db.invoices.filter((i) => i.kind === 'invoice' && i.status === 'draft');
    const accepted = db.invoices.filter((i) => i.kind === 'quote' && i.status === 'accepted');
    return { open, overdue, paidYtd, expYtd, owed, labels, inc, billed, exp, drafts, accepted, f: forecastYear(db.invoices, today) };
  }, [db, derived, today, year]);

  const outstanding = data.open.reduce((s, i) => s + i.due, 0);
  const overdueSum = data.overdue.reduce((s, i) => s + i.due, 0);
  const oldest = data.overdue.reduce((m, i) => Math.max(m, i.st.days || 0), 0);
  const review = db.receipts.filter((r) => r.status === 'review');
  const attention = [
    ...data.overdue.sort((a, b) => b.st.days - a.st.days).map((i) => ({ key: i.id, title: `${derived.clients[i.client_id]?.name || 'No client'} · #${i.number}`, sub: dueText(i, today), amount: i.due, bad: true, go: `/invoices/${i.id}` })),
    ...data.accepted.map((q) => ({ key: q.id, title: `Quote #${q.number} accepted`, sub: `${derived.clients[q.client_id]?.name || ''} — turn it into an invoice`, amount: num(q.total), go: `/invoices/${q.id}` })),
    ...data.drafts.map((i) => ({ key: i.id, title: `Draft #${i.number} · ${derived.clients[i.client_id]?.name || 'No client'}`, sub: 'Not sent yet', amount: num(i.total), go: `/invoices/${i.id}` })),
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="muted" style={{ marginBottom: 2 }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1>{name ? `Hi, ${name}` : 'Overview'}</h1>
        </div>
        <div className="row wrap">
          <Button icon="camera" onClick={() => go('/expenses?add=1')}>Add receipt</Button>
          <Button icon="quote" onClick={() => go('/invoices/new?kind=quote')}>New quote</Button>
          <Button variant="primary" icon="plus" onClick={() => go('/invoices/new')}>New invoice</Button>
        </div>
      </div>

      <div className="grid">
        <Kpi label="Outstanding" value={money(outstanding, { cents: false })} sub={plural(data.open.length, 'unpaid invoice')} onClick={() => go('/invoices?f=unpaid')} />
        <Kpi label="Overdue" value={money(overdueSum, { cents: false })} sub={data.overdue.length ? `${plural(data.overdue.length, 'invoice')} · oldest ${oldest} days` : 'Nothing overdue'} bad={data.overdue.length > 0} onClick={() => go('/invoices?f=overdue')} />
        <Kpi label={`Paid in ${year}`} value={money(data.paidYtd, { cents: false })} sub="Payments received" onClick={() => go('/reports')} />
        <Kpi label={`Expenses in ${year}`} value={money(data.expYtd, { cents: false })} sub={review.length ? `${review.length} receipts to review` : 'From your receipts'} onClick={() => go('/expenses')} />
      </div>

      <section className="card card-pad" style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
        <div className="col" style={{ flex: '1 1 230px', gap: 10 }}>
          <div className="row"><Icon name="reports" style={{ color: 'var(--accent)' }} /><h2>{year} year-end forecast</h2></div>
          {data.f.enough ? (
            <>
              <span className="num" style={{ fontSize: 34, fontWeight: 500, letterSpacing: '-0.02em' }}>{moneyK(data.f.mid)}</span>
              <span style={{ color: 'var(--ink-2)' }}>Likely range <span className="num">{moneyK(data.f.low)} – {moneyK(data.f.high)}</span></span>
              <div className="row wrap">
                {data.f.growthPct != null && <Pill kind={data.f.growthPct >= 0 ? 'good' : 'overdue'}>{data.f.growthPct >= 0 ? '▲' : '▼'} {Math.abs(Math.round(data.f.growthPct))}% vs {year - 1}</Pill>}
                <Pill kind="draft">{moneyK(data.f.ytd)} billed so far</Pill>
              </div>
              <p className="small muted" style={{ lineHeight: 1.5 }}>
                {data.f.method === 'seasonal'
                  ? `Uses ${year - 1}'s month-by-month pattern, scaled by how this year compares so far. Counts invoices you've sent (by invoice date).`
                  : 'Based on your average monthly billing. Once you have a full year of history (or import it), the forecast also learns your busy and slow months.'}
              </p>
            </>
          ) : (
            <p className="muted" style={{ lineHeight: 1.5 }}>Not enough history yet. After about 3 months of invoices — or once you import past invoices in Settings → Data — you'll see where the year is heading.</p>
          )}
        </div>
        {data.f.enough && <div style={{ flex: '2 1 380px', minWidth: 0 }}><ForecastChart f={data.f} /></div>}
      </section>

      <div className="grid-2">
        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-head">
            <div><h2>Money in vs. out</h2><p className="small muted">Last 12 months · {basis === 'billed' ? 'invoiced (by invoice date)' : 'payments received (by date paid)'} vs. expenses</p></div>
            <Seg value={basis} onChange={pickBasis} label="Income shown" options={[{ value: 'billed', label: 'Invoiced' }, { value: 'paid', label: 'Received' }]} />
          </div>
          <div style={{ padding: '0 20px 20px' }}>
            <MonthBars labels={data.labels} series={[{ name: basis === 'billed' ? 'Invoiced' : 'Received', color: 'var(--accent)', values: basis === 'billed' ? data.billed : data.inc }, { name: 'Expenses', color: 'var(--expense)', values: data.exp }]} />
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Needs attention</h2>{data.overdue.length > 0 && <a href="#/invoices?f=overdue" className="small">All overdue</a>}</div>
          {attention.length === 0 && review.length === 0 && <Empty icon="check" title="All caught up" />}
          {review.length > 0 && (
            <button className="list-row" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => go('/expenses?status=review')}>
              <span className="col" style={{ gap: 2 }}><b style={{ fontWeight: 500 }}>{plural(review.length, 'receipt')} to check</b><span className="small muted">Confirm what was read automatically</span></span>
              <Pill kind="review">Review</Pill>
            </button>
          )}
          {attention.slice(0, 7).map((a) => (
            <button key={a.key} className="list-row" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => go(a.go)}>
              <span className="col" style={{ gap: 2 }}><b style={{ fontWeight: 500 }}>{a.title}</b><span className="small" style={{ color: a.bad ? 'var(--bad)' : 'var(--muted)' }}>{a.sub}</span></span>
              <span className="num">{money(a.amount)}</span>
            </button>
          ))}
        </section>

        <section className="card">
          <div className="card-head"><h2>Owed by client</h2></div>
          {data.owed.length === 0 && <Empty icon="cash" title="Nobody owes you anything" />}
          {data.owed.map((o) => (
            <button key={o.id} className="list-row" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => go(`/clients/${o.id}`)}>
              <span className="col" style={{ gap: 6 }}>
                <b style={{ fontWeight: 500 }}>{o.name}</b>
                <span style={{ height: 6, borderRadius: 3, background: 'var(--line-2)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${Math.max(3, (o.v / data.owed[0].v) * 100)}%` }} /></span>
              </span>
              <span className="num">{money(o.v)}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, bad, onClick }) {
  return (
    <button className="card kpi" onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
      <span className="muted">{label}</span>
      <span className="v">{value}</span>
      <span className="small" style={{ color: bad ? 'var(--bad)' : 'var(--muted)' }}>{sub}</span>
    </button>
  );
}
