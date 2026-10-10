import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Icon, Pill, Empty } from '../components/ui.jsx';
import { ForecastChart, MonthBars, MONTHS } from '../components/charts.jsx';
import { forecastYear, forecastExpenses } from '../lib/forecast.js';
import { statusOf, dueText } from '../lib/calc.js';
import { money, moneyK, num, todayISO, plural, fmtShort, daysBetween } from '../lib/format.js';
import { go } from '../router.js';
import { buildFeed } from '../lib/feed.js';

export default function Overview() {
  const { db, derived } = useStore();
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const name = (db.profile.business_name || '').split(' ')[0];

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
    const years = [];
    const billed = [];
    const exp = [];
    const sent = db.invoices.filter((i) => i.kind === 'invoice' && !['draft', 'void'].includes(i.status));
    const d = new Date();
    for (let k = 11; k >= 0; k--) {
      const m = new Date(d.getFullYear(), d.getMonth() - k, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      labels.push(MONTHS[m.getMonth()]);
      years.push(m.getFullYear());
      billed.push(sent.filter((i) => i.issue_date?.startsWith(key)).reduce((s, i) => s + num(i.total), 0));
      exp.push(
        db.receipts.filter((r) => r.receipt_date?.startsWith(key)).reduce((s, r) => s + num(r.total), 0)
        + db.crew_payouts.filter((c) => c.paid_on?.startsWith(key)).reduce((s, c) => s + num(c.amount), 0),
      );
    }
    const drafts = db.invoices.filter((i) => i.kind === 'invoice' && i.status === 'draft');
    return { open, overdue, paidYtd, expYtd, owed, labels, years, billed, exp, drafts, f: forecastYear(db.invoices, today), fx: forecastExpenses(db.receipts, db.crew_payouts, today) };
  }, [db, derived, today, year]);

  const outstanding = data.open.reduce((s, i) => s + i.due, 0);
  const overdueSum = data.overdue.reduce((s, i) => s + i.due, 0);
  const oldest = data.overdue.reduce((m, i) => Math.max(m, i.st.days || 0), 0);
  const review = db.receipts.filter((r) => r.status === 'review');
  // Bills you need to pay (imported invoices and crew payouts), soonest due first; ones without a due date last.
  const toPay = db.crew_payouts.filter((p) => !p.paid_on).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || num(b.amount) - num(a.amount));
  const toPaySum = toPay.reduce((t, p) => t + num(p.amount), 0);
  const attention = [
    ...data.overdue.sort((a, b) => b.st.days - a.st.days).map((i) => ({ key: i.id, title: `${derived.clients[i.client_id]?.name || 'No client'} · #${i.number}`, sub: dueText(i, today), amount: i.due, bad: true, go: `/invoices/${i.id}` })),
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="muted" style={{ marginBottom: 2 }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1>{name ? `Hi, ${name}` : 'Overview'}</h1>
        </div>
        <div className="row wrap ov-actions">
          <Button icon="camera" onClick={() => go('/expenses?add=1')}>Add receipt</Button>
          <Button icon="quote" onClick={() => go('/invoices/new?kind=quote')}>New quote</Button>
          <Button variant="primary" icon="plus" onClick={() => go('/invoices/new')}>New invoice</Button>
        </div>
      </div>

      <div className="grid kpi-grid">
        <Kpi label="Outstanding" value={money(outstanding, { cents: false })} sub={plural(data.open.length, 'unpaid invoice')} onClick={() => go('/invoices?f=unpaid')} />
        <Kpi label="Overdue" value={money(overdueSum, { cents: false })} sub={data.overdue.length ? `${plural(data.overdue.length, 'invoice')} · oldest ${oldest} days` : 'Nothing overdue'} bad={data.overdue.length > 0} onClick={() => go('/invoices?f=overdue')} />
        <Kpi label={`Paid in ${year}`} value={money(data.paidYtd, { cents: false })} sub="Payments received" onClick={() => go('/reports')} />
        <Kpi label={`Expenses in ${year}`} value={money(data.expYtd, { cents: false })} sub={review.length ? `${review.length} receipts to review` : 'From your receipts'} onClick={() => go('/expenses')} />
      </div>

      <WhatsNew />

      <div className={`grid-2 attention-row ${toPay.length ? 'three' : ''}`}>
        <section className="card">
          <div className="card-head"><h2>Overdue</h2>{data.overdue.length > 0 && <a href="#/invoices?f=overdue" className="small">All overdue</a>}</div>
          {attention.length === 0 && <Empty icon="check" title="Nothing overdue" />}
          {attention.slice(0, 5).map((a) => (
            <button key={a.key} className="list-row" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => go(a.go)}>
              <span className="col" style={{ gap: 2 }}><b style={{ fontWeight: 500 }}>{a.title}</b><span className="small" style={{ color: a.bad ? 'var(--bad)' : 'var(--muted)' }}>{a.sub}</span></span>
              <span className="num">{money(a.amount)}</span>
            </button>
          ))}
        </section>

        <section className="card">
          <div className="card-head"><h2>Owed by client</h2>{data.owed.length > 5 && <a href="#/reports/unpaid" className="small">All {data.owed.length}</a>}</div>
          {data.owed.length === 0 && <Empty icon="cash" title="Nobody owes you anything" />}
          {data.owed.slice(0, 5).map((o) => (
            <button key={o.id} className="list-row" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => go(`/clients/${o.id}`)}>
              <span className="col" style={{ gap: 6 }}>
                <b style={{ fontWeight: 500 }}>{o.name}</b>
                <span style={{ height: 6, borderRadius: 3, background: 'var(--line-2)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${Math.max(3, (o.v / data.owed[0].v) * 100)}%` }} /></span>
              </span>
              <span className="num">{money(o.v)}</span>
            </button>
          ))}
        </section>

        {toPay.length > 0 && (
          <section className="card to-pay">
            <div className="card-head"><h2>To pay</h2><span className="num small muted">{money(toPaySum)}</span></div>
            {toPay.slice(0, 5).map((p) => {
              const late = p.due_date && p.due_date < today;
              const when = !p.due_date ? 'No due date' : late ? `${plural(daysBetween(p.due_date, today), 'day')} overdue` : p.due_date === today ? 'Due today' : `Due ${fmtShort(p.due_date)}`;
              return (
                <button key={p.id} className="list-row" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => go(`/expenses/crew?payout=${p.id}`)}>
                  <span className="col" style={{ gap: 2, minWidth: 0 }}>
                    <b className="ellip" style={{ fontWeight: 500 }}>{derived.crew[p.crew_id]?.name || 'Crew'}{p.source_number ? ` · #${p.source_number}` : ''}</b>
                    <span className="small" style={{ color: late ? 'var(--bad)' : p.due_date === today ? 'var(--warn)' : 'var(--muted)' }}>{when}</span>
                  </span>
                  <span className="num">{money(p.amount)}</span>
                </button>
              );
            })}
            {toPay.length > 5 && <a href="#/expenses/crew" className="small" style={{ padding: '10px 20px 14px' }}>All {toPay.length}</a>}
          </section>
        )}
      </div>

      <section className="card card-pad col forecast" style={{ gap: 14 }}>
        <div className="row between" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <div className="row" style={{ gap: 8 }} title={data.f.enough ? `Projected: ${moneyK(data.f.mid)} income − ${moneyK(data.fx.mid)} expenses by Dec 31. ${data.f.method === 'seasonal' ? `Follows ${year - 1}'s monthly pattern, scaled to ${year} so far.` : 'Based on your average month.'}` : undefined}><Icon name="reports" style={{ color: 'var(--accent)' }} /><h2>{year} year-end forecast</h2></div>
          {data.f.enough && data.f.growthPct != null && <Pill kind={data.f.growthPct >= 0 ? 'good' : 'overdue'}>{data.f.growthPct >= 0 ? '▲' : '▼'} {Math.abs(Math.round(data.f.growthPct))}%<span className="hide-sm">vs {year - 1}</span></Pill>}
        </div>
        {data.f.enough ? (
          <>
            <div className="forecast-body">
              <div className="col" style={{ gap: 4, minWidth: 0 }}>
                <ForecastHeadline net={data.f.mid - data.fx.mid} growth={data.f.growthPct} />
                <div className="forecast-boxes">
                  <div><span>Net so far</span><b className="num">{moneyK(data.f.ytd - data.fx.ytd)}</b></div>
                  <div><span>Expenses so far</span><b className="num">{moneyK(data.fx.ytd)}</b></div>
                  <div><span>Likely income range</span><b className="num">{moneyK(data.f.low)}–{moneyK(data.f.high)}</b></div>
                </div>
              </div>
              <ForecastChart f={data.f} />
            </div>
          </>
        ) : (
          <p className="muted" style={{ lineHeight: 1.5 }}>Not enough history yet. After about 3 months of invoices — or once you import past invoices in Settings → Data — you'll see where the year is heading.</p>
        )}
      </section>

      <div className="grid-2">
        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-head"><div><h2>Money in vs. out</h2><p className="small muted">Last 12 months · invoiced (by invoice date) vs. expenses</p></div></div>
          <div style={{ padding: '0 20px 20px' }}>
            <MonthBars labels={data.labels} years={data.years} currentIndex={11} series={[{ name: 'Invoiced', color: 'var(--accent)', values: data.billed }, { name: 'Expenses', color: 'var(--expense)', values: data.exp }]} />
          </div>
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

// Short, friendly lines about where the year is heading. Upbeat when it's better than last year,
// plain when it's about the same or down. A different one shows each day.
const HEADLINES = {
  big: ['Big year! Heading for {amt} net', 'Crushing it: {amt} net by December', 'Your year is on fire: {amt} net', 'Way up from last year: {amt} net', 'What a year! {amt} net in sight'],
  up: ['Nice, ahead of last year: {amt} net', 'Trending up: {amt} net by December', 'Good momentum: {amt} net in sight', 'Better than last year: {amt} net'],
  steady: ['Steady year: {amt} net by December', 'Right on last year’s pace: {amt} net', 'Holding steady at {amt} net'],
  plain: ['Heading for {amt} net by December', 'On pace for {amt} net this year', '{amt} net expected by December'],
  red: ['Heading {amt} in the red this year', 'Expenses ahead of income by {amt}'],
};

function ForecastHeadline({ net, growth }) {
  const tier = net < 0 ? 'red' : growth >= 25 ? 'big' : growth >= 5 ? 'up' : growth != null && growth > -5 ? 'steady' : 'plain';
  const list = HEADLINES[tier];
  const day = Math.floor(Date.now() / 86400000); // a different line each day
  const [before, after] = list[day % list.length].split('{amt}');
  return (
    <div className="forecast-headline">
      {before}<span style={{ color: net >= 0 ? 'var(--accent)' : 'var(--bad)' }}>{moneyK(Math.abs(net))}</span>{after}
    </div>
  );
}

/** "Heads up": what to do next, what happened lately and what's coming up. A dot marks anything new since your last visit. */
function WhatsNew() {
  const { db, derived } = useStore();
  const today = todayISO();
  const items = useMemo(() => buildFeed({ db, derived, statusOf, today }), [db, derived, today]);
  // New = happened since you started using Heads up and not tapped yet. New ones sit on top until you tap them.
  const [since] = useState(() => {
    try { const v = localStorage.getItem('wrap_feed_since'); if (v) return v; const now = new Date().toISOString(); localStorage.setItem('wrap_feed_since', now); return now; } catch { return new Date().toISOString(); }
  });
  const [read, setRead] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('wrap_feed_read')) || []); } catch { return new Set(); } });
  const markRead = (keys) => {
    const next = new Set([...read, ...keys]);
    setRead(next);
    try { localStorage.setItem('wrap_feed_read', JSON.stringify([...next].slice(-300))); } catch { /* not saved */ }
  };
  // Price checks go away once you've tapped them (you've had a look).
  const [gone, setGone] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('wrap_feed_gone')) || []); } catch { return new Set(); } });
  const dismiss = (key) => {
    const next = new Set([...gone, key]);
    setGone(next);
    try { localStorage.setItem('wrap_feed_gone', JSON.stringify([...next].slice(-300))); } catch { /* not saved */ }
  };
  const [all, setAll] = useState(false);
  const visible = items.filter((x) => !(x.dismiss && gone.has(x.key)));
  if (!visible.length) return null;
  const isNew = (x) => x.at && x.at > since && !read.has(x.key);
  const fresh = visible.filter(isNew);
  const ordered = [...fresh.sort((a, b) => String(b.at).localeCompare(String(a.at))), ...visible.filter((x) => !isNew(x))];
  const shown = all ? ordered : ordered.slice(0, Math.max(6, fresh.length));
  return (
    <section className="card feed">
      <div className="card-head"><h2>Heads up{fresh.length > 0 && <button type="button" className="count-badge on" style={{ marginLeft: 8 }} onClick={() => markRead(fresh.map((x) => x.key))} title="Mark all as read" aria-label={`${fresh.length} new — mark all as read`}>{fresh.length}</button>}</h2></div>
      <div className="feed-list">
        {shown.map((x) => (
          <button key={x.key} type="button" className={`feed-row ${isNew(x) ? 'is-new' : ''}`} onClick={() => { if (isNew(x)) markRead([x.key]); if (x.dismiss) dismiss(x.key); go(x.go); }}>
            <span className={`feed-icon tone-${x.tone}`}><Icon name={x.icon} size={16} /></span>
            <span className="col" style={{ gap: 1, minWidth: 0 }}>
              <b className="ellip">{x.title}</b>
              <span className="small muted ellip">{x.sub}</span>
            </span>
            <span className="feed-when">{isNew(x) && <i className="feed-dot" aria-label="New" />}{x.when}</span>
          </button>
        ))}
      </div>
      {ordered.length > shown.length || all ? (
        <button type="button" className="feed-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          <Icon name="chevD" size={16} style={{ transform: all ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          {all ? 'Less' : `${ordered.length - shown.length} more`}
        </button>
      ) : null}
    </section>
  );
}
