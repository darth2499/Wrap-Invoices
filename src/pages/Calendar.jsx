// Shoot calendar: every day you worked (from invoice line dates), so you can see where each invoice lands.
import { useEffect, useMemo, useState } from 'react';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { useStore } from '../store.jsx';
import { Button, Icon, Modal, MonthGrid, Popover, Seg, StatusPill } from '../components/ui.jsx';
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
  const [jump, setJump] = useState(false); // month/year picker
  const [jumpYear, setJumpYear] = useState(() => Number(today.slice(0, 4)));
  const [day, setDay] = useState(null); // the day you tapped: { date, items, i }
  const [view, setView] = useState(() => { try { return localStorage.getItem('wrap_cal_view') || 'shoots'; } catch { return 'shoots'; } });
  const pickView = (v) => { setView(v); try { localStorage.setItem('wrap_cal_view', v); } catch { /* not saved */ } };

  const byDate = useMemo(() => {
    const map = {};
    const entries = view === 'shoots'
      ? shootDays(db.invoices, derived.linesFor)
      : db.invoices.filter((i) => i.status !== 'void' && i.issue_date).map((i) => ({ date: i.issue_date, invoiceId: i.id, label: derived.clients[i.client_id]?.name || `#${i.number}` }));
    for (const s of entries) {
      const inv = derived.invoices[s.invoiceId];
      if (!inv) continue;
      // Several lines of one invoice on the same day (e.g. Sound Mixer + Sound Gear) show as one entry.
      const day = (map[s.date] ||= []);
      const same = day.find((x) => x.inv.id === inv.id);
      if (same) {
        if (s.item && !same.items.includes(s.item)) same.items.push(s.item);
        if (!same.labels.includes(s.label)) same.labels.push(s.label);
        continue;
      }
      const st = inv.kind === 'quote' ? { key: 'draft', label: 'Quote' } : statusOf(inv, derived.paidFor(inv.id), today);
      day.push({ ...s, inv, st, items: s.item ? [s.item] : [], labels: [s.label], client: derived.clients[inv.client_id]?.name || '' });
    }
    for (const list of Object.values(map)) for (const x of list) { x.label = x.labels.join(' · '); x.what = x.items.join('/'); }
    // Bills you need to pay, in their own color: on their invoice date (Invoice dates) or when they're due (Shoot days).
    for (const p of db.crew_payouts) {
      const at = view === 'issued' ? (p.source_key || p.source_token ? p.source_detail?.issue_date || p.work_date : p.due_date) : p.due_date;
      if (!at) continue;
      const name = derived.crew?.[p.crew_id]?.name || 'Crew';
      (map[at] ||= []).push({ payout: p, label: `Pay ${name}`, name, st: { key: p.paid_on ? 'paid' : 'pay' } });
    }
    return map;
  }, [db.invoices, db.crew_payouts, derived, today, view]);

  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: days }, (_, i) => `${ym}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const shift = (k) => { const d = new Date(y, m - 1 + k, 1); setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); };
  const monthDays = Object.keys(byDate).filter((d) => d.startsWith(ym)).length;
  // Tap a day to see its invoice right here (several on one day: switch between them).
  const open = (date, items) => setDay({ date, items, i: 0 });


  return (
    <div className="page">
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="row cal-nav" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {/* Today keeps its spot even when hidden, so the arrows never move. */}
          <Button size="sm" style={{ visibility: ym === today.slice(0, 7) ? 'hidden' : 'visible' }} onClick={() => setYm(today.slice(0, 7))}>Today</Button>
          <Button variant="icon" icon="chevL" aria-label="Previous month" onClick={() => shift(-1)} />
          <Popover open={jump} setOpen={setJump} align="right" width={280}
            trigger={<button type="button" className="cal-title" style={{ width: 170, justifyContent: 'center' }} onClick={() => { setJumpYear(y); setJump((o) => !o); }} aria-expanded={jump} aria-label="Pick month and year">{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}<Icon name="chevD" size={14} /></button>}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <Button variant="ghost icon" icon="chevL" aria-label="Previous year" onClick={() => setJumpYear((v) => v - 1)} />
              <strong>{jumpYear}</strong>
              <Button variant="ghost icon" icon="chevR" aria-label="Next year" onClick={() => setJumpYear((v) => v + 1)} />
            </div>
            <MonthGrid year={jumpYear} month={jumpYear === y ? m - 1 : -1} onPick={(mm) => { setYm(`${jumpYear}-${pad(mm + 1)}`); setJump(false); }} />
          </Popover>
          <Button variant="icon" icon="chevR" aria-label="Next month" onClick={() => shift(1)} />
        </div>
      </div>

      <Seg value={view} onChange={pickView} label="Show" options={[{ value: 'shoots', label: 'Shoot days' }, { value: 'issued', label: 'Invoice dates' }]} />
      <section className="card scal" aria-label={`${monthDays} shoot days`}>
        <div className="scal-grid scal-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="scal-grid">
          {cells.map((d, i) => {
            if (!d) return <span key={i} className="cal-blank" />;
            const items = byDate[d] || [];
            if (!items.length) return <span key={d} className={`cal-cell ${d === today ? 'today' : ''}`}><span className="cal-num">{Number(d.slice(8))}</span></span>;
            return (
              <button type="button" key={d} className={`cal-cell has ${d === today ? 'today' : ''}`} onClick={() => open(d, items)} aria-label={`${d}: ${items.length ? items.map((x) => (x.payout ? x.label : `${x.label} (#${x.inv.number})`)).join(', ') : 'no shoots'}`}>
                <span className="cal-num">{Number(d.slice(8))}</span>
                <span className="cal-chips">
                  {items.slice(0, 3).map((x, k) => (
                    <span key={k} className={`cal-chip st-${x.st.key}`}>{x.label}</span>
                  ))}
                  {items.length > 3 && <span className="cal-more d-more">+{items.length - 3}</span>}
                  {items.length > 2 && <span className="cal-more m-more">+{items.length - 2}</span>}
                </span>
                <span className="cal-dots">{items.slice(0, 4).map((x, k) => <i key={k} className={`st-${x.st.key}`} />)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {day && <DayPreview day={day} setDay={setDay} />}
    </div>
  );
}

/** The tapped day's invoice, shown over the calendar, with a way to open or edit it. */
function DayPreview({ day, setDay }) {
  const s = useStore();
  const { db, derived } = s;
  const x = day.items[day.i];
  const inv = x.inv || {};
  const [logoUrl, setLogoUrl] = useState(null);
  useEffect(() => { if (db.profile.logo_key) s.api.files.urls([db.profile.logo_key]).then((u) => setLogoUrl(u[db.profile.logo_key])).catch(() => {}); }, [db.profile.logo_key]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => setDay(null);
  const when = new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const tabs = day.items.length > 1 && (
    <div className="row wrap" style={{ gap: 6 }}>
      {day.items.map((it, k) => (
        <button key={k} type="button" className={`ed-opt ${k === day.i ? 'on' : ''}`} onClick={() => setDay({ ...day, i: k })}>{it.payout ? it.label : `#${it.inv.number} ${it.client || it.label}${it.what ? ` · ${it.what}` : ''}`}</button>
      ))}
    </div>
  );
  if (x.payout) {
    const p = x.payout;
    return (
      <Modal title={when} onClose={close} footer={<>
        {p.source_token && <Button icon="link" onClick={() => window.open(`#/i/${p.source_token}`, '_blank', 'noopener')}>Their invoice</Button>}
        {!p.paid_on && <Button icon="check" onClick={async () => { await s.update('crew_payouts', p.id, { paid_on: todayISO() }); close(); }}>Paid today</Button>}
        <Button variant="primary" onClick={() => go(`/expenses/crew?payout=${p.id}`)}>Open</Button>
      </>}>
        {tabs}
        <div className="row between" style={{ gap: 10 }}>
          <span className="col" style={{ gap: 2, minWidth: 0 }}><b className="ellip">{x.label}</b><span className="small muted ellip">{p.description || 'Payout'}</span></span>
          <span className="col" style={{ alignItems: 'flex-end', gap: 4 }}><span className="num" style={{ fontSize: 18 }}>{money(p.amount)}</span><span className={`pill ${p.paid_on ? 'paid' : p.due_date < todayISO() ? 'overdue' : 'sent'}`}>{p.paid_on ? 'Paid' : p.due_date < todayISO() ? 'Overdue' : 'To pay'}</span></span>
        </div>
      </Modal>
    );
  }
  return (
    <Modal wide title={when} onClose={close} footer={<>
      {inv.status !== 'void' && <Button icon="edit" onClick={() => go(`/invoices/${inv.id}/edit`)}>Edit</Button>}
      <Button variant="primary" onClick={() => go(`/invoices/${inv.id}`)}>Open {inv.kind === 'quote' ? 'quote' : 'invoice'}</Button>
    </>}>
      {tabs}
      <div className="row between" style={{ gap: 10 }}>
        <span className="row" style={{ gap: 8, minWidth: 0 }}><b className="ellip">#{inv.number}{x.client ? ` · ${x.client}` : ''}{x.what ? ` · ${x.what}` : ''}</b><StatusPill st={x.st} /></span>
        <span className="num muted">{money(inv.total)}</span>
      </div>
      <InvoiceDoc business={db.profile} invoice={inv} client={derived.clients[inv.client_id]} lines={derived.linesFor(inv.id)} payments={db.payments.filter((p) => p.invoice_id === inv.id)} logoUrl={logoUrl} />
    </Modal>
  );
}
