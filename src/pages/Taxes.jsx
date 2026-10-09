// Taxes: everything you type into a tax site (e.g. FreeTaxUSA), ready to copy one value at a time.
//   1099 income per client, and every expense as description · date (MM/DD/YYYY) · cost.
import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { Icon, Seg } from '../components/ui.jsx';
import { money, num, todayISO } from '../lib/format.js';
import { lineFor } from '../lib/categories.js';

const mdy = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : '');
const plain = (n) => num(n).toFixed(2); // what tax sites accept: 1234.56

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); } catch {
    const ta = document.createElement('textarea');
    ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
}

/** A value you click to copy. A check mark flashes when it's on your clipboard. */
function Copy({ text, children, className = '', label }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={`copy-cell ${done ? 'done' : ''} ${className}`} aria-label={`Copy ${label || text}`}
      onClick={async () => { await copyText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      <span className="copy-val">{children ?? text}</span>
      <Icon name={done ? 'check' : 'copy'} size={14} />
    </button>
  );
}

export default function Taxes() {
  const { db, derived } = useStore();
  const years = useMemo(() => {
    const ys = new Set([Number(todayISO().slice(0, 4)) - 1, Number(todayISO().slice(0, 4))]);
    for (const p of db.payments) if (p.paid_on) ys.add(Number(p.paid_on.slice(0, 4)));
    for (const r of db.receipts) if (r.receipt_date) ys.add(Number(r.receipt_date.slice(0, 4)));
    return [...ys].sort((a, b) => b - a);
  }, [db.payments, db.receipts]);
  const [year, setYear] = useState(Number(todayISO().slice(0, 4)) - (Number(todayISO().slice(5, 7)) <= 10 ? 1 : 0));
  const [tab, setTab] = useState('income');
  const y = String(year);

  const income = useMemo(() => {
    const by = {};
    for (const p of db.payments) {
      if (!p.paid_on?.startsWith(y)) continue;
      const inv = derived.invoices[p.invoice_id];
      const c = inv && derived.clients[inv.client_id];
      const k = c?.id || 'none';
      (by[k] ||= { name: c?.name || 'No client', amount: 0, count: 0 });
      by[k].amount += num(p.amount);
      by[k].count += 1;
    }
    return Object.values(by).sort((a, b) => b.amount - a.amount);
  }, [db.payments, derived, y]);

  const expenses = useMemo(() => {
    const rows = [
      ...db.receipts.filter((r) => r.receipt_date?.startsWith(y) && num(r.total) !== 0)
        .map((r) => ({ id: r.id, desc: [r.vendor, r.notes].filter(Boolean).join(' – ') || 'Expense', date: r.receipt_date, cost: num(r.total), cat: r.category || 'Uncategorized' })),
      ...db.crew_payouts.filter((p) => (p.paid_on || p.work_date)?.startsWith(y))
        .map((p) => ({ id: p.id, desc: `${derived.crew?.[p.crew_id]?.name || 'Crew'}${p.description ? ` – ${p.description}` : ''}`, date: p.paid_on || p.work_date, cost: num(p.amount), cat: 'Contract labor' })),
    ];
    const groups = {};
    for (const r of rows) (groups[r.cat] ||= []).push(r);
    return Object.entries(groups)
      .map(([cat, list]) => ({ cat, line: lineFor(cat), list: list.sort((a, b) => a.date.localeCompare(b.date)), total: list.reduce((t, r) => t + r.cost, 0) }))
      .sort((a, b) => b.total - a.total);
  }, [db.receipts, db.crew_payouts, derived, y]);

  const incomeTotal = income.reduce((t, r) => t + r.amount, 0);
  const expenseTotal = expenses.reduce((t, g) => t + g.total, 0);

  return (
    <div className="page taxes">
      <div className="page-head">
        <h1>Taxes</h1>
        <select className="input" style={{ width: 110 }} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tax year">
          {years.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      <div className="tax-sum">
        <div><span>Income</span><Copy text={plain(incomeTotal)} label="total income">{money(incomeTotal)}</Copy></div>
        <div><span>Expenses</span><Copy text={plain(expenseTotal)} label="total expenses">{money(expenseTotal)}</Copy></div>
        <div><span>Profit</span><Copy text={plain(incomeTotal - expenseTotal)} label="profit">{money(incomeTotal - expenseTotal)}</Copy></div>
      </div>

      <Seg value={tab} onChange={setTab} label="Section" options={[{ value: 'income', label: 'Income by client (1099)', count: income.length }, { value: 'expenses', label: 'Expenses', count: expenses.reduce((t, g) => t + g.list.length, 0) }]} />

      {tab === 'income' && (
        <section className="card tax-table">
          <div className="tax-row tax-head"><span /><span>Client / payer</span><span className="r">Received in {year}</span></div>
          {income.map((r, i) => (
            <div key={r.name} className="tax-row">
              <span className="tax-idx">{i + 1}</span>
              <Copy text={r.name} className="tax-name" />
              <Copy text={plain(r.amount)} className="r num" label={`${r.name} amount`}>{money(r.amount)}</Copy>
            </div>
          ))}
          {!income.length && <div className="tax-empty">—</div>}
        </section>
      )}

      {tab === 'expenses' && expenses.map((g) => (
        <section key={g.cat} className="card tax-table">
          <div className="tax-group">
            <strong>{g.cat}</strong>
            <span className="muted small">Schedule C line {g.line}</span>
            <Copy text={plain(g.total)} className="r num" label={`${g.cat} total`}>{money(g.total)}</Copy>
          </div>
          <div className="tax-row tax-head exp"><span>Description</span><span>Date</span><span className="r">Cost</span></div>
          {g.list.map((r) => (
            <div key={r.id} className="tax-row exp">
              <Copy text={r.desc} className="tax-name" />
              <Copy text={mdy(r.date)} className="num" />
              <Copy text={plain(r.cost)} className="r num" label={`${r.desc} cost`}>{money(r.cost)}</Copy>
            </div>
          ))}
        </section>
      ))}
      {tab === 'expenses' && !expenses.length && <section className="card tax-empty">—</section>}
    </div>
  );
}
