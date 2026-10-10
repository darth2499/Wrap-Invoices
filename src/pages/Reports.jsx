import { useEffect, useMemo, useRef, useState } from 'react';
// jszip loads only when a zip is made or opened.
const loadZip = () => import('jszip').then((m) => m.default);
import { useStore } from '../store.jsx';
import { Button, Empty, Field, MoneyInput, Seg, Icon } from '../components/ui.jsx';
import { MonthBars, MONTHS } from '../components/charts.jsx';
import { lineFor } from '../lib/categories.js';
import { statusOf } from '../lib/calc.js';
import { money, fmtDate, fmtLong, num, todayISO, daysBetween, round2 } from '../lib/format.js';
import { toCSV, downloadBlob, receiptNames } from '../lib/files.js';
import { go } from '../router.js';
import { shootDays } from '../lib/shoots.js';
import { savingsFor, guessStateRate } from '../lib/taxEstimate.js';

const TABS = [
  { value: 'overview', label: 'Profit & loss' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'clients', label: 'Clients vs last year' },
  { value: 'quarterly', label: 'Quarterly taxes' },
  { value: '1099', label: '1099s' },
  { value: 'export', label: 'Tax export' },
];

function useYearData(year) {
  const { db, derived } = useStore();
  return useMemo(() => {
    const y = String(year);
    const payments = db.payments.filter((p) => p.paid_on?.startsWith(y));
    const invoices = db.invoices.filter((i) => i.kind === 'invoice' && !['draft', 'void'].includes(i.status) && i.issue_date?.startsWith(y));
    const receipts = db.receipts.filter((r) => r.receipt_date?.startsWith(y));
    const trips = db.mileage_trips.filter((t) => t.trip_date?.startsWith(y));
    const crew = db.crew_payouts.filter((p) => p.paid_on?.startsWith(y));
    const mileageAmt = trips.reduce((t, x) => t + num(x.miles) * (x.round_trip ? 2 : 1) * num(x.rate), 0);
    const byCat = {};
    for (const r of receipts) byCat[r.category || 'Uncategorized'] = (byCat[r.category || 'Uncategorized'] || 0) + num(r.total);
    if (mileageAmt) byCat['Car & truck (mileage)'] = (byCat['Car & truck (mileage)'] || 0) + mileageAmt;
    const crewAmt = crew.reduce((t, p) => t + num(p.amount), 0);
    if (crewAmt) byCat['Contract labor'] = (byCat['Contract labor'] || 0) + crewAmt;
    const monthOf = (d) => Number(d.slice(5, 7)) - 1;
    const incCash = Array(12).fill(0);
    const incAccrual = Array(12).fill(0);
    const exp = Array(12).fill(0);
    payments.forEach((p) => (incCash[monthOf(p.paid_on)] += num(p.amount)));
    invoices.forEach((i) => (incAccrual[monthOf(i.issue_date)] += num(i.total)));
    receipts.forEach((r) => (exp[monthOf(r.receipt_date)] += num(r.total)));
    trips.forEach((t) => (exp[monthOf(t.trip_date)] += num(t.miles) * (t.round_trip ? 2 : 1) * num(t.rate)));
    crew.forEach((p) => (exp[monthOf(p.paid_on)] += num(p.amount)));
    return { payments, invoices, receipts, trips, crew, byCat, incCash, incAccrual, exp, mileageAmt, crewAmt, derived };
  }, [db, derived, year]);
}

export default function Reports({ tab }) {
  const { db } = useStore();
  const thisYear = Number(todayISO().slice(0, 4));
  const [year, setYearState] = useState(() => { try { return Number(localStorage.getItem('wrap_rep_year')) || thisYear; } catch { return thisYear; } });
  const setYear = (v) => { setYearState(v); try { localStorage.setItem('wrap_rep_year', String(v)); } catch { /* not saved */ } };
  const years = [...new Set([thisYear, ...db.invoices.map((i) => Number(i.issue_date?.slice(0, 4))), ...db.receipts.map((r) => Number(r.receipt_date?.slice(0, 4)))].filter(Boolean))].sort((a, b) => b - a);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Reports</h1>
        {tab !== 'unpaid' && <select className="input" style={{ width: 110 }} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">{years.map((y) => <option key={y}>{y}</option>)}</select>}
      </div>
      <Seg value={tab} onChange={(t) => go(`/reports/${t}`)} options={TABS} label="Report" />
      {tab === 'overview' && <ProfitLoss year={year} />}
      {tab === 'unpaid' && <Unpaid />}
      {tab === 'clients' && <ClientsYoY year={year} />}
      {tab === 'quarterly' && <Quarterly year={year} />}
      {tab === '1099' && <Ten99 year={year} />}
      {tab === 'export' && <TaxExport year={year} />}
    </div>
  );
}

function ProfitLoss({ year }) {
  const d = useYearData(year);
  const [basis, setBasisState] = useState(() => { try { return localStorage.getItem('wrap_pl_basis') || 'cash'; } catch { return 'cash'; } });
  const setBasis = (v) => { setBasisState(v); try { localStorage.setItem('wrap_pl_basis', v); } catch { /* not saved */ } };
  const inc = basis === 'cash' ? d.incCash : d.incAccrual;
  const income = inc.reduce((a, b) => a + b, 0);
  const expenses = Object.values(d.byCat).reduce((a, b) => a + b, 0);
  const cats = Object.entries(d.byCat).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="row wrap between">
        <Seg value={basis} onChange={setBasis} label="Basis" options={[{ value: 'cash', label: 'Cash (money received)' }, { value: 'accrual', label: 'Invoiced' }]} />
        <span className="small muted">Most sole proprietors file on a cash basis.</span>
      </div>
      <div className="grid">
        <div className="card kpi"><span className="muted">Income</span><span className="v">{money(income, { cents: false })}</span></div>
        <div className="card kpi"><span className="muted">Expenses</span><span className="v">{money(expenses, { cents: false })}</span></div>
        <div className="card kpi"><span className="muted">Net profit</span><span className="v" style={{ color: income - expenses < 0 ? 'var(--bad)' : undefined }}>{money(income - expenses, { cents: false })}</span><span className="small muted">{income ? `${Math.round(((income - expenses) / income) * 100)}% margin` : ''}</span></div>
      </div>
      <section className="card card-pad"><MonthBars labels={MONTHS} series={[{ name: 'Income', color: 'var(--accent)', values: inc }, { name: 'Expenses', color: 'var(--expense)', values: d.exp }]} /></section>
      <section className="card">
        <div className="card-head"><h2>Expenses by tax category</h2><a href="#/reports/export" className="small">Export for taxes</a></div>
        {cats.length === 0 ? <Empty icon="receipt" title="No expenses this year" /> : (
          <table className="table">
            <thead><tr><th>Category</th><th>Schedule C line</th><th className="right">Amount</th></tr></thead>
            <tbody>
              {cats.map(([c, v]) => (
                <tr key={c}><td>{c}</td><td className="muted">{c === 'Car & truck (mileage)' ? '9' : c === 'Uncategorized' ? '—' : lineFor(c)}</td><td className="right num">{money(v)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2} style={{ fontWeight: 600, borderTop: '1px solid var(--line)' }}>Total</td><td className="right num" style={{ fontWeight: 600, borderTop: '1px solid var(--line)' }}>{money(expenses)}</td></tr></tfoot>
          </table>
        )}
      </section>
    </>
  );
}

function Unpaid() {
  const { db, derived } = useStore();
  const today = todayISO();
  const buckets = ['Not due yet', '1–30 days', '31–60 days', '61–90 days', '90+ days'];
  const rows = {};
  for (const i of db.invoices.filter((x) => x.kind === 'invoice' && x.status === 'sent')) {
    const due = num(i.total) - derived.paidFor(i.id);
    if (due <= 0) continue;
    const late = i.due_date ? daysBetween(i.due_date, today) : 0;
    const b = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    const k = i.client_id || 'none';
    rows[k] ||= { name: derived.clients[i.client_id]?.name || 'No client', id: i.client_id, b: [0, 0, 0, 0, 0], total: 0, invs: [] };
    rows[k].b[b] += due;
    rows[k].total += due;
    rows[k].invs.push({ ...i, due, late });
  }
  const list = Object.values(rows).sort((a, b) => b.total - a.total);
  const col = (n) => list.reduce((t, r) => t + r.b[n], 0);
  return (
    <section className="card">
      {list.length === 0 ? <Empty icon="check" title="Nothing unpaid" /> : (
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 760 }}>
            <thead><tr><th>Client</th>{buckets.map((b) => <th key={b} className="right">{b}</th>)}<th className="right">Total</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.name} className="click" onClick={() => r.id && go(`/clients/${r.id}`)}>
                  <td style={{ fontWeight: 500 }}>{r.name}<div className="small muted">{r.invs.map((i) => `#${i.number}`).join(', ')}</div></td>
                  {r.b.map((v, n) => <td key={n} className="right num" style={{ color: v && n >= 2 ? 'var(--bad)' : v ? undefined : 'var(--faint)' }}>{v ? money(v) : '—'}</td>)}
                  <td className="right num" style={{ fontWeight: 600 }}>{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td style={{ fontWeight: 600, borderTop: '1px solid var(--line)' }}>Total</td>{buckets.map((b, n) => <td key={b} className="right num" style={{ borderTop: '1px solid var(--line)' }}>{money(col(n))}</td>)}<td className="right num" style={{ fontWeight: 600, borderTop: '1px solid var(--line)' }}>{money(list.reduce((t, r) => t + r.total, 0))}</td></tr></tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function Quarterly({ year }) {
  const s = useStore();
  const d = useYearData(year);
  const pct = num(s.db.profile.tax_set_aside_pct) || 25;
  const today = todayISO();
  const periods = [
    { label: 'Q1', from: `${year}-01-01`, to: `${year}-03-31`, due: `${year}-04-15`, months: 'Jan – Mar' },
    { label: 'Q2', from: `${year}-04-01`, to: `${year}-05-31`, due: `${year}-06-15`, months: 'Apr – May' },
    { label: 'Q3', from: `${year}-06-01`, to: `${year}-08-31`, due: `${year}-09-15`, months: 'Jun – Aug' },
    { label: 'Q4', from: `${year}-09-01`, to: `${year}-12-31`, due: `${year + 1}-01-15`, months: 'Sep – Dec' },
  ];
  // Income by what you billed (invoice date) — or by what came in, if you prefer.
  const [basis, setBasisState] = useState(() => { try { return localStorage.getItem('wrap_q_basis') || 'billed'; } catch { return 'billed'; } });
  const setBasis = (v) => { setBasisState(v); try { localStorage.setItem('wrap_q_basis', v); } catch { /* not saved */ } };
  const inRange = (dt, p) => dt && dt >= p.from && dt <= p.to;
  const rows = periods.map((p) => {
    const income = basis === 'billed'
      ? d.invoices.filter((x) => inRange(x.issue_date, p)).reduce((t, x) => t + num(x.total), 0)
      : d.payments.filter((x) => inRange(x.paid_on, p)).reduce((t, x) => t + num(x.amount), 0);
    const exp = d.receipts.filter((x) => inRange(x.receipt_date, p)).reduce((t, x) => t + num(x.total), 0)
      + d.trips.filter((x) => inRange(x.trip_date, p)).reduce((t, x) => t + num(x.miles) * (x.round_trip ? 2 : 1) * num(x.rate), 0)
      + d.crew.filter((x) => inRange(x.paid_on, p)).reduce((t, x) => t + num(x.amount), 0);
    const net = income - exp;
    return { ...p, income, exp, net, setAside: Math.max(0, round2((net * pct) / 100)) };
  });
  const next = rows.find((r) => r.due >= today);
  return (
    <>
      <div className="banner info"><Icon name="sparkle" /><span>A planning helper, not tax advice. Set aside part of every payment so quarterly estimated taxes aren’t a surprise. Your tax preparer can tell you the right percentage and exact amounts.</span></div>
      <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        <Field label="Set aside this % of profit" style={{ width: 200 }}>
          <PercentInput value={pct} onSave={(v) => s.updateProfile({ tax_set_aside_pct: v })} />
        </Field>
        <Field label="Count income by">
          <Seg value={basis} onChange={setBasis} label="Count income by" options={[{ value: 'billed', label: 'Billed' }, { value: 'received', label: 'Received' }]} />
        </Field>
        {next && <div className="card card-pad" style={{ padding: '12px 16px' }}><span className="muted small">Next federal due date</span><div style={{ fontWeight: 600 }}>{fmtLong(next.due)} · {next.label} ({next.months}) · set aside {money(next.setAside, { cents: false })}</div></div>}
      </div>
      <section className="card">
        {/* Phones: one card per quarter (the six-column table doesn't fit). */}
        <div className="m-list">
          {rows.map((r) => (
            <div key={r.label} className="m-card" style={{ background: next?.label === r.label ? 'var(--accent-bg)' : undefined, cursor: 'default' }}>
              <span className="who">{r.label} <span className="small muted">{r.months}</span></span>
              <span className="amt num">{money(r.setAside, { cents: false })}</span>
              <span className="meta">Due {fmtDate(r.due)} · {basis === 'billed' ? 'billed' : 'received'} {money(r.income, { cents: false })} · profit {money(r.net, { cents: false })}</span>
            </div>
          ))}
          <div className="row between small" style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}><span className="muted">Set aside for the year ({pct}%)</span><strong className="num">{money(rows.reduce((t, r) => t + r.setAside, 0), { cents: false })}</strong></div>
        </div>
        <div className="table-wrap d-only">
        <table className="table">
          <thead><tr><th>Period</th><th>Federal due</th><th className="right">{basis === 'billed' ? 'Billed' : 'Received'}</th><th className="right">Expenses</th><th className="right">Profit</th><th className="right">Set aside ({pct}%)</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} style={{ background: next?.label === r.label ? 'var(--accent-bg)' : undefined }}>
                <td><strong>{r.label}</strong> <span className="small muted">{r.months}</span></td>
                <td className="muted">{fmtDate(r.due)}</td>
                <td className="right num">{money(r.income, { cents: false })}</td>
                <td className="right num">{money(r.exp, { cents: false })}</td>
                <td className="right num">{money(r.net, { cents: false })}</td>
                <td className="right num" style={{ fontWeight: 600 }}>{money(r.setAside, { cents: false })}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={2} style={{ fontWeight: 600, borderTop: '1px solid var(--line)' }}>Year</td><td className="right num" style={{ borderTop: '1px solid var(--line)' }}>{money(rows.reduce((t, r) => t + r.income, 0), { cents: false })}</td><td className="right num" style={{ borderTop: '1px solid var(--line)' }}>{money(rows.reduce((t, r) => t + r.exp, 0), { cents: false })}</td><td className="right num" style={{ borderTop: '1px solid var(--line)' }}>{money(rows.reduce((t, r) => t + r.net, 0), { cents: false })}</td><td className="right num" style={{ fontWeight: 600, borderTop: '1px solid var(--line)' }}>{money(rows.reduce((t, r) => t + r.setAside, 0), { cents: false })}</td></tr></tfoot>
        </table>
        </div>
      </section>
      <p className="small muted">California estimated payments follow their own schedule (April, June and January — no September payment). Self-employment tax applies on top of income tax.</p>
      <PurchaseSavings year={year} profitSoFar={rows.reduce((t, r) => t + r.net, 0)} />
    </>
  );
}

/**
 * A percent you can type freely (clear it, retype it) on any phone: it's saved a moment after you stop typing,
 * and only when it's a real number. Leaving it empty puts the saved value back.
 */
function PercentInput({ value, onSave, min = 0, max = 100 }) {
  const [text, setText] = useState(String(value ?? ''));
  const timer = useRef(null);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value ?? '')); }, [value]);
  const commit = (t) => {
    const n = Number(String(t).replace(',', '.'));
    if (t !== '' && Number.isFinite(n) && n >= min && n <= max && n !== Number(value)) onSave(n);
  };
  return (
    <span className="input-suffix">
      <input className="input num" type="text" inputMode="decimal" value={text}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, ''); setText(t); clearTimeout(timer.current); timer.current = setTimeout(() => commit(t), 700); }}
        onBlur={() => { focused.current = false; clearTimeout(timer.current); if (text === '') setText(String(value ?? '')); else commit(text); }} />
      <span className="suffix">%</span>
    </span>
  );
}

/** "How much would my taxes go down if I buy this?" — a rough 2026 estimate from this year's profit. */
function PurchaseSavings({ year, profitSoFar }) {
  const s = useStore();
  const today = todayISO();
  const thisYear = String(year) === today.slice(0, 4);
  // A full-year guess: this year's profit so far, stretched to 12 months (past years: what it was).
  const dayOfYear = thisYear ? Math.max(30, daysBetween(`${year}-01-01`, today) + 1) : 365;
  const guess = Math.max(0, Math.round((profitSoFar * 365) / dayOfYear / 100) * 100);
  const saved = (() => { try { return JSON.parse(localStorage.getItem('wrap_taxcalc')) || {}; } catch { return {}; } })();
  const [o, setO] = useState({ status: saved.status || 'single', other: saved.other ?? '', stateRate: saved.stateRate ?? guessStateRate(s.db.profile.address), profit: '' });
  const [price, setPrice] = useState('');
  const [kind, setKind] = useState('equipment');
  const [use, setUse] = useState(100);
  const set = (k, v) => setO((x) => {
    const next = { ...x, [k]: v };
    try { localStorage.setItem('wrap_taxcalc', JSON.stringify({ status: next.status, other: next.other, stateRate: next.stateRate })); } catch { /* not saved */ }
    return next;
  });
  const profit = o.profit === '' ? guess : num(o.profit);
  const deductible = num(price) * (kind === 'meal' ? 0.5 : 1) * Math.min(100, Math.max(0, num(use))) / 100;
  const r = savingsFor(deductible, profit, { status: o.status, other: num(o.other), stateRate: num(o.stateRate) });
  const cost = num(price) - r.total;
  return (
    <section className="card card-pad col" style={{ gap: 14 }}>
      <div className="col" style={{ gap: 2 }}>
        <h2>What would a purchase save?</h2>
        <span className="small muted">How much less tax you’d owe for {year} if you buy something for the business.</span>
      </div>
      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <Field label="It costs" style={{ flex: '1 1 140px' }}><MoneyInput value={price} onChange={setPrice} placeholder="2,000" /></Field>
        <Field label="Used for work" style={{ flex: '1 1 110px', maxWidth: 160 }}><PercentInput value={use} onSave={setUse} /></Field>
        <Seg value={kind} onChange={setKind} label="Kind of purchase" options={[{ value: 'equipment', label: 'Gear / other' }, { value: 'meal', label: 'A meal' }]} />
      </div>
      {num(price) > 0 && (
        <div className="savings">
          <div className="col" style={{ gap: 2 }}>
            <span className="muted small">Your taxes go down by about</span>
            <span className="num savings-big">{money(r.total, { cents: false })}</span>
            <span className="small muted">so it really costs you about <b className="num" style={{ color: 'var(--ink)' }}>{money(cost, { cents: false })}</b> ({Math.round(r.rate * (deductible / num(price)) * 100)}% back)</span>
          </div>
          <div className="savings-parts small">
            <span><span className="muted">Federal income tax</span><b className="num">{money(r.federal, { cents: false })}</b></span>
            <span><span className="muted">Self-employment tax</span><b className="num">{money(r.se, { cents: false })}</b></span>
            {num(o.stateRate) > 0 && <span><span className="muted">State ({num(o.stateRate)}%)</span><b className="num">{money(r.state, { cents: false })}</b></span>}
          </div>
        </div>
      )}
      <details className="savings-more">
        <summary className="small">Based on {money(profit, { cents: false })} profit for {year} · {o.status === 'married' ? 'married filing jointly' : 'single'}{num(o.stateRate) ? ` · ${num(o.stateRate)}% state` : ''}<Icon name="chevD" size={14} /></summary>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'end', marginTop: 10 }}>
          <Field label={`Profit for ${year}`} hint={thisYear ? '(guessed from so far)' : ''}><MoneyInput value={o.profit} onChange={(v) => set('profit', v)} placeholder={guess.toLocaleString('en-US')} /></Field>
          <Field label="Filing"><Seg value={o.status} onChange={(v) => set('status', v)} label="Filing status" options={[{ value: 'single', label: 'Single' }, { value: 'married', label: 'Married' }]} /></Field>
          <Field label="Other income" hint="(W-2, spouse)"><MoneyInput value={o.other} onChange={(v) => set('other', v)} placeholder="0" /></Field>
          <Field label="State tax"><PercentInput value={o.stateRate} onSave={(v) => set('stateRate', v)} /></Field>
        </div>
      </details>
      <p className="small muted" style={{ lineHeight: 1.5 }}>A rough estimate, not tax advice (2026 federal brackets, QBI deduction, self-employment tax). Gear is written off the year you buy it; meals count 50%. Spending $1 always saves less than $1, so it only pays off if you need it anyway.</p>
    </section>
  );
}

function Ten99({ year }) {
  const s = useStore();
  const { db } = s;
  const rows = db.clients.map((c) => {
    const ids = new Set(db.invoices.filter((i) => i.client_id === c.id).map((i) => i.id));
    const paid = db.payments.filter((p) => ids.has(p.invoice_id) && p.paid_on?.startsWith(String(year))).reduce((t, p) => t + num(p.amount), 0);
    const form = db.form1099.find((f) => f.client_id === c.id && f.tax_year === year);
    return { c, paid, form };
  }).filter((r) => r.paid > 0 || r.c.expects_1099 || r.form).sort((a, b) => b.paid - a.paid);
  const saveAmount = async (r, v) => {
    if (r.form) await s.update('form1099', r.form.id, { amount_reported: v });
    else await s.insert('form1099', { client_id: r.c.id, tax_year: year, amount_reported: v });
  };
  return (
    <>
      <p className="muted" style={{ lineHeight: 1.6 }}>What each client paid you in {year} (by payment date). When their 1099-NEC arrives, type in the amount to check it matches. Report all income — even from clients who don’t send a 1099.</p>
      <section className="card">
        {rows.length === 0 ? <Empty icon="file" title={`No payments in ${year}`} /> : (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 640 }}>
              <thead><tr><th>Client</th><th className="right">You received</th><th>1099 expected</th><th style={{ width: 160 }}>Amount on their 1099</th><th className="right">Difference</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const rep = r.form?.amount_reported;
                  const diff = rep != null ? round2(num(rep) - r.paid) : null;
                  return (
                    <tr key={r.c.id}>
                      <td style={{ fontWeight: 500 }}>{r.c.name}</td>
                      <td className="right num">{money(r.paid)}</td>
                      <td><label className="check" style={{ minHeight: 0 }}><input type="checkbox" checked={r.c.expects_1099} onChange={(e) => s.update('clients', r.c.id, { expects_1099: e.target.checked })} />{r.c.expects_1099 ? 'Yes' : 'No'}</label></td>
                      <td><MoneyInput value={rep ?? ''} placeholder="—" onBlur={(e) => { const v = e.target.value === '' ? null : num(e.target.value); if (v !== (rep ?? null)) saveAmount(r, v); }} onChange={() => {}} /></td>
                      <td className="right num" style={{ color: diff ? 'var(--bad)' : 'var(--good)' }}>{diff == null ? '' : diff === 0 ? 'Matches' : money(diff, { sign: true })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="small muted">Clients generally only have to send a 1099-NEC above a minimum amount for the year, so you may not get one from everyone. A mismatch often means a payment was made in a different year than it was invoiced.</p>
    </>
  );
}

function TaxExport({ year }) {
  const s = useStore();
  const d = useYearData(year);
  const [busy, setBusy] = useState('');
  const { derived } = s;
  const csvs = () => {
    const names = receiptNames(d.receipts.filter((r) => r.file_key));
    const receipts = toCSV([...d.receipts].sort((a, b) => (a.receipt_date < b.receipt_date ? -1 : 1)), [
      { label: 'Date', get: 'receipt_date' }, { label: 'Vendor', get: 'vendor' }, { label: 'Category', get: 'category' },
      { label: 'Schedule C line', get: (r) => (r.category ? lineFor(r.category) : '') }, { label: 'Amount', get: (r) => num(r.total).toFixed(2) },
      { label: 'Billed to client', get: (r) => (r.billable ? `Invoice #${derived.invoices[r.invoice_id]?.number}` : '') }, { label: 'Notes', get: 'notes' },
      { label: 'File', get: (r) => (names.has(r) ? `receipts/${names.get(r)}` : '') },
    ]);
    const income = toCSV([...d.payments].sort((a, b) => (a.paid_on < b.paid_on ? -1 : 1)), [
      { label: 'Date received', get: 'paid_on' }, { label: 'Invoice', get: (p) => derived.invoices[p.invoice_id]?.number },
      { label: 'Client', get: (p) => derived.clients[derived.invoices[p.invoice_id]?.client_id]?.name }, { label: 'Method', get: 'method' }, { label: 'Amount', get: (p) => num(p.amount).toFixed(2) },
    ]);
    const invoices = toCSV([...d.invoices].sort((a, b) => (a.issue_date < b.issue_date ? -1 : 1)), [
      { label: 'Number', get: 'number' }, { label: 'Date', get: 'issue_date' }, { label: 'Client', get: (i) => derived.clients[i.client_id]?.name },
      { label: 'Total', get: (i) => num(i.total).toFixed(2) }, { label: 'Paid', get: (i) => derived.paidFor(i.id).toFixed(2) }, { label: 'Status', get: (i) => statusOf(i, derived.paidFor(i.id)).label },
    ]);
    const mileage = toCSV(d.trips, [
      { label: 'Date', get: 'trip_date' }, { label: 'From', get: 'start_place' }, { label: 'To', get: 'end_place' }, { label: 'Purpose', get: 'purpose' },
      { label: 'Miles', get: (t) => num(t.miles) * (t.round_trip ? 2 : 1) }, { label: 'Rate', get: 'rate' }, { label: 'Deduction', get: (t) => (num(t.miles) * (t.round_trip ? 2 : 1) * num(t.rate)).toFixed(2) },
    ]);
    const crew = toCSV(d.crew, [
      { label: 'Paid on', get: 'paid_on' }, { label: 'Name', get: (p) => derived.crew[p.crew_id]?.name }, { label: 'For', get: 'description' }, { label: 'Amount', get: (p) => num(p.amount).toFixed(2) }, { label: 'Method', get: 'method' },
    ]);
    const income$ = d.payments.reduce((t, p) => t + num(p.amount), 0);
    const summaryRows = [
      { a: 'Gross receipts (income received)', b: '1', c: income$ },
      ...Object.entries(d.byCat).map(([k, v]) => ({ a: k, b: k === 'Car & truck (mileage)' ? '9' : k === 'Uncategorized' ? '' : lineFor(k), c: v })),
    ];
    const summary = toCSV(summaryRows, [{ label: 'Item', get: 'a' }, { label: 'Schedule C line', get: 'b' }, { label: 'Amount', get: (r) => num(r.c).toFixed(2) }]);
    return { receipts, income, invoices, mileage, crew, summary };
  };
  const pack = async () => {
    setBusy('zip');
    try {
      const c = csvs();
      const zip = new (await loadZip())();
      zip.file(`${year} summary by Schedule C line.csv`, c.summary);
      zip.file(`${year} income received.csv`, c.income);
      zip.file(`${year} invoices.csv`, c.invoices);
      zip.file(`${year} expenses (receipts).csv`, c.receipts);
      if (d.trips.length) zip.file(`${year} mileage log.csv`, c.mileage);
      if (d.crew.length) zip.file(`${year} crew payouts.csv`, c.crew);
      const withFiles = d.receipts.filter((r) => r.file_key);
      const names = receiptNames(withFiles);
      const urls = await s.api.files.urls(withFiles.map((r) => r.file_key));
      const folder = zip.folder('receipts');
      let n = 0;
      for (const r of withFiles) {
        setBusy(`Receipts ${++n}/${withFiles.length}`);
        try {
          const blob = await (await fetch(urls[r.file_key])).blob();
          folder.file(names.get(r), blob);
        } catch { /* skip missing file */ }
      }
      downloadBlob(await zip.generateAsync({ type: 'blob' }), `Taxes ${year} — ${s.db.profile.business_name || 'Wrap'}.zip`);
    } catch (e) {
      s.toast(e.message, { error: true });
    }
    setBusy('');
  };
  const one = (name, key) => downloadBlob(new Blob([csvs()[key]], { type: 'text/csv' }), `${year} ${name}.csv`);
  const unconfirmed = d.receipts.filter((r) => r.status === 'review').length;
  const uncategorized = d.receipts.filter((r) => !r.category).length;
  return (
    <>
      {(unconfirmed > 0 || uncategorized > 0) && <div className="banner warn">{unconfirmed > 0 && `${unconfirmed} receipts still need checking. `}{uncategorized > 0 && `${uncategorized} have no category. `}<a href="#/expenses?status=review">Review them</a> first for the cleanest export.</div>}
      <section className="card card-pad col" style={{ gap: 14 }}>
        <h2>Everything for your {year} taxes</h2>
        <p className="muted" style={{ lineHeight: 1.6 }}>One zip for your accountant: a summary by Schedule C line, income received, invoices, every expense with its receipt image, your mileage log and crew payouts.</p>
        <Button variant="primary" icon="zip" busy={!!busy} onClick={pack} style={{ alignSelf: 'flex-start' }}>{busy && busy !== 'zip' ? busy : `Download ${year} tax package`}</Button>
        <div className="row wrap" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
          <span className="small muted">Or just one CSV:</span>
          <Button size="sm" onClick={() => one('summary by Schedule C line', 'summary')}>Summary</Button>
          <Button size="sm" onClick={() => one('income received', 'income')}>Income</Button>
          <Button size="sm" onClick={() => one('expenses', 'receipts')}>Expenses</Button>
          <Button size="sm" onClick={() => one('invoices', 'invoices')}>Invoices</Button>
          <Button size="sm" onClick={() => one('mileage log', 'mileage')}>Mileage</Button>
          <Button size="sm" onClick={() => one('crew payouts', 'crew')}>Crew</Button>
        </div>
      </section>
    </>
  );
}


/**
 * Each client this year vs last year: what you billed and how many days you worked for them.
 * For the current year it compares to the same point last year (Jan 1 → today's date), so it's fair mid-year.
 */
function ClientsYoY({ year }) {
  const { db, derived } = useStore();
  const today = todayISO();
  const partial = String(year) === today.slice(0, 4);
  const cutoff = today.slice(5); // MM-DD
  const rows = useMemo(() => {
    const billed = db.invoices.filter((i) => i.kind === 'invoice' && !['draft', 'void'].includes(i.status) && i.issue_date);
    const inYear = (d, y) => d.startsWith(String(y)) && (!partial || d.slice(5) <= cutoff);
    const days = {};
    for (const sd of shootDays(billed, derived.linesFor)) {
      const inv = derived.invoices[sd.invoiceId];
      (days[`${inv.client_id}|${sd.date.slice(0, 4)}`] ||= new Set()).add(sd.date);
    }
    const by = {};
    for (const i of billed) {
      for (const [y, k] of [[year, 'now'], [year - 1, 'before']]) {
        if (!inYear(i.issue_date, y)) continue;
        const c = (by[i.client_id || 'none'] ||= { id: i.client_id, name: derived.clients[i.client_id]?.name || 'No client', now: 0, before: 0 });
        c[k] += num(i.total);
      }
    }
    return Object.values(by).map((c) => {
      const count = (y) => [...(days[`${c.id}|${y}`] || [])].filter((d) => !partial || d.slice(5) <= cutoff).length;
      return { ...c, daysNow: count(year), daysBefore: count(year - 1), diff: c.now - c.before };
    }).sort((a, b) => b.now + b.before - (a.now + a.before));
  }, [db.invoices, derived, year, partial, cutoff]);
  const hasBoth = rows.some((r) => r.now > 0) && rows.some((r) => r.before > 0);
  if (!hasBoth) return <section className="card"><Empty icon="clients" title={`Shows once you have invoices in both ${year - 1} and ${year}`} /></section>;
  const tot = rows.reduce((t, r) => ({ now: t.now + r.now, before: t.before + r.before }), { now: 0, before: 0 });
  const pct = (a, b) => (b > 0 ? `${a >= b ? '+' : '−'}${Math.abs(Math.round(((a - b) / b) * 100))}%` : a > 0 ? 'New' : '');
  const until = new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <section className="card">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Client</th><th className="right">{year - 1}{partial ? ` (to ${until})` : ''}</th><th className="right">{year}{partial ? ' so far' : ''}</th><th className="right">Change</th><th className="right">Days worked</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id || 'none'} className="click" onClick={() => r.id && go(`/clients/${r.id}`)}>
                <td style={{ fontWeight: 500 }}>{r.name}</td>
                <td className="right num muted">{money(r.before, { cents: false })}</td>
                <td className="right num">{money(r.now, { cents: false })}</td>
                <td className="right num" style={{ color: r.diff > 0 ? 'var(--good)' : r.diff < 0 ? 'var(--bad)' : 'var(--muted)' }}>{r.diff === 0 ? '—' : `${r.diff > 0 ? '+' : '−'}${money(Math.abs(r.diff), { cents: false })}`} <span className="small">{pct(r.now, r.before)}</span></td>
                <td className="right num">{r.daysBefore || r.daysNow ? <>{r.daysBefore} → <b>{r.daysNow}</b></> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td style={{ fontWeight: 600, borderTop: '1px solid var(--line)' }}>All clients</td><td className="right num" style={{ borderTop: '1px solid var(--line)' }}>{money(tot.before, { cents: false })}</td><td className="right num" style={{ fontWeight: 600, borderTop: '1px solid var(--line)' }}>{money(tot.now, { cents: false })}</td><td className="right num" style={{ borderTop: '1px solid var(--line)', color: tot.now >= tot.before ? 'var(--good)' : 'var(--bad)' }}>{pct(tot.now, tot.before)}</td><td style={{ borderTop: '1px solid var(--line)' }} /></tr></tfoot>
        </table>
      </div>
    </section>
  );
}
