// Taxes: everything you type into a tax site (e.g. FreeTaxUSA), ready to copy one value at a time.
//   Income = what you billed each client that year. Expenses = description · date (MM/DD/YYYY) · cost, by category.
//   Every value you copy is ticked off; a row turns green once all of it is copied. Progress is kept per year on this device.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Icon, Seg } from '../components/ui.jsx';
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

/** A value you click to copy. Ticked once copied. */
function Copy({ text, children, className = '', label, copied, onCopied }) {
  const [flash, setFlash] = useState(false);
  return (
    <button type="button" className={`copy-cell ${copied ? 'copied' : ''} ${flash ? 'done' : ''} ${className}`} aria-label={`Copy ${label || text}`}
      onClick={async () => { await copyText(text); onCopied?.(); setFlash(true); setTimeout(() => setFlash(false), 900); }}>
      <span className="copy-val">{children ?? text}</span>
      <Icon name={copied || flash ? 'check' : 'copy'} size={14} />
    </button>
  );
}

function useProgress(year) {
  const key = `wrap_tax_${year}`;
  const [p, setP] = useState({});
  useEffect(() => { try { setP(JSON.parse(localStorage.getItem(key)) || {}); } catch { setP({}); } }, [key]);
  const save = (next) => { setP(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* not saved */ } };
  return {
    has: (row, cell) => (p[row] || []).includes(cell),
    mark: (row, cell) => !(p[row] || []).includes(cell) && save({ ...p, [row]: [...(p[row] || []), cell] }),
    setRow: (row, cells) => save({ ...p, [row]: cells }),
    rowDone: (row, cells) => cells.every((c) => (p[row] || []).includes(c)),
    reset: () => save({}),
    any: Object.keys(p).length > 0,
  };
}

export default function Taxes() {
  const s = useStore();
  const { db, derived } = s;
  const years = useMemo(() => {
    const now = Number(todayISO().slice(0, 4));
    const ys = new Set([now - 1, now]);
    for (const i of db.invoices) if (i.issue_date) ys.add(Number(i.issue_date.slice(0, 4)));
    for (const r of db.receipts) if (r.receipt_date) ys.add(Number(r.receipt_date.slice(0, 4)));
    return [...ys].sort((a, b) => b - a);
  }, [db.invoices, db.receipts]);
  // Remembers the year you picked (on this device).
  const [year, setYearState] = useState(() => {
    try { const v = Number(localStorage.getItem('wrap_tax_year')); if (v > 2000) return v; } catch { /* default */ }
    return Number(todayISO().slice(0, 4)) - (Number(todayISO().slice(5, 7)) <= 10 ? 1 : 0);
  });
  const setYear = (v) => { setYearState(v); try { localStorage.setItem('wrap_tax_year', String(v)); } catch { /* not saved */ } };
  const [tab, setTab] = useState('income');
  const [open, setOpen] = useState(() => new Set());
  const prog = useProgress(year);
  const y = String(year);

  // Billed that year: every sent/paid invoice by its invoice date (drafts and voided ones don't count).
  const income = useMemo(() => {
    const by = {};
    for (const inv of db.invoices) {
      if (inv.kind !== 'invoice' || ['draft', 'void'].includes(inv.status) || !inv.issue_date?.startsWith(y)) continue;
      const c = derived.clients[inv.client_id];
      const k = c?.id || 'none';
      (by[k] ||= { key: `c:${k}`, name: c?.name || 'No client', amount: 0, count: 0 });
      by[k].amount += num(inv.total);
      by[k].count += 1;
    }
    return Object.values(by).sort((a, b) => b.amount - a.amount);
  }, [db.invoices, derived, y]);

  const groups = useMemo(() => {
    const rows = [
      ...db.receipts.filter((r) => r.receipt_date?.startsWith(y) && num(r.total) !== 0)
        .map((r) => ({ key: `r:${r.id}`, desc: [r.vendor, r.notes].filter(Boolean).join(' – ') || 'Expense', date: r.receipt_date, cost: num(r.total), cat: r.category || 'Uncategorized' })),
      ...db.crew_payouts.filter((p) => (p.paid_on || p.work_date)?.startsWith(y))
        .map((p) => ({ key: `p:${p.id}`, desc: `${derived.crew?.[p.crew_id]?.name || 'Crew'}${p.description ? ` – ${p.description}` : ''}`, date: p.paid_on || p.work_date, cost: num(p.amount), cat: 'Contract labor' })),
    ];
    const g = {};
    for (const r of rows) (g[r.cat] ||= []).push(r);
    return Object.entries(g)
      .map(([cat, list]) => ({ cat, line: lineFor(cat, db.profile), list: list.sort((a, b) => a.date.localeCompare(b.date)), total: list.reduce((t, r) => t + r.cost, 0) }))
      .sort((a, b) => b.total - a.total);
  }, [db.receipts, db.crew_payouts, db.profile, derived, y]);

  const incomeTotal = income.reduce((t, r) => t + r.amount, 0);
  const expenseTotal = groups.reduce((t, g) => t + g.total, 0);
  const EXP = ['desc', 'date', 'cost'];
  const toggle = (cat) => setOpen((o) => { const n = new Set(o); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  return (
    <div className="page taxes">
      <div className="page-head">
        <h1>Taxes</h1>
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          {prog.any && <Button size="sm" variant="ghost" icon="history" onClick={async () => { if (await s.confirm({ title: `Start ${year} over?`, body: 'Clears every tick on this page for this year.', ok: 'Reset' })) prog.reset(); }}>Reset</Button>}
          <select className="input" style={{ width: 110 }} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tax year">
            {years.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="tax-sum">
        <div><span>Billed</span><Copy text={plain(incomeTotal)} label="total billed">{money(incomeTotal)}</Copy></div>
        <div><span>Expenses</span><Copy text={plain(expenseTotal)} label="total expenses">{money(expenseTotal)}</Copy></div>
        <div><span>Profit</span><Copy text={plain(incomeTotal - expenseTotal)} label="profit">{money(incomeTotal - expenseTotal)}</Copy></div>
      </div>

      <Seg value={tab} onChange={setTab} label="Section" options={[{ value: 'income', label: 'Income by client (1099)', count: income.length }, { value: 'expenses', label: 'Expenses', count: groups.reduce((t, g) => t + g.list.length, 0) }]} />

      {tab === 'income' && (
        <section className="card tax-table">
          <div className="tax-row tax-head"><span /><span>Client / payer</span><span className="r">Billed in {year}</span><span /></div>
          {income.map((r, i) => {
            const done = prog.rowDone(r.key, ['name', 'amt']);
            return (
              <div key={r.key} className={`tax-row ${done ? 'row-done' : ''}`}>
                <span className="tax-idx">{i + 1}</span>
                <Copy text={r.name} className="tax-name" copied={prog.has(r.key, 'name')} onCopied={() => prog.mark(r.key, 'name')} />
                <Copy text={plain(r.amount)} className="r num" label={`${r.name} amount`} copied={prog.has(r.key, 'amt')} onCopied={() => prog.mark(r.key, 'amt')}>{money(r.amount)}</Copy>
                <RowCheck done={done} onClick={() => prog.setRow(r.key, done ? [] : ['name', 'amt'])} />
              </div>
            );
          })}
          {!income.length && <div className="tax-empty">—</div>}
        </section>
      )}

      {tab === 'expenses' && (
        <div className="col" style={{ gap: 10 }}>
          {groups.map((g) => {
            const doneRows = g.list.filter((r) => prog.rowDone(r.key, EXP)).length;
            const allDone = doneRows === g.list.length;
            const isOpen = open.has(g.cat);
            return (
              <section key={g.cat} className={`card tax-cat ${allDone ? 'cat-done' : ''} ${isOpen ? 'open' : ''}`}>
                <div className="tax-cat-head">
                  <button type="button" className="tax-cat-toggle" onClick={() => toggle(g.cat)} aria-expanded={isOpen}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                    <span className="col" style={{ gap: 0, minWidth: 0 }}>
                      <strong>{g.cat}</strong>
                      <span className="small muted">Line {g.line} · <span className="num">{doneRows}/{g.list.length}</span></span>
                    </span>
                  </button>
                  <Copy text={plain(g.total)} className="r num tax-cat-total" label={`${g.cat} total`}>{money(g.total)}</Copy>
                </div>
                {isOpen && (
                  <div className="tax-cat-body">
                    <div className="tax-row tax-head exp"><span>Description</span><span>Date</span><span className="r">Cost</span><span /></div>
                    {g.list.map((r) => {
                      const done = prog.rowDone(r.key, EXP);
                      return (
                        <div key={r.key} className={`tax-row exp ${done ? 'row-done' : ''}`}>
                          <Copy text={r.desc} className="tax-name" copied={prog.has(r.key, 'desc')} onCopied={() => prog.mark(r.key, 'desc')} />
                          <Copy text={mdy(r.date)} className="num" copied={prog.has(r.key, 'date')} onCopied={() => prog.mark(r.key, 'date')} />
                          <Copy text={plain(r.cost)} className="r num" label={`${r.desc} cost`} copied={prog.has(r.key, 'cost')} onCopied={() => prog.mark(r.key, 'cost')}>{money(r.cost)}</Copy>
                          <RowCheck done={done} onClick={() => prog.setRow(r.key, done ? [] : EXP)} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          {!groups.length && <section className="card tax-empty">—</section>}
        </div>
      )}
    </div>
  );
}

/** Square tick at the end of a row: fills in when the row is done; tap to mark or unmark it. */
function RowCheck({ done, onClick }) {
  return (
    <button type="button" className={`row-check ${done ? 'on' : ''}`} onClick={onClick} aria-pressed={done} aria-label={done ? 'Mark as not done' : 'Mark as done'}>
      <Icon name="check" size={14} />
    </button>
  );
}
