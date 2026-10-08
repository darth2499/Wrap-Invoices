import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { useStore } from '../store.jsx';
import { Button, Empty, Field, MoneyInput, Seg, Icon } from '../components/ui.jsx';
import { MonthBars, MONTHS } from '../components/charts.jsx';
import { lineFor } from '../lib/categories.js';
import { statusOf } from '../lib/calc.js';
import { money, fmtDate, fmtLong, num, todayISO, daysBetween, round2 } from '../lib/format.js';
import { toCSV, downloadBlob, receiptFileName, extFor } from '../lib/files.js';
import { go } from '../router.js';

const TABS = [
  { value: 'overview', label: 'Profit & loss' },
  { value: 'unpaid', label: 'Unpaid' },
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
  const [year, setYear] = useState(thisYear);
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
      {tab === 'quarterly' && <Quarterly year={year} />}
      {tab === '1099' && <Ten99 year={year} />}
      {tab === 'export' && <TaxExport year={year} />}
    </div>
  );
}

function ProfitLoss({ year }) {
  const d = useYearData(year);
  const [basis, setBasis] = useState('cash');
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
  const inRange = (dt, p) => dt && dt >= p.from && dt <= p.to;
  const rows = periods.map((p) => {
    const income = d.payments.filter((x) => inRange(x.paid_on, p)).reduce((t, x) => t + num(x.amount), 0);
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
          <MoneyInput value={pct} onChange={(v) => s.updateProfile({ tax_set_aside_pct: v })} />
        </Field>
        {next && <div className="card card-pad" style={{ padding: '12px 16px' }}><span className="muted small">Next federal due date</span><div style={{ fontWeight: 600 }}>{fmtLong(next.due)} · {next.label} ({next.months}) · set aside {money(next.setAside, { cents: false })}</div></div>}
      </div>
      <section className="card">
        <table className="table">
          <thead><tr><th>Period</th><th>Federal due</th><th className="right">Income received</th><th className="right">Expenses</th><th className="right">Profit</th><th className="right">Set aside ({pct}%)</th></tr></thead>
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
      </section>
      <p className="small muted">California estimated payments follow their own schedule (April, June and January — no September payment). Self-employment tax applies on top of income tax.</p>
    </>
  );
}

function Ten99({ year }) {
  const s = useStore();
  const { db, derived } = s;
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
    const receipts = toCSV([...d.receipts].sort((a, b) => (a.receipt_date < b.receipt_date ? -1 : 1)), [
      { label: 'Date', get: 'receipt_date' }, { label: 'Vendor', get: 'vendor' }, { label: 'Category', get: 'category' },
      { label: 'Schedule C line', get: (r) => (r.category ? lineFor(r.category) : '') }, { label: 'Amount', get: (r) => num(r.total).toFixed(2) },
      { label: 'Billed to client', get: (r) => (r.billable ? `Invoice #${derived.invoices[r.invoice_id]?.number}` : '') }, { label: 'Notes', get: 'notes' },
      { label: 'File', get: (r) => (r.file_key ? `receipts/${receiptFileName(r, extFor(r.mime, 'jpg'))}` : '') },
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
      const zip = new JSZip();
      zip.file(`${year} summary by Schedule C line.csv`, c.summary);
      zip.file(`${year} income received.csv`, c.income);
      zip.file(`${year} invoices.csv`, c.invoices);
      zip.file(`${year} expenses (receipts).csv`, c.receipts);
      if (d.trips.length) zip.file(`${year} mileage log.csv`, c.mileage);
      if (d.crew.length) zip.file(`${year} crew payouts.csv`, c.crew);
      const withFiles = d.receipts.filter((r) => r.file_key);
      const urls = await s.api.files.urls(withFiles.map((r) => r.file_key));
      const folder = zip.folder('receipts');
      let n = 0;
      for (const r of withFiles) {
        setBusy(`Receipts ${++n}/${withFiles.length}`);
        try {
          const blob = await (await fetch(urls[r.file_key])).blob();
          folder.file(receiptFileName(r, extFor(r.mime, 'jpg')), blob);
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

