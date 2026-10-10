import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Combobox, Field, Icon, Menu, Modal, MoneyInput, Seg, Switch, Calendar, Popover, Empty, DateInput } from '../components/ui.jsx';
import { totals, compileJobs, otRule, jobLabor, lineAmount } from '../lib/calc.js';
import { money, num, round2, todayISO, addDays, uid, datesLabel, datesCode, mmdd, fmtShort } from '../lib/format.js';
import { saveInvoice } from '../lib/actions.js';
import { datesFromCode } from '../lib/shoots.js';
import { suggestContext, rankReceipts } from '../lib/suggest.js';
import { go } from '../router.js';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { ClientModal } from './Clients.jsx';
import { rateFor } from '../lib/mileage.js';

const TERMS = [
  { label: 'Due on receipt', days: 0 },
  { label: 'Net 7', days: 7 },
  { label: 'Net 15', days: 15 },
  { label: 'Net 30', days: 30 },
  { label: 'Net 45', days: 45 },
  { label: 'Net 60', days: 60 },
];

const blankLine = (extra = {}) => ({ key: uid(), kind: 'labor', item: '', description: '', note: '', dates: [], qty: 1, rate: 0, base_rate: 0, tax_rate: 0, day_type: null, receipt_id: null, addons: [], ...extra });

/* Add-ons ride on a line (travel, per diem, hotel…) and roll into its total. */
const addonSum = (l) => (l.addons || []).reduce((t, a) => t + lineAmount(a.qty, a.rate), 0);
const lineTotal = (l) => round2(lineAmount(l.qty, l.rate) + addonSum(l));
const shortMoney = (n) => `$${num(n).toLocaleString('en-US', { minimumFractionDigits: num(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
/**
 * What the client sees for a line with add-ons: one line, one total, the breakdown in the description —
 *   Google (10/05)
 *   Travel ($375 x2)
 *   Hotel ($500.55)
 * The pieces are kept in `extras` so the line opens back up for editing.
 */
function compileLine(l) {
  if (!l.addons?.length) return { ...l, amount: lineAmount(l.qty, l.rate), extras: null };
  const total = lineTotal(l);
  const desc = [
    l.description || '',
    num(l.qty) !== 1 ? `${l.item || 'Base'} (${shortMoney(l.rate)} x${num(l.qty)})` : '',
    ...l.addons.map((a) => (a.unit === 'mi'
      ? `${a.label || 'Mileage'} (${num(a.qty)} mi x $${num(a.rate)})`
      : `${a.label || 'Other'} (${shortMoney(a.rate)}${num(a.qty) !== 1 ? ` x${num(a.qty)}` : ''})`)),
  ].filter(Boolean).join('\n');
  return {
    ...l, description: desc, qty: 1, rate: total, amount: total,
    extras: { desc: l.description || '', qty: num(l.qty), rate: num(l.rate), base_rate: num(l.base_rate) || num(l.rate), items: l.addons.map(({ label, qty, rate, unit, receipt_id }) => ({ label: label || '', qty: num(qty), rate: num(rate), ...(unit ? { unit } : {}), ...(receipt_id ? { receipt_id } : {}) })) },
  };
}
/** A saved line back into its editable pieces. */
function openLine(l) {
  const x = l.extras;
  if (!x || !Array.isArray(x.items)) return {};
  return { description: x.desc || '', qty: num(x.qty) || 1, rate: num(x.rate), base_rate: num(x.base_rate) || num(x.rate), addons: x.items.map((a) => ({ id: uid(), label: a.label, qty: num(a.qty) || 1, rate: num(a.rate), unit: a.unit || null, receipt_id: a.receipt_id || null })) };
}
/** Receipts billed on a line: the line itself, or any of its add-ons. */
const lineReceipts = (l) => [l.receipt_id, ...(l.addons || l.extras?.items || []).map((a) => a.receipt_id)].filter(Boolean);
const blankJob = (rate = 750, role = 'Camera Operator') => ({ id: uid(), company: '', role, rate, days: [], gear: [], expenses: [] });

export default function InvoiceEditor({ id, kind: kindProp = 'invoice', fromId, clientId }) {
  const s = useStore();
  const { db, derived } = s;
  const p = db.profile;
  const existing = id ? derived.invoices[id] : null;
  const source = existing || (fromId ? derived.invoices[fromId] : null);
  const kind = existing?.kind || source?.kind || kindProp;
  const isQuote = kind === 'quote';
  const label = isQuote ? 'quote' : 'invoice';
  const dayTypeMult = (name) => num(db.day_types.find((d) => d.name === name)?.multiplier) || 1;

  const [form, setForm] = useState(() => {
    const issue = existing?.issue_date || todayISO();
    const termDays = p.default_terms_days ?? 30;
    const base = {
      id: existing?.id || null, kind, number: existing?.number || '', status: existing?.status || 'draft',
      client_id: source?.client_id || clientId || null, project_id: source?.project_id || null,
      issue_date: issue, due_date: existing?.due_date || addDays(issue, termDays),
      terms: existing?.terms ?? (isQuote ? `Valid ${termDays} days` : TERMS.find((t) => t.days === termDays)?.label || `Net ${termDays}`),
      notes: source?.notes || '', mode: source?.mode || 'basic',
      discount_type: source?.discount_type || 'amount', discount_value: num(source?.discount_value),
      deposit_percent: source?.deposit_percent ?? null, auto_remind: existing ? !!existing.auto_remind : !!p.auto_remind_default,
      quote_id: existing?.quote_id || null,
    };
    return base;
  });
  const [lines, setLines] = useState(() => {
    if (!source) return [];
    return derived.linesFor(source.id).map((l) => ({ ...blankLine(), ...l, key: uid(), base_rate: round2(num(l.rate) / dayTypeMult(l.day_type)), receipt_id: existing ? l.receipt_id : null, ...openLine(l) }));
  });
  const [jobs, setJobs] = useState(() => {
    if (source?.jobs?.jobs) {
      const j = JSON.parse(JSON.stringify(source.jobs));
      if (!existing) j.jobs.forEach((x) => { x.days = []; x.expenses = []; });
      return j;
    }
    return { jobs: [blankJob(defaultRate(db), defaultRole(db))], other: [] };
  });
  // Receipts attached as backup only. Billed ones live on their lines, so removing the line frees the receipt again.
  const [attachIds, setAttachIds] = useState(() => {
    if (!existing) return new Set();
    const billed = new Set(derived.linesFor(existing.id).flatMap(lineReceipts));
    return new Set(db.receipts.filter((r) => r.invoice_id === existing.id && !billed.has(r.id)).map((r) => r.id));
  });
  const [mileageIds, setMileageIds] = useState(() => new Set(existing ? db.mileage_trips.filter((t) => t.invoice_id === existing.id).map((t) => t.id) : []));
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(null); // { type: 'receipts'|'mileage', onPick }
  const [error, setError] = useState('');
  const dirty = useRef(false);

  // Assign the next number for new invoices.
  useEffect(() => {
    if (!existing && !form.number) {
      const key = isQuote ? 'next_quote_number' : 'next_invoice_number';
      let n = p[key] || 1;
      const used = new Set(db.invoices.filter((i) => i.kind === kind).map((i) => String(i.number)));
      while (used.has(String(n))) n++;
      setForm((f) => ({ ...f, number: String(n) }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const warn = (e) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const set = (patch) => { dirty.current = true; setForm((f) => ({ ...f, ...patch })); };
  const client = derived.clients[form.client_id];
  const rule = otRule(p, client);

  const finalLines = useMemo(() => {
    if (form.mode === 'advanced') return compileJobs(jobs, rule, db.day_types).map((l) => ({ ...l, tax_rate: 0 }));
    return lines.filter((l) => l.item || l.description || num(l.rate) || l.addons?.length).map(compileLine);
  }, [form.mode, jobs, lines, rule, db.day_types]);
  const t = totals(finalLines, form.discount_type, form.discount_value);

  // Clients you're most likely to bill first: invoiced most recently (and most often), then everyone else A–Z.
  const clientOptions = useMemo(() => {
    const use = {};
    for (const i of db.invoices) {
      if (!i.client_id || i.kind !== kind) continue;
      const u = (use[i.client_id] ||= { last: '', n: 0 });
      u.n += 1;
      if (String(i.issue_date) > u.last) u.last = String(i.issue_date);
    }
    const recent = (c) => use[c.id]?.last || '';
    return db.clients.filter((c) => !c.archived || c.id === form.client_id)
      .sort((a, b) => recent(b).slice(0, 7).localeCompare(recent(a).slice(0, 7)) || (use[b.id]?.n || 0) - (use[a.id]?.n || 0) || a.name.localeCompare(b.name))
      .map((c) => ({ value: c.id, label: c.name, meta: [c.contact_first, c.contact_last].filter(Boolean).join(' ') || c.email || '' }));
  }, [db.clients, db.invoices, kind, form.client_id]);
  const projectOptions = db.projects.filter((pr) => !pr.archived && (!form.client_id || !pr.client_id || pr.client_id === form.client_id)).map((pr) => ({ value: pr.id, label: pr.name, meta: derived.clients[pr.client_id]?.name || '' }));

  // New client from the invoice: a quick form (email, address with suggestions) without leaving the invoice.
  const [newClient, setNewClient] = useState(null);
  const createClient = (name) => setNewClient({ name });
  async function createProject(name) {
    const pr = await s.insert('projects', { name, client_id: form.client_id });
    set({ project_id: pr.id });
  }

  function setTerms(label) {
    const tt = TERMS.find((x) => x.label === label);
    set({ terms: label, due_date: tt ? addDays(form.issue_date, tt.days) : form.due_date });
  }

  async function switchMode(mode) {
    if (mode === form.mode) return;
    if (mode === 'basic') {
      const compiled = compileJobs(jobs, rule, db.day_types);
      if (compiled.length && !(await s.confirm({ title: 'Switch to Basic?', body: 'Your jobs become regular lines you can edit one by one. The day picker and overtime calculator won’t be available for these lines anymore.', ok: 'Switch' }))) return;
      setLines(compiled.map((l) => blankLine({ ...l, base_rate: l.rate })));
    } else {
      const real = lines.filter((l) => l.item || num(l.rate)).map(compileLine);
      if (real.length) {
        if (!(await s.confirm({ title: 'Switch to Advanced?', body: 'Your current lines will be kept under “Other items”. Add jobs to use the day picker and automatic overtime.', ok: 'Switch' }))) return;
        setJobs((j) => ({ jobs: j.jobs.length ? j.jobs : [blankJob(defaultRate(db), defaultRole(db))], other: [...j.other, ...real.map((l) => ({ id: uid(), item: l.item, note: [l.description, num(l.qty) !== 1 ? `${l.qty} × ${money(l.rate)}` : ''].filter(Boolean).join(' · '), amount: l.amount, receipt_id: l.receipt_id, kind: l.kind }))] }));
      }
    }
    set({ mode });
  }

  async function save(after) {
    setError('');
    if (!form.number.trim()) return setError('Give this an invoice number.');
    if (!form.issue_date) return setError('Pick a date for this invoice.');
    const clash = db.invoices.find((i) => i.kind === kind && String(i.number) === form.number.trim() && i.id !== form.id);
    if (clash) return setError(`${isQuote ? 'Quote' : 'Invoice'} #${form.number} already exists. Pick another number.`);
    if (!finalLines.length) return setError('Add at least one line.');
    if (!form.client_id && !(await s.confirm({ title: 'No client selected', body: `Save this ${label} without a client?`, ok: 'Save anyway' }))) return;
    setBusy(true);
    try {
      const { status, ...inv } = form;
      inv.number = form.number.trim();
      inv.jobs = form.mode === 'advanced' ? jobs : null;
      const lineRows = finalLines.map(({ key, base_rate, showNote, addons, focus, id: _id, owner_id, invoice_id, position, ...l }) => l);
      const savedId = await saveInvoice(s, inv, lineRows, existing && existing.status !== 'draft' ? summary || null : null);
      // Receipts: billed lines + backup attachments
      const billed = new Set(lineRows.flatMap(lineReceipts));
      const keep = new Set([...attachIds, ...billed]);
      for (const r of db.receipts) {
        const shouldLink = keep.has(r.id);
        const linked = r.invoice_id === savedId;
        const bill = billed.has(r.id);
        if (shouldLink && (!linked || !!r.billable !== bill)) await s.update('receipts', r.id, { invoice_id: savedId, billable: bill });
        else if (!shouldLink && linked) await s.update('receipts', r.id, { invoice_id: null, billable: false });
      }
      for (const tr of db.mileage_trips) {
        const want = mileageIds.has(tr.id);
        if (want && tr.invoice_id !== savedId) await s.update('mileage_trips', tr.id, { invoice_id: savedId });
        else if (!want && tr.invoice_id === savedId) await s.update('mileage_trips', tr.id, { invoice_id: null });
      }
      dirty.current = false;
      const fresh = (await s.api.reload('invoices')).find((i) => i.id === savedId);
      if (after === 'final' && fresh && fresh.status === 'draft') {
        // "Save" finalizes it: no longer a draft, ready to send (it only says Sent once it's actually sent).
        await s.update('invoices', savedId, { status: 'sent', sent_at: null });
        await s.insert('invoice_events', { invoice_id: savedId, type: 'edited', detail: 'Saved — ready to send' });
        s.toast('Saved — ready to send');
      } else s.toast(existing && existing.status !== 'draft' ? 'Saved — your client sees the update at the same link' : 'Saved');
      await s.reload('invoices', 'invoice_events');
      go(`/invoices/${savedId}`);
    } catch (e) {
      setError(e.message.includes('kind_number') ? `#${form.number} is already used.` : e.message);
    } finally {
      setBusy(false);
    }
  }

  const sentAlready = existing && existing.status !== 'draft';
  const title = existing ? `Edit ${label} #${existing.number}` : fromId ? `Copy of #${source?.number}` : `New ${label}`;

  // Receipts billed as lines, and mileage trips, land in the lines (Basic) or "Other items" (Jobs & OT).
  const expenseItem = (r) => (r.category === 'Parking & tolls' ? 'Parking' : r.category === 'Meals' ? 'Meal' : r.vendor || 'Expense');
  function billReceipts(rs) {
    dirty.current = true;
    if (form.mode === 'advanced') setJobs((j) => ({ ...j, other: [...j.other, ...rs.map((r) => ({ id: uid(), item: expenseItem(r), note: `${r.vendor || ''}${r.receipt_date ? ` (${mmdd(r.receipt_date)})` : ''}`.trim(), amount: num(r.total), receipt_id: r.id }))] }));
    else setLines((ls) => [...ls.filter((l) => l.item || num(l.rate)), ...rs.map((r) => blankLine({ kind: 'expense', item: expenseItem(r), description: `${r.vendor || ''}${r.receipt_date ? ` (${mmdd(r.receipt_date)})` : ''}`.trim(), rate: num(r.total), base_rate: num(r.total), receipt_id: r.id }))]);
  }
  function addTrips(trips) {
    dirty.current = true;
    setMileageIds(new Set([...mileageIds, ...trips.map((tr) => tr.id)]));
    const rows = trips.map((tr) => { const mi = num(tr.miles) * (tr.round_trip ? 2 : 1); return { mi, rate: num(tr.rate), desc: `${[tr.start_place, tr.end_place].filter(Boolean).join(' → ')}${tr.round_trip ? ' (round trip)' : ''} (${mmdd(tr.trip_date)})` }; });
    if (form.mode === 'advanced') setJobs((j) => ({ ...j, other: [...j.other, ...rows.map((r) => ({ id: uid(), item: 'Mileage', note: `${r.desc} · ${r.mi} mi`, amount: round2(r.mi * r.rate), receipt_id: null }))] }));
    else setLines((ls) => [...ls.filter((l) => l.item || num(l.rate)), ...rows.map((r) => blankLine({ kind: 'expense', item: 'Mileage', description: r.desc, qty: r.mi, rate: r.rate, base_rate: r.rate }))]);
  }

  // Live invoice for the preview: exactly what the client will see.
  const previewInv = { ...form, kind, ...t, subtotal: t.subtotal, total: t.total };
  const previewLines = finalLines.map((l) => ({ ...l, amount: l.amount ?? lineAmount(l.qty, l.rate) }));
  const [logoUrl, setLogoUrl] = useState(null);
  useEffect(() => { if (p.logo_key) s.api.files.urls([p.logo_key]).then((u) => setLogoUrl(u[p.logo_key])).catch(() => {}); }, [p.logo_key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [bigPreview, setBigPreview] = useState(false);

  // Details card: open while there's no client yet, otherwise a one-line summary you tap to change.
  const [detailsOpen, setDetailsOpen] = useState(() => !form.client_id);
  const [extra, setExtra] = useState(null);
  const billedIds = new Set(finalLines.flatMap(lineReceipts));
  const receiptCount = new Set([...attachIds, ...billedIds]).size;
  const chips = [
    { key: 'receipts', icon: 'receipt', on: receiptCount > 0, label: receiptCount ? `${receiptCount} receipt${receiptCount === 1 ? '' : 's'}` : 'Receipts' },
    { key: 'mileage', icon: 'car', on: mileageIds.size > 0, label: mileageIds.size ? `${mileageIds.size} trip${mileageIds.size === 1 ? '' : 's'}` : 'Mileage' },
    { key: 'discount', icon: 'tag', on: num(form.discount_value) > 0, label: num(form.discount_value) > 0 ? (form.discount_type === 'percent' ? `${num(form.discount_value)}% off` : `${money(form.discount_value)} off`) : 'Discount' },
    { key: 'deposit', icon: 'deposit', on: !!form.deposit_percent, label: form.deposit_percent ? `${form.deposit_percent}% deposit` : 'Deposit' },
    { key: 'notes', icon: 'note', on: !!form.notes, label: 'Notes' },
    ...(!isQuote ? [{ key: 'remind', icon: 'bell', on: !!form.auto_remind, label: form.auto_remind ? 'Reminders on' : 'Reminders' }] : []),
  ];
  const dueBits = [`#${form.number || '—'}`, fmtShort(form.issue_date), form.due_date ? `${isQuote ? 'valid until' : 'due'} ${fmtShort(form.due_date)}${!isQuote && form.terms && form.terms !== 'Custom' ? ` (${form.terms})` : ''}` : ''].filter(Boolean).join(' · ');

  const saveButtons = (
    <>
      {!sentAlready && <Button busy={busy} onClick={() => save()}>Save draft</Button>}
      <Button variant="primary" busy={busy} icon="check" onClick={() => save(sentAlready ? null : 'final')}>{sentAlready ? 'Save changes' : 'Save'}</Button>
    </>
  );

  return (
    <div className="page ed-page">
      <div className="page-head">
        <div className="col" style={{ gap: 4 }}>
          <button className="btn link small" style={{ alignSelf: 'flex-start' }} onClick={() => (existing ? go(`/invoices/${existing.id}`) : history.back())}>← Cancel</button>
          <h1>{title}</h1>
        </div>
      </div>

      {sentAlready && (
        <div className="banner info" style={{ flexWrap: 'wrap' }}>
          <Icon name="history" />
          <div className="grow" style={{ minWidth: 240 }}>
            Already sent — saving updates the same link. The old version stays in History.
            <input className="input" style={{ marginTop: 8 }} placeholder="What changed? (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
        </div>
      )}
      {error && <div className="banner bad" role="alert">{error}</div>}

      <div className="ed-split">
        <div className="col ed-main" style={{ gap: 14, minWidth: 0 }}>
          {/* Who + when */}
          {detailsOpen ? (
            <section className="card card-pad ed-details">
              <button type="button" className="ed-collapse" aria-label="Collapse details" onClick={() => setDetailsOpen(false)}><Icon name="chevD" size={18} /></button>
              <div className="ed-wide"><Combobox label="Client" value={form.client_id} options={clientOptions} placeholder="Search or add a client" onChange={(v) => set({ client_id: v, project_id: null })} onCreate={createClient} createLabel={(q) => `+ Add “${q}” as a new client`} /></div>
              <div className="ed-wide"><Combobox label="Project" value={form.project_id} options={projectOptions} placeholder={client ? `${client.name}’s projects` : 'Optional'} onChange={(v) => set({ project_id: v })} onCreate={createProject} createLabel={(q) => `+ Create project “${q}”`} /></div>
              <Field label={`${isQuote ? 'Quote' : 'Invoice'} no.`}><input className="input num" value={form.number} onChange={(e) => set({ number: e.target.value })} /></Field>
              <Field label="Date"><DateInput value={form.issue_date} onChange={(v) => { const tt = TERMS.find((x) => x.label === form.terms); set({ issue_date: v, due_date: tt ? addDays(v, tt.days) : form.due_date }); }} /></Field>
              {!isQuote && (
                <Field label="Terms">
                  <select className="input" value={TERMS.some((x) => x.label === form.terms) ? form.terms : 'custom'} onChange={(e) => (e.target.value === 'custom' ? set({ terms: 'Custom' }) : setTerms(e.target.value))}>
                    {TERMS.map((x) => <option key={x.label}>{x.label}</option>)}
                    <option value="custom">Custom due date</option>
                  </select>
                </Field>
              )}
              <Field label={isQuote ? 'Valid until' : 'Due'}><DateInput value={form.due_date || ''} onChange={(v) => set({ due_date: v, terms: isQuote ? form.terms : TERMS.find((x) => addDays(form.issue_date, x.days) === v)?.label || 'Custom' })} /></Field>
            </section>
          ) : (
            <button type="button" className="card ed-summary" onClick={() => setDetailsOpen(true)} aria-label="Change client, number and dates">
              <span className="col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                <span className="ed-who">{client?.name || 'No client'}{form.project_id && <span className="muted" style={{ fontWeight: 400 }}> · {db.projects.find((pr) => pr.id === form.project_id)?.name}</span>}</span>
                <span className="small muted num">{dueBits}</span>
              </span>
              <Icon name="edit" size={16} />
            </button>
          )}

          {/* What you did */}
          <section className="card ed-work">
            <div className="row between ed-work-head">
              <h2>What you did</h2>
              <Seg value={form.mode} onChange={switchMode} label="Editor mode" options={[{ value: 'basic', label: 'Lines' }, { value: 'advanced', label: 'Jobs & OT' }]} />
            </div>
            {form.mode === 'basic' ? (
              <BasicLines issueDate={form.issue_date} lines={lines} setLines={(fn) => { dirty.current = true; setLines(fn); }} db={db} openPicker={setPicker} />
            ) : (
              <AdvancedJobs jobs={jobs} setJobs={(fn) => { dirty.current = true; setJobs(fn); }} rule={rule} db={db} openPicker={setPicker} />
            )}
          </section>

          {/* Extras: one tap to open, filled when used */}
          <div className="ed-chips" role="toolbar" aria-label="Extras">
            {chips.map((c) => (
              <button key={c.key} type="button" className={`ed-chip ${c.on ? 'on' : ''} ${extra === c.key ? 'open' : ''}`} aria-expanded={extra === c.key} onClick={() => setExtra((x) => (x === c.key ? null : c.key))}>
                <Icon name={c.on ? c.icon : 'plus'} size={15} />{c.label}
              </button>
            ))}
          </div>

          {extra && (
            <section className="card card-pad col ed-extra" style={{ gap: 12 }}>
              {extra === 'receipts' && <ReceiptsPanel db={db} attachIds={attachIds} setAttachIds={(v) => { dirty.current = true; setAttachIds(v); }} billed={billedIds} openPicker={setPicker} bill={billReceipts} />}
              {extra === 'mileage' && (
                <>
                  {db.mileage_trips.filter((tr) => mileageIds.has(tr.id)).map((tr) => (
                    <div key={tr.id} className="row between ed-item"><span>{fmtShort(tr.trip_date)} · {[tr.start_place, tr.end_place].filter(Boolean).join(' → ')}</span><span className="num muted">{num(tr.miles) * (tr.round_trip ? 2 : 1)} mi</span></div>
                  ))}
                  <Button size="sm" icon="car" style={{ alignSelf: 'flex-start' }} onClick={() => setPicker({ type: 'mileage', onPick: addTrips })}>Add trips</Button>
                </>
              )}
              {extra === 'discount' && (
                <Field label="Discount">
                  <div className="row" style={{ gap: 6, maxWidth: 260 }}>
                    <MoneyInput value={form.discount_value || ''} onChange={(v) => set({ discount_value: v })} placeholder="0" autoFocus />
                    <select className="input" style={{ width: 70 }} value={form.discount_type} onChange={(e) => set({ discount_type: e.target.value })} aria-label="Discount type"><option value="amount">$</option><option value="percent">%</option></select>
                  </div>
                </Field>
              )}
              {extra === 'deposit' && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {[null, 25, 30, 50, 100].map((v) => (
                    <button key={v ?? 'none'} type="button" className={`ed-opt ${form.deposit_percent === v ? 'on' : ''}`} onClick={() => set({ deposit_percent: v })}>{v ? `${v}%` : 'None'}</button>
                  ))}
                  {form.deposit_percent ? <span className="small muted num" style={{ alignSelf: 'center', marginLeft: 6 }}>{money((t.total * form.deposit_percent) / 100)} due up front</span> : null}
                </div>
              )}
              {extra === 'notes' && <textarea className="input" rows={3} autoFocus placeholder={isQuote ? 'e.g. 50% deposit to book' : 'e.g. Month of October'} value={form.notes || ''} onChange={(e) => set({ notes: e.target.value })} aria-label="Notes" />}
              {extra === 'remind' && (
                <label className="row between" style={{ minHeight: 40 }}>
                  <span className="col" style={{ gap: 0 }}><span>Automatic reminders</span><span className="small muted">{(p.reminder_days || []).join(', ')} days after the due date</span></span>
                  <Switch checked={form.auto_remind} onChange={(v) => set({ auto_remind: v })} label="Automatic reminders" />
                </label>
              )}
            </section>
          )}
        </div>

        {/* Live preview + save (wide screens) */}
        <aside className="ed-side col">
          <button type="button" className="ed-preview" onClick={() => setBigPreview(true)} aria-label="Open full-size preview">
            <ScaledDoc><InvoiceDoc business={p} invoice={previewInv} client={client} lines={previewLines} logoUrl={logoUrl} /></ScaledDoc>
          </button>
          <div className="row" style={{ gap: 8 }}>{saveButtons}</div>
        </aside>
      </div>

      {/* Narrow screens: total + save stay in reach */}
      <div className="ed-bar">
        <button type="button" className="ed-bar-total" onClick={() => setBigPreview(true)} aria-label="Preview">
          <span className="small muted">Total</span><b className="num">{money(t.total)}</b><Icon name="eye" size={16} />
        </button>
        {saveButtons}
      </div>

      {bigPreview && (
        <Modal title="Preview" wide onClose={() => setBigPreview(false)}>
          <InvoiceDoc business={p} invoice={previewInv} client={client} lines={previewLines} logoUrl={logoUrl} />
        </Modal>
      )}
      {newClient && <ClientModal client={newClient} stay onClose={() => setNewClient(null)} onSaved={(c) => set({ client_id: c.id, project_id: null })} />}
      {picker?.type === 'receipts' && <ReceiptPicker ctx={picker.ctx || suggestContext({ lines: finalLines, jobs, issueDate: form.issue_date, clientName: derived.clients[form.client_id]?.name })} db={db} exclude={picker.exclude} title={picker.title} onClose={() => setPicker(null)} onPick={(rs) => { picker.onPick(rs); setPicker(null); }} />}
      {picker?.type === 'mileage' && <MileagePicker db={db} derived={derived} selected={mileageIds} onClose={() => setPicker(null)} onPick={(trips) => { picker.onPick(trips); setPicker(null); }} />}
    </div>
  );
}

/** Shrinks the full-size invoice to fit its box, so the preview is the real thing. */
function ScaledDoc({ children, width = 760 }) {
  const box = useRef(null);
  const [z, setZ] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setZ(Math.min(1, el.clientWidth / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return <div ref={box} className="scaled-doc"><div style={{ width, zoom: z }}>{children}</div></div>;
}

function defaultRate(db) {
  return num(db.catalog_items.find((c) => c.kind === 'labor' && c.unit === 'day' && !c.archived)?.rate) || 750;
}
function defaultRole(db) {
  return db.catalog_items.find((c) => c.kind === 'labor' && c.unit === 'day' && !c.archived)?.name || 'Camera Operator';
}

/* ------------------------------------------------------------------ */
/* Basic: Wave-style line items                                        */
/* ------------------------------------------------------------------ */
function BasicLines({ lines, setLines, db, issueDate, openPicker }) {
  const catalog = db.catalog_items.filter((c) => !c.archived).sort((a, b) => a.position - b.position);
  const hasTax = db.tax_rates.length > 0;
  const upd = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const move = (key, d) => setLines((ls) => {
    const i = ls.findIndex((l) => l.key === key);
    const j = i + d;
    if (j < 0 || j >= ls.length) return ls;
    const c = [...ls];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });
  const cols = `minmax(140px,1.2fr) minmax(170px,1.6fr) 64px 96px ${hasTax ? '86px ' : ''}92px 60px`;
  // Drag the grip to reorder lines (mouse or finger): the line follows the pointer over the others.
  const [dragKey, setDragKey] = useState(null);
  const startDrag = (key, e) => {
    e.preventDefault();
    setDragKey(key);
    const onMove = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-line-key]');
      const over = el?.getAttribute('data-line-key');
      if (!over || over === key) return;
      setLines((ls) => {
        const from = ls.findIndex((x) => x.key === key);
        const to = ls.findIndex((x) => x.key === over);
        if (from < 0 || to < 0) return ls;
        const c = [...ls];
        const [m] = c.splice(from, 1);
        c.splice(to, 0, m);
        return c;
      });
    };
    const onUp = () => { setDragKey(null); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Everything you can add: saved items first, then anything you've billed before (newest price wins).
  const choices = useMemo(() => {
    const seen = new Set(catalog.map((c) => c.name.toLowerCase()));
    const out = catalog.map((c) => ({ key: `c:${c.id}`, name: c.name, sub: c.description || '', rate: num(c.rate), unit: c.unit, kind: c.kind, day: c.unit === 'day' && c.kind === 'labor', desc: c.description || '' }));
    const when = Object.fromEntries(db.invoices.map((i) => [i.id, i.issue_date || '']));
    const past = [...db.invoice_lines].filter((l) => l.item).sort((a, b) => String(when[b.invoice_id]).localeCompare(String(when[a.invoice_id])));
    for (const l of past) {
      const k = l.item.trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const base = l.extras ? num(l.extras.rate) : num(l.rate) / (num(db.day_types.find((d) => d.name === l.day_type)?.multiplier) || 1);
      out.push({ key: `p:${k}`, name: l.item.trim(), sub: String((l.extras ? l.extras.desc : l.description) || '').split('\n')[0], rate: round2(base), kind: l.kind, day: !!l.day_type, desc: '', past: true });
    }
    return out;
  }, [catalog, db.invoice_lines, db.invoices, db.day_types]);
  // Last price used for each add-on (e.g. Per Diem), so the next one starts there.
  const addonRates = useMemo(() => {
    const r = {};
    const when = Object.fromEntries(db.invoices.map((i) => [i.id, i.issue_date || '']));
    [...db.invoice_lines].filter((l) => l.extras?.items).sort((a, b) => String(when[a.invoice_id]).localeCompare(String(when[b.invoice_id])))
      .forEach((l) => l.extras.items.forEach((a) => { if (a.label) r[a.label.toLowerCase()] = num(a.rate); }));
    return r;
  }, [db.invoice_lines, db.invoices]);
  // What the add-on menu needs: the IRS mileage rate for this invoice, and a receipt picker for this line.
  const addonCtx = {
    mileRate: rateFor(db.profile, issueDate),
    pickReceipt: (l, onPick) => openPicker({
      type: 'receipts', title: 'Add a receipt to this line', ctx: suggestContext({ lines: [compileLine(l)], issueDate }),
      exclude: new Set(lines.flatMap(lineReceipts)), onPick,
    }),
  };
  // Folds a line into the one above as an add-on (e.g. a billed parking receipt into the shoot day it belongs to).
  const nest = (key) => setLines((ls) => {
    const i = ls.findIndex((x) => x.key === key);
    if (i < 1) return ls;
    const l = ls[i];
    const own = { id: uid(), label: l.item || 'Expense', qty: num(l.qty) || 1, rate: num(l.rate), receipt_id: l.receipt_id || null, unit: null };
    const c = [...ls];
    c[i - 1] = { ...c[i - 1], addons: [...(c[i - 1].addons || []), own, ...(l.addons || [])] };
    c.splice(i, 1);
    return c;
  });
  const addChoice = (c) => setLines((ls) => [...ls.filter((l) => l.item || num(l.rate) || l.description || l.addons?.length), blankLine({ kind: c.kind || 'labor', item: c.name, description: c.desc || '', rate: c.rate || 0, base_rate: c.rate || 0, day_type: c.day ? 'Full day' : null, focus: true })]);

  return (
    <>
      <div className="table-wrap">
        <div className="lines basic-lines" style={{ padding: '0 20px' }}>
          {lines.length > 0 && <div className="line-head" style={{ gridTemplateColumns: cols }}>
            <span>Item</span><span>Description</span><span>Qty</span><span>Price</span>{hasTax && <span>Tax</span>}<span className="right">Amount</span><span />
          </div>}
          {lines.map((l, i) => (
            <BasicLine key={l.key} l={l} nest={i > 0 ? () => nest(l.key) : null} issueDate={issueDate} cols={cols} dragging={dragKey === l.key} onGrip={(e) => startDrag(l.key, e)} catalog={catalog} db={db} hasTax={hasTax} addonRates={addonRates} addonCtx={addonCtx} upd={upd} move={move} remove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} dup={() => setLines((ls) => { const i = ls.findIndex((x) => x.key === l.key); const c = [...ls]; c.splice(i + 1, 0, { ...l, key: uid(), receipt_id: null }); return c; })} />
          ))}
        </div>
      </div>
      <div style={{ padding: lines.length ? '12px 20px 18px' : '4px 20px 18px' }}>
        <ItemSearch choices={choices} onPick={addChoice} onCreate={(name) => addChoice({ name })} startOpen={!lines.length} />
      </div>
    </>
  );
}

/**
 * Wave-style "Add an item": type to search your saved items and everything you've billed before,
 * pick one to add it with its price, or create a new one from what you typed.
 */
function ItemSearch({ choices, onPick, onCreate, startOpen }) {
  const [open, setOpen] = useState(startOpen);
  const [show, setShow] = useState(false); // the list, once you're in the box
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!box.current?.contains(e.target)) { setShow(false); setQ(''); if (!startOpen) setOpen(false); } };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [open, startOpen]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = choices.filter((c) => words.every((w) => `${c.name} ${c.sub}`.toLowerCase().includes(w))).slice(0, 8);
  const exact = choices.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());
  const rows = [...list.map((c) => ({ c })), ...(q.trim() && !exact ? [{ create: q.trim() }] : [])];
  useEffect(() => setI(0), [q]);
  const choose = (r) => { if (!r) return; r.create ? onCreate(r.create) : onPick(r.c); setQ(''); setShow(false); setOpen(false); };
  if (!open) return <Button size="sm" icon="plus" onClick={() => setOpen(true)}>Add item</Button>;
  return (
    <div className="item-search" ref={box}>
      <div className="item-search-input">
        <Icon name="search" size={16} />
        <input autoFocus={!startOpen || undefined} value={q} onChange={(e) => { setQ(e.target.value); setShow(true); }} placeholder="Add an item — search or type a new one" aria-label="Add an item"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(rows.length - 1, x + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(rows[i]); }
            else if (e.key === 'Escape') { setShow(false); setQ(''); if (!startOpen) setOpen(false); }
          }} onFocus={() => setShow(true)} />
      </div>
      {show && rows.length > 0 && (
        <div className="item-search-list" role="listbox">
          {rows.map((r, k) => r.create ? (
            <button key="create" type="button" role="option" aria-selected={k === i} className={`item-opt create ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => choose(r)}>
              <Icon name="plus" size={16} /><span>Create “{r.create}” as a new item</span>
            </button>
          ) : (
            <button key={r.c.key} type="button" role="option" aria-selected={k === i} className={`item-opt ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => choose(r)}>
              <span className="col" style={{ gap: 0, minWidth: 0 }}><b>{r.c.name}</b>{r.c.sub && <span className="small muted ellip">{r.c.sub}</span>}</span>
              <span className="num">{r.c.rate ? money(r.c.rate) : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ADDONS = [
  { label: 'Travel', rate: (l) => round2((num(l.base_rate) || num(l.rate)) / 2) }, // travel days are usually half the day rate
  { label: 'Per Diem' },
  { label: 'Hotel' },
  { label: 'Parking' },
  { label: 'Mileage', unit: 'mi' }, // miles × the IRS rate
  { receipt: true, name: 'From a receipt…' },
  { label: '', name: 'Other' },
];

function BasicLine({ l, nest, cols, catalog, db, hasTax, addonRates, addonCtx, upd, move, remove, dup, dragging, onGrip, issueDate }) {
  const [calOpen, setCalOpen] = useState(false);
  // Shoot dates are saved on the line (they show on the Calendar); older lines fall back to the dates in the description.
  const [calDates, setCalDates] = useState(() => (Array.isArray(l.dates) && l.dates.length ? l.dates : (() => { const m = String(l.description || '').match(/\((\d{2}\/\d{2}(?:-\d{2}\/\d{2})?(?:,\s*\d{2}\/\d{2}(?:-\d{2}\/\d{2})?)*)\)/); return m ? datesFromCode(m[1], issueDate) : []; })()));
  const isDay = l.kind === 'labor' || l.kind === 'gear';
  const listId = `cat-${l.key}`;
  const pickItem = (name) => {
    const c = catalog.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (c) upd(l.key, { item: c.name, kind: c.kind, rate: num(c.rate), base_rate: num(c.rate), day_type: c.unit === 'day' && c.kind === 'labor' ? 'Full day' : null, description: l.description || c.description || '' });
    else upd(l.key, { item: name });
  };
  const applyDates = (dates) => {
    setCalDates(dates);
    const code = datesCode(dates);
    const desc = l.description.replace(/\s*\((\d\d\/\d\d(-\d\d\/\d\d)?(, )?)+\)\s*$/, '').trim();
    upd(l.key, { dates, description: code ? `${desc}${desc ? ' ' : ''}(${code})` : desc, qty: isDay && dates.length ? dates.length : l.qty });
  };
  return (
    <div className={`line basic-line ${dragging ? 'dragging' : ''}`} data-line-key={l.key} style={{ gridTemplateColumns: cols }}>
      <div className="col c-item" style={{ gap: 6 }}>
        <input className="input" list={listId} value={l.item} placeholder="Item" onChange={(e) => pickItem(e.target.value)} aria-label="Item" style={{ fontWeight: 500 }} />
        <datalist id={listId}>{catalog.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        {l.day_type && db.day_types.length > 0 && (
          <select className="input" style={{ minHeight: 34, fontSize: 13 }} value={l.day_type || 'Full day'} aria-label="Day type" onChange={(e) => {
            const dt = db.day_types.find((d) => d.name === e.target.value);
            const base = num(l.base_rate) || num(l.rate);
            upd(l.key, { day_type: e.target.value, rate: round2(base * (num(dt?.multiplier) || 1)), base_rate: base });
          }}>
            {db.day_types.sort((a, b) => a.position - b.position).map((d) => <option key={d.id} value={d.name}>{d.name}{num(d.multiplier) !== 1 ? ` (${Math.round(num(d.multiplier) * 100)}%)` : ''}</option>)}
          </select>
        )}
        {l.receipt_id && <span className="small" style={{ color: 'var(--accent-ink)' }}><Icon name="receipt" size={13} /> Receipt attached</span>}
      </div>
      <div className="col c-desc" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 6, alignItems: 'stretch' }}>
          <textarea className="input" autoFocus={l.focus || undefined} rows={Math.min(8, Math.max(1, String(l.description || '').split('\n').length))} style={{ minHeight: 40, resize: 'vertical', padding: '9px 12px' }} value={l.description || ''} placeholder="Description" onChange={(e) => upd(l.key, { description: e.target.value })} aria-label="Description" />
          <Popover open={calOpen} setOpen={setCalOpen} align="right" width={310} trigger={<Button variant="icon" icon="calendar" aria-label="Add dates" title="Add shoot dates" onClick={() => setCalOpen((o) => !o)} />}>
            <Calendar value={calDates} onChange={applyDates} />
            <div className="row between" style={{ paddingTop: 8 }}>
              <span className="small muted">{calDates.length ? `${datesLabel(calDates)} · qty ${isDay ? calDates.length : l.qty}` : ''}</span>
              <Button size="sm" variant="primary" onClick={() => setCalOpen(false)}>Done</Button>
            </div>
          </Popover>
        </div>
        {l.note != null && l.note !== false && (l.note !== '' || l.showNote) ? (
          <textarea className="input" rows={Math.min(6, Math.max(1, String(l.note || '').split('\n').length))} style={{ minHeight: 32, fontSize: 12, padding: '6px 12px' }} placeholder="Extra note (e.g. $750 + $750 plus 1 hour OT)" value={l.note || ''} onChange={(e) => upd(l.key, { note: e.target.value })} aria-label="Note" autoFocus={l.showNote && !l.note} />
        ) : (
          <span className="row" style={{ gap: 14 }}>
            <button type="button" className="btn link small" style={{ fontSize: 12 }} onClick={() => upd(l.key, { showNote: true, note: l.note || '' })}>+ Note</button>
            {!l.addons?.length && <AddonMenu l={l} addonRates={addonRates} ctx={addonCtx} upd={upd} />}
          </span>
        )}
      </div>
      <label className="c-qty m-field"><span className="m-lbl">Qty</span><MoneyInput value={l.qty} onChange={(v) => upd(l.key, { qty: v })} aria-label="Quantity" /></label>
      <label className="c-price m-field"><span className="m-lbl">Price</span><MoneyInput value={l.rate} onChange={(v) => upd(l.key, { rate: v, base_rate: round2(v / (num(db.day_types.find((d) => d.name === l.day_type)?.multiplier) || 1)) })} aria-label="Price" /></label>
      {hasTax && (
        <select className="input c-tax" value={l.tax_rate || 0} onChange={(e) => upd(l.key, { tax_rate: Number(e.target.value) })} aria-label="Tax">
          <option value={0}>None</option>{db.tax_rates.map((t) => <option key={t.id} value={t.rate}>{t.name} {t.rate}%</option>)}
        </select>
      )}
      <span className="num right c-amt" style={{ paddingTop: 10 }}>{money(lineAmount(l.qty, l.rate))}</span>
      <div className="c-menu row" style={{ gap: 0, flexWrap: 'nowrap' }}><span className="grip" onPointerDown={onGrip} aria-label="Drag to reorder" role="button" tabIndex={-1}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg></span><Menu label="" icon="more" variant="ghost icon" items={[
        { label: 'Move up', icon: 'chevL', onClick: () => move(l.key, -1) },
        { label: 'Move down', icon: 'chevR', onClick: () => move(l.key, 1) },
        nest && { label: 'Make it an add-on of the line above', icon: 'chevL', onClick: nest },
        { label: 'Duplicate', icon: 'copy', onClick: dup },
        { label: 'Delete line', icon: 'trash', danger: true, onClick: remove },
      ]} /></div>
      {l.addons?.length > 0 && <Addons l={l} cols={cols} hasTax={hasTax} addonRates={addonRates} ctx={addonCtx} upd={upd} />}
    </div>
  );
}

/** Small menu of add-ons for a line; travel starts at half the day rate, others at the last price you used. */
function AddonMenu({ l, addonRates, ctx, upd }) {
  const push = (items) => upd(l.key, { addons: [...(l.addons || []), ...items] });
  const add = (a) => {
    if (a.receipt) {
      return ctx.pickReceipt(l, (rs) => push(rs.map((r) => ({
        id: uid(), label: r.category === 'Parking & tolls' ? 'Parking' : r.category === 'Meals' ? 'Meal' : r.vendor || 'Expense',
        qty: 1, rate: num(r.total), receipt_id: r.id,
      }))));
    }
    const rate = a.unit === 'mi' ? ctx.mileRate : a.rate ? a.rate(l) : num(addonRates[a.label.toLowerCase()]);
    return push([{ id: uid(), label: a.label, qty: a.unit === 'mi' ? '' : 1, rate, unit: a.unit || null, fresh: true }]);
  };
  return <Menu label="+ Add-on" icon="" variant="link small addon-link" align="left" items={ADDONS.map((a) => ({ label: a.name || a.label, icon: a.receipt ? 'receipt' : a.unit === 'mi' ? 'car' : undefined, onClick: () => add(a) }))} />;
}

/** The add-ons under a line, lined up with its Qty / Price / Amount columns, and the line's total. */
function Addons({ l, cols, hasTax, addonRates, ctx, upd }) {
  const set = (id, patch) => upd(l.key, { addons: l.addons.map((a) => (a.id === id ? { ...a, ...patch, fresh: false } : a)) });
  return (
    <div className="addons">
      {l.addons.map((a) => (
        <div key={a.id} className="addon-row" style={{ gridTemplateColumns: cols }}>
          <span className="addon-tick" aria-hidden="true" />
          <span className="addon-name">
            <input className="input addon-label" value={a.label} placeholder="e.g. Kit fee" autoFocus={a.fresh && !a.label} onChange={(e) => set(a.id, { label: e.target.value })} aria-label="Add-on" />
            {a.receipt_id && <span className="addon-badge" title="Receipt attached"><Icon name="receipt" size={14} /></span>}
          </span>
          <label className="m-field addon-qty"><MoneyInput value={a.qty} placeholder={a.unit === 'mi' ? 'Miles' : ''} autoFocus={a.fresh && a.unit === 'mi'} onChange={(v) => set(a.id, { qty: v })} aria-label={a.unit === 'mi' ? 'Miles' : `${a.label || 'Add-on'} quantity`} />{a.unit === 'mi' && <span className="unit">mi</span>}</label>
          <label className="m-field"><MoneyInput value={a.rate} autoFocus={a.fresh && !!a.label && !a.rate && a.unit !== 'mi'} onChange={(v) => set(a.id, { rate: v })} aria-label={`${a.label || 'Add-on'} price`} /></label>
          {hasTax && <span className="addon-tax" />}
          <span className="num right muted addon-amt">{money(lineAmount(a.qty, a.rate))}</span>
          <Button variant="ghost icon" icon="x" aria-label={`Remove ${a.label || 'add-on'}`} onClick={() => upd(l.key, { addons: l.addons.filter((x) => x.id !== a.id) })} />
        </div>
      ))}
      <div className="addon-foot" style={{ gridTemplateColumns: cols }}>
        <span />
        <span className="addon-more"><AddonMenu l={l} addonRates={addonRates} ctx={ctx} upd={upd} /></span>
        <span className="addon-total"><span className="muted small">Total</span><b className="num">{money(lineTotal(l))}</b></span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Advanced: jobs with a day picker, hours per day and overtime        */
/* ------------------------------------------------------------------ */
function AdvancedJobs({ jobs, setJobs, rule, db, openPicker }) {
  const updJob = (id, fn) => setJobs((j) => ({ ...j, jobs: j.jobs.map((x) => (x.id === id ? fn(x) : x)) }));
  const busy = {};
  jobs.jobs.forEach((j) => j.days.forEach((d) => (busy[d.date] = j.company || 'another job')));
  const companies = useMemo(() => {
    const seen = new Map();
    for (const inv of db.invoices) for (const j of inv.jobs?.jobs || []) if (j.company) seen.set(j.company.toLowerCase(), j.company);
    for (const l of db.invoice_lines) { const m = (l.description || '').match(/^([^()]+?)\s*\(\d\d\/\d\d/); if (m) seen.set(m[1].trim().toLowerCase(), m[1].trim()); }
    for (const pr of db.projects) seen.set(pr.name.toLowerCase(), pr.name);
    return [...seen.values()].sort();
  }, [db.invoices, db.invoice_lines, db.projects]);
  const roles = db.catalog_items.filter((c) => c.kind === 'labor' && !c.archived);
  const gearItems = db.catalog_items.filter((c) => c.kind === 'gear' && !c.archived);

  return (
    <div className="col ed-jobs" style={{ gap: 12, padding: '0 20px 18px' }}>
      <span className="small muted">Overtime after {rule.base} h · {rule.m1}× for {rule.m1h} h, then {rule.m2}× <a href="#/settings?section=rates">change</a></span>
      {jobs.jobs.map((job) => (
        <JobCard key={job.id} job={job} rule={rule} db={db} busy={busy} companies={companies} roles={roles} gearItems={gearItems}
          upd={(fn) => updJob(job.id, fn)} remove={() => setJobs((j) => ({ ...j, jobs: j.jobs.filter((x) => x.id !== job.id) }))} openPicker={openPicker} />
      ))}
      <Button className="block" style={{ minHeight: 46, borderStyle: 'dashed' }} icon="plus" onClick={() => setJobs((j) => ({ ...j, jobs: [...j.jobs, blankJob(j.jobs[j.jobs.length - 1]?.rate ?? defaultRate(db), j.jobs[j.jobs.length - 1]?.role ?? defaultRole(db))] }))}>Add job</Button>
      {jobs.other.length > 0 && (
        <div className="col" style={{ gap: 8, paddingTop: 6 }}>
          <span className="small muted">Other items</span>
          {jobs.other.map((o) => (
            <div key={o.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(100px,1fr) minmax(140px,2fr) 100px 36px', gap: 8, alignItems: 'center' }}>
              <input className="input" value={o.item} placeholder="Item" aria-label="Item" onChange={(e) => setJobs((j) => ({ ...j, other: j.other.map((x) => (x.id === o.id ? { ...x, item: e.target.value } : x)) }))} />
              <input className="input" value={o.note || ''} placeholder="Description" aria-label="Description" onChange={(e) => setJobs((j) => ({ ...j, other: j.other.map((x) => (x.id === o.id ? { ...x, note: e.target.value } : x)) }))} />
              <MoneyInput value={o.amount} aria-label="Amount" onChange={(v) => setJobs((j) => ({ ...j, other: j.other.map((x) => (x.id === o.id ? { ...x, amount: v } : x)) }))} />
              <Button variant="ghost icon" icon="x" aria-label="Remove" onClick={() => setJobs((j) => ({ ...j, other: j.other.filter((x) => x.id !== o.id) }))} />
            </div>
          ))}
        </div>
      )}
      <Button size="sm" variant="ghost" icon="plus" style={{ alignSelf: 'flex-start' }} onClick={() => setJobs((j) => ({ ...j, other: [...j.other, { id: uid(), item: '', note: '', amount: 0, receipt_id: null }] }))}>Other item</Button>
    </div>
  );
}

function JobCard({ job, rule, db, busy, companies, roles, gearItems, upd, remove, openPicker }) {
  const [calOpen, setCalOpen] = useState(false);
  const dates = job.days.map((d) => d.date);
  const otherBusy = Object.fromEntries(Object.entries(busy).filter(([d]) => !dates.includes(d)));
  const labor = jobLabor(job, rule, db.day_types);
  const exp = (job.expenses || []).reduce((t, e) => t + num(e.amount), 0);
  const gear = (job.gear || []).reduce((t, g) => t + num(g.rate) * (num(g.qty) || dates.length), 0);
  const companyOptions = companies.map((c) => ({ value: c, label: c }));

  const setDates = (ds) => upd((j) => {
    const keep = new Map(j.days.map((d) => [d.date, d]));
    const days = ds.map((d) => keep.get(d) || { date: d, hours: rule.base, dayType: null });
    return { ...j, days, gear: (j.gear || []).map((g) => (g.auto ? { ...g, qty: days.length } : g)) };
  });
  const setDay = (date, patch) => upd((j) => ({ ...j, days: j.days.map((d) => (d.date === date ? { ...d, ...patch } : d)) }));
  const addExpense = (type) => upd((j) => ({ ...j, expenses: [...(j.expenses || []), { id: uid(), type, date: dates[0] || todayISO(), note: '', amount: 0, receipt_id: null }] }));
  const setExp = (id, patch) => upd((j) => ({ ...j, expenses: j.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  return (
    <section className="card job" style={{ zIndex: calOpen ? 6 : 1 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
        <Combobox label="Company / project" value={job.company || null} options={companyOptions} placeholder="Search companies"
          onChange={(v) => upd((j) => ({ ...j, company: v || '' }))} onCreate={(q) => upd((j) => ({ ...j, company: q }))} createLabel={(q) => `Use “${q}”`} />
        <Field label="Role">
          <input className="input" list={`roles-${job.id}`} value={job.role} onChange={(e) => {
            const r = roles.find((x) => x.name === e.target.value);
            upd((j) => ({ ...j, role: e.target.value, rate: r ? num(r.rate) : j.rate }));
          }} />
          <datalist id={`roles-${job.id}`}>{roles.map((r) => <option key={r.id} value={r.name} />)}</datalist>
        </Field>
        <Field label="Day rate"><MoneyInput value={job.rate} onChange={(v) => upd((j) => ({ ...j, rate: v }))} /></Field>
        <div className="field">
          <span>Shoot days</span>
          <Popover open={calOpen} setOpen={setCalOpen} align="right" width={310}
            trigger={
              <button type="button" className="input row between" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => setCalOpen((o) => !o)} aria-label="Pick shoot days">
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: dates.length ? 'var(--ink)' : 'var(--muted)' }}>{dates.length ? datesLabel(dates) : 'Pick days'}</span>
                <Icon name="calendar" size={16} />
              </button>
            }>
            <Calendar value={dates} onChange={setDates} busy={otherBusy} />
            <div className="row between" style={{ paddingTop: 8, borderTop: '1px solid var(--line-2)', marginTop: 4 }}>
              <span className="small muted num">{dates.length} day{dates.length === 1 ? '' : 's'}</span>
              <Button size="sm" variant="primary" onClick={() => setCalOpen(false)}>Done</Button>
            </div>
          </Popover>
        </div>
      </div>

      {job.days.length > 0 && (
        <div className="row wrap" style={{ gap: 8 }}>
          {labor.per.map((d) => (
            <div key={d.date} className={`daychip ${d.ot > 0 ? 'ot' : ''}`}>
              <span className="small" style={{ fontWeight: 500, minWidth: 48 }}>{fmtShort(d.date).replace(/^(\w+) /, '$1 ')}</span>
              <select aria-label="Day type" value={d.dayType || 'Full day'} onChange={(e) => setDay(d.date, { dayType: e.target.value === 'Full day' ? null : e.target.value })} style={{ border: 0, background: 'transparent', fontSize: 12, color: 'var(--muted)', maxWidth: 96 }}>
                {db.day_types.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              {d.mult >= 1 && (
                <>
                  <button type="button" className="mini" aria-label="Fewer hours" onClick={() => setDay(d.date, { hours: Math.max(1, num(d.hours ?? rule.base) - 1) })}>−</button>
                  <span className="num small" style={{ minWidth: 28, textAlign: 'center' }}>{d.hours ?? rule.base}h</span>
                  <button type="button" className="mini" aria-label="More hours" onClick={() => setDay(d.date, { hours: Math.min(24, num(d.hours ?? rule.base) + 1) })}>+</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {(job.gear || []).map((g) => (
        <div key={g.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) 90px 110px 36px', gap: 8, alignItems: 'center' }}>
          <span className="row" style={{ gap: 8 }}><Icon name="camera" size={16} style={{ color: 'var(--muted)' }} /><b style={{ fontWeight: 500 }}>{g.name}</b></span>
          <label className="row small muted" style={{ gap: 4 }}>× <MoneyInput value={g.qty} onChange={(v) => upd((j) => ({ ...j, gear: j.gear.map((x) => (x.id === g.id ? { ...x, qty: v, auto: false } : x)) }))} aria-label="Days" /></label>
          <MoneyInput value={g.rate} onChange={(v) => upd((j) => ({ ...j, gear: j.gear.map((x) => (x.id === g.id ? { ...x, rate: v } : x)) }))} aria-label="Rate per day" />
          <Button variant="ghost icon" icon="x" aria-label="Remove gear" onClick={() => upd((j) => ({ ...j, gear: j.gear.filter((x) => x.id !== g.id) }))} />
        </div>
      ))}

      {(job.expenses || []).length > 0 && (
        <div className="col" style={{ gap: 8, borderTop: '1px solid var(--line-2)', paddingTop: 10 }}>
          {job.expenses.map((e) => (
            <div key={e.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(84px,1fr) 84px minmax(110px,2fr) minmax(76px,96px) 36px 36px', gap: 8, alignItems: 'center' }} className="exp-row">
              <input className="input" list="exp-types" value={e.type} onChange={(ev) => setExp(e.id, { type: ev.target.value })} aria-label="Expense type" />
              <select className="input" value={e.date} onChange={(ev) => setExp(e.id, { date: ev.target.value })} aria-label="Day">
                {[...new Set([...dates, e.date])].sort().map((d) => <option key={d} value={d}>{mmdd(d)}</option>)}
              </select>
              <input className="input" value={e.note} placeholder={`${job.company || 'Company'} (${mmdd(e.date)})`} onChange={(ev) => setExp(e.id, { note: ev.target.value })} aria-label="Shown on invoice" />
              <MoneyInput value={e.amount} onChange={(v) => setExp(e.id, { amount: v })} aria-label="Amount" />
              <button type="button" className="mini" style={{ width: 36, height: 36, background: e.receipt_id ? 'var(--accent-bg)' : undefined, color: e.receipt_id ? 'var(--accent-ink)' : 'var(--muted)', borderStyle: e.receipt_id ? 'solid' : 'dashed' }}
                title={e.receipt_id ? 'Receipt attached (click to change)' : 'Attach a receipt'} aria-label={e.receipt_id ? 'Receipt attached' : 'Attach a receipt'}
                onClick={() => openPicker({ type: 'receipts', single: true, title: 'Attach a receipt', exclude: new Set(), onPick: ([r]) => r && setExp(e.id, { receipt_id: r.id, amount: num(r.total) || e.amount, date: r.receipt_date && dates.includes(r.receipt_date) ? r.receipt_date : e.date }) })}>
                <Icon name="receipt" size={16} />
              </button>
              <Button variant="ghost icon" icon="x" aria-label="Remove expense" onClick={() => upd((j) => ({ ...j, expenses: j.expenses.filter((x) => x.id !== e.id) }))} />
            </div>
          ))}
          <datalist id="exp-types">{['Parking', 'Meal', 'Uber', 'Lyft', 'Gas', 'Tolls', 'Hotel', 'Flight', 'Baggage', 'Supplies', 'Other'].map((x) => <option key={x} value={x} />)}</datalist>
        </div>
      )}

      <div className="row wrap between" style={{ gap: 8 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <Button size="sm" onClick={() => addExpense('Parking')}>+ Parking</Button>
          <Button size="sm" onClick={() => addExpense('Meal')}>+ Meal</Button>
          <Button size="sm" onClick={() => addExpense('Other')}>+ Other</Button>
          {gearItems.length > 0 && <Menu label="Gear" icon="plus" variant="sm" align="left" items={gearItems.map((g) => ({ label: `${g.name} · ${money(g.rate)}/day`, onClick: () => upd((j) => ({ ...j, gear: [...(j.gear || []), { id: uid(), name: g.name, rate: num(g.rate), qty: Math.max(1, dates.length), auto: true }] })) }))} />}
          <Menu label="" icon="more" variant="sm" align="left" items={[{ label: 'Remove this job', icon: 'trash', danger: true, onClick: remove }]} />
        </div>
        <span className="col" style={{ alignItems: 'flex-end', gap: 0 }}>
          <span className="num" style={{ fontSize: 16, fontWeight: 500 }}>{money(labor.total + exp + gear)}</span>
          <span className="small muted">{dates.length} day{dates.length === 1 ? '' : 's'}{labor.otHours ? ` · ${labor.otHours} h OT` : ''}{gear ? ` · ${money(gear)} gear` : ''}{exp ? ` · ${money(exp)} expenses` : ''}</span>
        </span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Receipts: billed ones are lines, the rest ride along as backup      */
/* ------------------------------------------------------------------ */
function ReceiptsPanel({ db, attachIds, setAttachIds, billed, openPicker, bill }) {
  const all = new Set([...attachIds, ...billed]);
  const list = db.receipts.filter((r) => all.has(r.id));
  return (
    <>
      {list.map((r) => (
        <div key={r.id} className="row between ed-item">
          <span className="col" style={{ gap: 0, minWidth: 0 }}><b style={{ fontWeight: 500 }}>{r.vendor || 'Receipt'}</b><span className="small muted num">{fmtShort(r.receipt_date)} · {money(r.total)}</span></span>
          <span className="row" style={{ flexWrap: 'nowrap' }}>
            {billed.has(r.id) ? <span className="pill sent">Billed</span> : <span className="pill draft">Attached</span>}
            {!billed.has(r.id) && <Button variant="ghost icon" icon="x" aria-label="Detach" onClick={() => setAttachIds(new Set([...attachIds].filter((x) => x !== r.id)))} />}
          </span>
        </div>
      ))}
      <div className="row wrap" style={{ gap: 8 }}>
        <Button size="sm" icon="plus" onClick={() => openPicker({ type: 'receipts', title: 'Bill receipts', exclude: all, onPick: bill })}>Bill</Button>
        <Button size="sm" variant="ghost" icon="plus" onClick={() => openPicker({ type: 'receipts', title: 'Attach receipts', exclude: all, onPick: (rs) => setAttachIds(new Set([...attachIds, ...rs.map((r) => r.id)])) })}>Attach</Button>
      </div>
    </>
  );
}

function ReceiptPicker({ db, exclude, onPick, onClose, title, ctx }) {
  const [sel, setSel] = useState(new Set());
  const [q, setQ] = useState('');
  const list = db.receipts
    .filter((r) => !exclude?.has(r.id))
    .filter((r) => !q || `${r.vendor} ${r.category} ${r.total}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(b.receipt_date || '').localeCompare(String(a.receipt_date || '')));
  const { suggested, rest } = q ? { suggested: [], rest: list } : rankReceipts(list, ctx);
  return (
    <Modal title={title || 'Choose receipts'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!sel.size} onClick={() => onPick(db.receipts.filter((r) => sel.has(r.id)))}>Add {sel.size || ''}</Button></>}>
      <input className="input" placeholder="Search vendor, category, amount" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="col" style={{ gap: 0, maxHeight: 380, overflowY: 'auto' }}>
        {list.length === 0 && <Empty icon="receipt" title="No receipts to add">Add receipts in Expenses first.</Empty>}
        {[...suggested, ...rest].map((r, k) => (
          <div key={r.id}>
          {suggested.length > 0 && (k === 0 || k === suggested.length) && <div className="pick-group">{k === 0 ? 'Suggested' : 'All receipts'}</div>}
          <label className={`check ${k < suggested.length ? 'suggested' : ''}`} style={{ borderTop: '1px solid var(--line-2)', padding: '6px 0' }}>
            <input type="checkbox" checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} />
            <span className="grow col" style={{ gap: 0 }}><b style={{ fontWeight: 500, color: 'var(--ink)' }}>{r.vendor || 'Receipt'}</b><span className="small muted">{fmtShort(r.receipt_date)} · {r.category || 'Uncategorized'}{r.invoice_id ? ` · on invoice #${db.invoices.find((i) => i.id === r.invoice_id)?.number}` : ''}</span></span>
            <span className="num">{money(r.total)}</span>
          </label>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function MileagePicker({ db, derived, selected, onPick, onClose }) {
  const [sel, setSel] = useState(new Set());
  const list = db.mileage_trips.filter((t) => t.billable && !t.invoice_id && !selected.has(t.id));
  return (
    <Modal title="Bill mileage" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!sel.size} onClick={() => onPick(list.filter((t) => sel.has(t.id)))}>Add {sel.size || ''}</Button></>}>
      {list.length === 0 && <Empty icon="car" title="No billable trips">Log trips in Expenses → Mileage and mark them “Bill to client”.</Empty>}
      {list.map((t) => (
        <label key={t.id} className="check" style={{ borderTop: '1px solid var(--line-2)' }}>
          <input type="checkbox" checked={sel.has(t.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} />
          <span className="grow">{fmtShort(t.trip_date)} · {[t.start_place, t.end_place].filter(Boolean).join(' → ')} <span className="muted">{derived.clients[t.client_id]?.name || ''}</span></span>
          <span className="num">{num(t.miles) * (t.round_trip ? 2 : 1)} mi</span>
        </label>
      ))}
    </Modal>
  );
}
