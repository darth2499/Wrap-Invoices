// Shoot calendar: every day you worked (from invoice line dates), so you can see where each invoice lands.
import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Icon, Pill } from '../components/ui.jsx';
import { shootDays } from '../lib/shoots.js';
import { statusOf } from '../lib/calc.js';
import { money, todayISO } from '../lib/format.js';
import { go } from '../router.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');

export default function Calendar() {
  const { db, derived } = useStore();
  const today = todayISO();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [sel, setSel] = useState(today);

  const byDate = useMemo(() => {
    const map = {};
    for (const s of shootDays(db.invoices, derived.linesFor)) {
      const inv = derived.invoices[s.invoiceId];
      if (!inv) continue;
      const st = inv.kind === 'quote' ? { key: 'draft', label: 'Quote' } : statusOf(inv, derived.paidFor(inv.id), today);
      (map[s.date] ||= []).push({ ...s, inv, st, client: derived.clients[inv.client_id]?.name || '' });
    }
    return map;
  }, [db.invoices, derived, today]);

  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: days }, (_, i) => `${ym}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const shift = (k) => { const d = new Date(y, m - 1 + k, 1); setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); };
  const monthDays = Object.keys(byDate).filter((d) => d.startsWith(ym)).length;
  const list = byDate[sel] || [];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="row" style={{ gap: 6 }}>
          <Button variant="icon" icon="chev-left" aria-label="Previous month" onClick={() => shift(-1)} />
          <strong style={{ minWidth: 150, textAlign: 'center' }}>{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong>
          <Button variant="icon" icon="chev-right" aria-label="Next month" onClick={() => shift(1)} />
          {ym !== today.slice(0, 7) && <Button size="sm" onClick={() => { setYm(today.slice(0, 7)); setSel(today); }}>Today</Button>}
        </div>
      </div>

      <section className="card cal" aria-label={`${monthDays} shoot days`}>
        <div className="cal-grid cal-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="cal-grid">
          {cells.map((d, i) => {
            if (!d) return <span key={i} className="cal-cell empty" />;
            const items = byDate[d] || [];
            return (
              <button type="button" key={d} className={`cal-cell ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''} ${items.length ? 'has' : ''}`} onClick={() => setSel(d)} aria-label={`${d}: ${items.length ? items.map((x) => `${x.label} (#${x.inv.number})`).join(', ') : 'no shoots'}`}>
                <span className="cal-num">{Number(d.slice(8))}</span>
                <span className="cal-chips">
                  {items.slice(0, 3).map((x, k) => (
                    <span key={k} className={`cal-chip st-${x.st.key}`} onClick={(e) => { e.stopPropagation(); go(`/invoices/${x.inv.id}`); }}>{x.label}</span>
                  ))}
                  {items.length > 3 && <span className="cal-more">+{items.length - 3}</span>}
                </span>
                <span className="cal-dots">{items.slice(0, 4).map((x, k) => <i key={k} className={`st-${x.st.key}`} />)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {list.length > 0 && (
        <section className="card">
          <div className="m-list" style={{ display: 'flex' }}>
            {list.map((x, k) => (
              <button type="button" key={k} className="m-card cal-row" onClick={() => go(`/invoices/${x.inv.id}`)}>
                <span className="who">{x.label}</span>
                <span className="amt num">{money(x.inv.total)}</span>
                <span className="meta">{x.client} · #{x.inv.number}</span>
                <span className="st"><Pill kind={x.st.key}>{x.st.label}</Pill></span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
