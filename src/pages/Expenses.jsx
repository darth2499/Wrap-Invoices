import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Empty, Field, Icon, Modal, MoneyInput, Pill, Seg, Switch, Combobox } from '../components/ui.jsx';
import { CATEGORIES, categoryLabel } from '../lib/categories.js';
import { addReceiptFile } from '../lib/receipts.js';
import { setBillable } from '../lib/actions.js';
import { money, fmtDate, fmtShort, num, todayISO, round2, plural, inPeriod, periodOptions } from '../lib/format.js';
import { pickFiles, sha256 } from '../lib/files.js';
import { go } from '../router.js';
import { takeFiles, onFiles } from '../lib/scanQueue.js';

export default function Expenses({ tab, query }) {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Expenses</h1>
        <Seg value={tab} onChange={(t) => go(`/expenses${t === 'receipts' ? '' : `/${t}`}`)} label="Expense type" options={[{ value: 'receipts', label: 'Receipts' }, { value: 'mileage', label: 'Mileage' }, { value: 'crew', label: 'Crew payouts' }]} />
      </div>
      {tab === 'mileage' ? <Mileage /> : tab === 'crew' ? <Crew /> : <Receipts query={query} />}
    </div>
  );
}

/* ================================================================== */
/* Receipts                                                            */
/* ================================================================== */
function Receipts({ query }) {
  const s = useStore();
  const { db, derived } = s;
  const [filter, setFilter] = useState(query.status === 'review' ? 'review' : 'all');
  const [year, setYear] = useState('all');
  const [q, setQ] = useState('');
  const [queue, setQueue] = useState([]); // { name, step, status, message }
  const [open, setOpen] = useState(null);
  const [urls, setUrls] = useState({});
  const [over, setOver] = useState(false);
  const busy = queue.some((x) => x.status === 'working');

  const years = [...new Set(db.receipts.map((r) => r.receipt_date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return db.receipts
      .filter((r) => filter === 'all' || (filter === 'review' ? r.status === 'review' : filter === 'unattached' ? !r.invoice_id : !!r.invoice_id))
      .filter((r) => inPeriod(r.receipt_date, year))
      .filter((r) => !t || `${r.vendor} ${r.category} ${r.total} ${r.notes}`.toLowerCase().includes(t))
      .sort((a, b) => (a.status === 'review' ? 0 : 1) - (b.status === 'review' ? 0 : 1) || String(b.receipt_date || b.created_at).localeCompare(String(a.receipt_date || a.created_at)));
  }, [db.receipts, filter, year, q]);
  const shownKeys = list.slice(0, 120).map((r) => r.file_key).filter(Boolean);

  useEffect(() => {
    const missing = shownKeys.filter((k) => !urls[k]);
    if (missing.length) s.api.files.urls(missing).then((u) => setUrls((x) => ({ ...x, ...u }))).catch(() => {});
  }, [shownKeys.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addFiles(files) {
    if (!files.length) return;
    const items = files.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name, step: 'Waiting…', status: 'waiting' }));
    setQueue((qq) => [...qq.filter((x) => x.status === 'working'), ...items]);
    const known = [...db.receipts];
    const added = [];
    let dupes = 0;
    for (const [i, f] of files.entries()) {
      const id = items[i].id;
      const setItem = (patch) => setQueue((qq) => qq.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      setItem({ status: 'working' });
      const res = await addReceiptFile(f, { api: s.api, receipts: known, onStep: (step) => setItem({ step }) });
      if (res.status === 'added') {
        known.push(res.receipt);
        added.push(res.receipt);
        s.setDb((d) => ({ ...d, receipts: [...d.receipts, res.receipt] }));
        setItem({ status: 'done', step: `${res.receipt.vendor || 'Receipt'} · ${res.receipt.total != null ? money(res.receipt.total) : 'amount?'}`, message: res.message, receiptId: res.receipt.id });
      } else if (res.status === 'duplicate') {
        dupes++;
        setItem({ status: 'dupe', step: 'Duplicate — skipped', message: res.message });
        if (res.fuzzy) {
          let kept = false;
          s.toast(res.message, {
            ms: 10000,
            action: { label: 'Keep anyway', run: async () => {
              kept = true;
              const saved = await res.keep();
              s.setDb((d) => ({ ...d, receipts: [...d.receipts, saved] }));
              setItem({ status: 'done', step: `${saved.vendor || 'Receipt'} · kept`, receiptId: saved.id, message: 'Kept even though it looked like a duplicate' });
            } },
          });
          setTimeout(() => { if (!kept) res.discard(); }, 11000);
        }
      } else setItem({ status: 'error', step: 'Couldn’t add', message: res.message });
    }
    if (dupes > 1) s.toast(`${plural(dupes, 'duplicate')} skipped`);
    if (added.length === 1) setOpen(added[0].id);
    else if (added.length > 1) { setFilter('review'); s.toast(`${added.length} receipts added — check them below`); }
  }

  // Photos taken with the phone's bottom Scan button.
  useEffect(() => {
    const run = () => { const f = takeFiles(); if (f) addFiles(f); };
    run();
    return onFiles(run);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reviewCount = db.receipts.filter((r) => r.status === 'review').length;
  const highConf = db.receipts.filter((r) => r.status === 'review' && r.ai?.confidence === 'high' && r.ai?.check !== 'mismatch' && r.total != null && r.receipt_date);
  const total = list.reduce((t, r) => t + num(r.total), 0);
  const cameraRef = useRef(null);

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <button className="card phone-only" style={{ padding: 22, alignItems: 'center', gap: 14, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }} onClick={() => cameraRef.current?.click()} disabled={busy}>
          <span style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="camera" size={22} /></span>
          <span className="col" style={{ gap: 2 }}><strong>Scan a receipt</strong><span className="small muted">Opens your camera. Auto-crops and sharpens.</span></span>
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }} />
        <div
          className={`drop ${over ? 'over' : ''}`} role="button" tabIndex={0}
          onClick={async () => !busy && addFiles(await pickFiles({ accept: 'image/*,application/pdf', multiple: true }))}
          onKeyDown={async (e) => e.key === 'Enter' && addFiles(await pickFiles({ accept: 'image/*,application/pdf', multiple: true }))}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles([...e.dataTransfer.files]); }}
        >
          <Icon name="upload" size={24} />
          <strong>Drop photos or PDFs here</strong>
          <span className="small muted">or click to choose · duplicates are skipped automatically</span>
        </div>
      </div>

      {queue.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>{busy ? 'Adding receipts…' : 'Just added'}</h2>{!busy && <Button size="sm" variant="ghost" onClick={() => setQueue([])}>Clear</Button>}</div>
          {queue.map((x) => (
            <div key={x.id} className="list-row" style={{ gridTemplateColumns: '22px 1fr auto', cursor: x.receiptId ? 'pointer' : 'default' }} onClick={() => x.receiptId && setOpen(x.receiptId)}>
              {x.status === 'working' ? <span className="spinner" style={{ color: 'var(--accent)' }} /> : <Icon name={x.status === 'done' ? 'check' : x.status === 'dupe' ? 'copy' : x.status === 'error' ? 'x' : 'file'} size={18} style={{ color: x.status === 'done' ? 'var(--good)' : x.status === 'error' ? 'var(--bad)' : 'var(--muted)' }} />}
              <span className="col" style={{ gap: 0, minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.step}</span>
                <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.message || x.name}</span>
              </span>
              {x.receiptId && <span className="small" style={{ color: 'var(--accent)' }}>Check</span>}
            </div>
          ))}
        </section>
      )}

      <div className="row wrap between">
        <div className="row wrap">
          <Seg value={filter} onChange={setFilter} label="Filter" options={[{ value: 'all', label: 'All' }, { value: 'review', label: 'To review', count: reviewCount }, { value: 'unattached', label: 'Not on an invoice' }, { value: 'attached', label: 'On an invoice' }]} />
          <select className="input" style={{ width: 160 }} value={year} onChange={(e) => setYear(e.target.value)} aria-label="Period">{periodOptions(db.receipts.map((r) => r.receipt_date)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </div>
        <div className="row wrap">
          {highConf.length > 0 && filter === 'review' && <Button size="sm" icon="check" onClick={async () => { for (const r of highConf) await s.update('receipts', r.id, { status: 'confirmed' }); s.toast(`${highConf.length} confirmed`); }}>Confirm {highConf.length} sure ones</Button>}
          <input className="input search" style={{ width: 220 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search receipts" />
        </div>
      </div>

      <section className="card">
        {list.length === 0 ? (
          <Empty icon="receipt" title={db.receipts.length ? 'Nothing matches' : 'No receipts yet'}>{!db.receipts.length && 'Scan or drop your first receipt above.'}</Empty>
        ) : (
          <>
          <div className="m-list">
            {list.slice(0, 400).map((r) => (
              <button type="button" key={r.id} className="m-card m-card-thumb" onClick={() => setOpen(r.id)}>
                <span className="thumb">{urls[r.file_key] && r.mime !== 'application/pdf' ? <img src={urls[r.file_key]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : r.mime === 'application/pdf' ? 'PDF' : <Icon name="receipt" size={16} />}</span>
                <span className="who">{r.vendor || 'Unknown vendor'}</span>
                <span className="amt num">{r.total != null ? money(r.total) : '—'}</span>
                <span className="meta">{fmtDate(r.receipt_date) || '—'} · {r.category || 'Uncategorized'}</span>
                <span className="st">{r.status === 'review' ? <Pill kind="review">Check</Pill> : r.invoice_id ? <span className="pill sent">#{derived.invoices[r.invoice_id]?.number}</span> : null}</span>
              </button>
            ))}
            <div className="row between small" style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}><span className="muted">{plural(list.length, 'receipt')}</span><strong className="num">{money(total)}</strong></div>
          </div>
          <div className="table-wrap d-only">
            <table className="table" style={{ minWidth: 720 }}>
              <thead><tr><th style={{ width: 56 }} /><th>Vendor</th><th>Date</th><th>Category</th><th>Invoice</th><th className="right">Amount</th></tr></thead>
              <tbody>
                {list.slice(0, 400).map((r) => (
                  <tr key={r.id} className="click" onClick={() => setOpen(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)}>
                    <td><span className="thumb">{urls[r.file_key] && r.mime !== 'application/pdf' ? <img src={urls[r.file_key]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : r.mime === 'application/pdf' ? 'PDF' : <Icon name="receipt" size={16} />}</span></td>
                    <td><div style={{ fontWeight: 500 }}>{r.vendor || <span className="muted">Unknown vendor</span>}</div>{r.status === 'review' && <Pill kind="review">Check</Pill>}</td>
                    <td className="muted">{fmtDate(r.receipt_date) || '—'}</td>
                    <td className="muted small">{categoryLabel(r.category)}</td>
                    <td>{r.invoice_id ? <a href={`#/invoices/${r.invoice_id}`} onClick={(e) => e.stopPropagation()} className="pill sent" style={{ textDecoration: 'none' }}>#{derived.invoices[r.invoice_id]?.number}{r.billable ? ' · billed' : ''}</a> : <span className="small muted">—</span>}</td>
                    <td className="right num">{r.total != null ? money(r.total) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5} className="small muted" style={{ borderTop: '1px solid var(--line)' }}>{plural(list.length, 'receipt')}</td><td className="right num" style={{ borderTop: '1px solid var(--line)', fontWeight: 600 }}>{money(total)}</td></tr></tfoot>
            </table>
          </div>
          </>
        )}
      </section>

      {open && <ReceiptModal id={open} onClose={() => setOpen(null)} onNext={(nid) => setOpen(nid)} />}
    </>
  );
}

export function ReceiptModal({ id, onClose, onNext }) {
  const s = useStore();
  const { db, derived } = s;
  const r = derived.receipts[id];
  const [f, setF] = useState(() => ({ vendor: r?.vendor || '', receipt_date: r?.receipt_date || todayISO(), total: r?.total ?? '', category: r?.category || '', notes: r?.notes || '', invoice_id: r?.invoice_id || null, billable: !!r?.billable }));
  const [view, setView] = useState('scan');
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (r) s.api.files.urls([r.file_key, r.original_key].filter(Boolean)).then(setUrls).catch(() => {});
  }, [r?.file_key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return null;
  const ai = r.ai || {};
  const chips = [];
  if (ai.total_paid != null) chips.push({ label: 'Total paid', amount: ai.total_paid });
  for (const a of ai.amounts || []) if (!chips.some((c) => Math.abs(c.amount - a.amount) < 0.005)) chips.push(a);
  if (ai.subtotal != null && !chips.some((c) => Math.abs(c.amount - ai.subtotal) < 0.005)) chips.push({ label: 'Subtotal', amount: ai.subtotal });
  const reviewQueue = db.receipts.filter((x) => x.status === 'review' && x.id !== id);
  const invoices = db.invoices.filter((i) => i.kind === 'invoice' && i.status !== 'void').sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)));
  const url = view === 'scan' ? urls[r.file_key] : urls[r.original_key];
  // Add a file to a receipt that has none (e.g. imported from Wave), or swap in a new one.
  const [fileBusy, setFileBusy] = useState(false);
  const attachFile = async () => {
    const [file] = await pickFiles({ accept: 'image/*,application/pdf' });
    if (!file) return;
    setFileBusy(true);
    try {
      const isPdf = file.type === 'application/pdf';
      const ext = isPdf ? 'pdf' : (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const key = await s.api.files.upload(file, { folder: 'receipts', ext });
      const old = [r.file_key, r.original_key].filter(Boolean);
      await s.update('receipts', r.id, { file_key: key, original_key: null, mime: file.type || (isPdf ? 'application/pdf' : 'image/jpeg'), file_hash: await sha256(file) });
      if (old.length) await s.api.files.remove(old).catch(() => {});
      setView('scan');
      s.toast(old.length ? 'File replaced' : 'File added');
    } catch (e) {
      s.toast(e.message, { error: true });
    }
    setFileBusy(false);
  };

  const save = async (next) => {
    setBusy(true);
    try {
      const patch = { vendor: f.vendor || null, receipt_date: f.receipt_date || null, total: f.total === '' ? null : round2(f.total), category: f.category || null, notes: f.notes || null, status: 'confirmed' };
      const prev = r;
      const wasBilled = !!(prev.invoice_id && prev.billable);
      const willBill = !!(f.invoice_id && f.billable);
      const sameInv = prev.invoice_id === f.invoice_id;
      const lineChanged = wasBilled && willBill && sameInv && (round2(prev.total) !== patch.total || prev.vendor !== patch.vendor || prev.receipt_date !== patch.receipt_date || prev.category !== patch.category);
      // Invoice link/billing goes through the invoice so its lines and totals stay right.
      if (wasBilled && (!willBill || !sameInv)) await setBillable(s, derived.invoices[prev.invoice_id], prev, false);
      await s.update('receipts', r.id, { ...patch, invoice_id: f.invoice_id, billable: wasBilled && willBill && sameInv });
      if (willBill && (!wasBilled || !sameInv || lineChanged)) await setBillable(s, derived.invoices[f.invoice_id], { ...r, ...patch }, true);
      s.toast('Receipt saved');
      if (next && reviewQueue[0]) onNext(reviewQueue[0].id);
      else onClose();
    } catch (e) {
      s.toast(e.message, { error: true });
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!(await s.confirm({ title: 'Delete this receipt?', body: 'The scan and original photo are deleted too.', ok: 'Delete', danger: true }))) return;
    if (r.invoice_id && r.billable) await setBillable(s, derived.invoices[r.invoice_id], r, false);
    await s.remove('receipts', r.id);
    await s.api.files.remove([r.file_key, r.original_key]).catch(() => {});
    onClose();
  };

  return (
    <Modal wide title={r.status === 'review' ? 'Check this receipt' : 'Receipt'} onClose={onClose} footer={
      <>
        <Button variant="ghost" className="danger" icon="trash" onClick={del} style={{ marginRight: 'auto' }}>Delete</Button>
        {r.status === 'review' && reviewQueue.length > 0 && <Button busy={busy} onClick={() => save(true)}>Save &amp; next ({reviewQueue.length})</Button>}
        <Button variant="primary" busy={busy} onClick={() => save(false)}>{r.status === 'review' ? 'Looks right — save' : 'Save'}</Button>
      </>
    }>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div className="col" style={{ flex: '1 1 280px', minWidth: 0, gap: 8 }}>
          {r.original_key && <Seg value={view} onChange={setView} label="Image" options={[{ value: 'scan', label: ai.cropped === false ? 'Cleaned up' : 'Cropped · sharpened' }, { value: 'orig', label: 'Original photo' }]} />}
          <div style={{ background: '#e9e9e5', borderRadius: 12, minHeight: 240, maxHeight: 'min(520px, 48vh)', overflow: 'auto', display: 'grid', placeItems: 'center' }}>
            {!r.file_key
              ? <button type="button" className="file-drop" onClick={attachFile} disabled={fileBusy}>{fileBusy ? <span className="spinner" /> : <Icon name="upload" size={22} />}<span>Add receipt image or PDF</span></button>
              : !url ? <span className="spinner" /> : r.mime === 'application/pdf' && view === 'scan' ? <iframe title="Receipt PDF" src={url} style={{ width: '100%', height: 500, border: 0 }} /> : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Receipt" style={{ maxWidth: '100%', display: 'block' }} /></a>}
          </div>
          {r.file_key && <Button size="sm" variant="ghost" icon="upload" busy={fileBusy} onClick={attachFile} style={{ alignSelf: 'flex-start' }}>Replace file</Button>}
        </div>
        <div className="col" style={{ flex: '1 1 300px', gap: 12 }}>
          {r.status === 'review' && ai.reasoning && (
            <div className={`banner ${ai.error ? 'bad' : ai.check === 'mismatch' || ai.confidence === 'low' ? 'warn' : 'good'}`}>
              <Icon name="sparkle" />
              <span>{ai.error ? `Couldn’t read automatically: ${ai.error}` : ai.reasoning}{ai.check === 'mismatch' ? ' The subtotal + tax + tip don’t add up to the total — double-check.' : ''}</span>
            </div>
          )}
          <Field label="Total you paid">
            <MoneyInput value={f.total} onChange={(v) => setF({ ...f, total: v })} style={{ fontSize: 20, fontWeight: 600, minHeight: 48 }} />
          </Field>
          {chips.length > 1 && (
            <div className="col" style={{ gap: 6 }}>
              <span className="small muted">Wrong number? Tap the right one:</span>
              <div className="row wrap" style={{ gap: 6 }}>
                {chips.slice(0, 8).map((c, i) => (
                  <button key={i} type="button" className="btn sm" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0, minHeight: 44, padding: '4px 10px', borderColor: Math.abs(num(f.total) - c.amount) < 0.005 ? 'var(--ink)' : undefined }} onClick={() => setF({ ...f, total: c.amount })}>
                    <span className="num">{money(c.amount)}</span><span className="small muted" style={{ fontWeight: 400 }}>{c.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <Field label="Vendor"><input className="input" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></Field>
            <Field label="Date"><input className="input" type="date" value={f.receipt_date || ''} onChange={(e) => setF({ ...f, receipt_date: e.target.value })} /></Field>
          </div>
          <Field label="Category (Schedule C)">
            <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              <option value="">Choose…</option>
              {CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.name} · line {c.line}</option>)}
            </select>
          </Field>
          <Field label="Attach to invoice" hint="(optional)">
            <select className="input" value={f.invoice_id || ''} onChange={(e) => setF({ ...f, invoice_id: e.target.value || null, billable: e.target.value ? f.billable : false })}>
              <option value="">Not attached</option>
              {invoices.map((i) => <option key={i.id} value={i.id}>#{i.number} · {derived.clients[i.client_id]?.name || 'No client'} · {fmtShort(i.issue_date)}{i.status === 'draft' ? ' (draft)' : ''}</option>)}
            </select>
          </Field>
          {f.invoice_id && (
            <label className="row between" style={{ minHeight: 44, padding: '0 12px', border: '1px solid var(--field)', borderRadius: 10 }}>
              <span>Bill the client for this</span>
              <Switch checked={f.billable} onChange={(v) => setF({ ...f, billable: v })} label="Bill the client" />
            </label>
          )}
          <Field label="Notes" hint="(optional)"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Lunch for crew on set" /></Field>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* Mileage                                                             */
/* ================================================================== */
function Mileage() {
  const s = useStore();
  const { db, derived } = s;
  const [year, setYear] = useState(todayISO().slice(0, 4));
  const [edit, setEdit] = useState(null);
  const trips = db.mileage_trips.filter((t) => t.trip_date?.startsWith(year)).sort((a, b) => (a.trip_date < b.trip_date ? 1 : -1));
  const miles = (t) => num(t.miles) * (t.round_trip ? 2 : 1);
  const totalMiles = trips.reduce((x, t) => x + miles(t), 0);
  const deduction = trips.reduce((x, t) => x + miles(t) * num(t.rate), 0);
  const years = [...new Set([todayISO().slice(0, 4), ...db.mileage_trips.map((t) => t.trip_date?.slice(0, 4))].filter(Boolean))].sort().reverse();
  return (
    <>
      <div className="grid">
        <div className="card kpi"><span className="muted">Business miles · {year}</span><span className="v">{totalMiles.toLocaleString('en-US')}</span><span className="small muted">{plural(trips.length, 'trip')}</span></div>
        <div className="card kpi"><span className="muted">Mileage deduction</span><span className="v">{money(deduction, { cents: false })}</span><span className="small muted">At {money(db.profile.mileage_rate)}/mile · change in Settings</span></div>
      </div>
      <div className="row wrap between">
        <select className="input" style={{ width: 110 }} value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">{years.map((y) => <option key={y}>{y}</option>)}</select>
        <Button variant="primary" icon="plus" onClick={() => setEdit({})}>Log a trip</Button>
      </div>
      <section className="card">
        {trips.length === 0 ? <Empty icon="car" title="No trips logged">Log drives to shoots, gear pickups and client meetings. Commuting to a regular workplace doesn’t count.</Empty> : (
          <>
          <div className="m-list">
            {trips.map((t) => (
              <button type="button" key={t.id} className="m-card" onClick={() => setEdit(t)}>
                <span className="who">{[t.start_place, t.end_place].filter(Boolean).join(' → ') || 'Trip'}</span>
                <span className="amt num">{miles(t)} mi</span>
                <span className="meta">{fmtDate(t.trip_date)}{t.purpose ? ` · ${t.purpose}` : ''}{t.client_id ? ` · ${derived.clients[t.client_id]?.name}` : ''}</span>
                <span className="st">{t.invoice_id ? <span className="pill sent">#{derived.invoices[t.invoice_id]?.number}</span> : t.billable ? <span className="pill partial">To bill</span> : null}</span>
              </button>
            ))}
          </div>
          <div className="table-wrap d-only">
            <table className="table" style={{ minWidth: 640 }}>
              <thead><tr><th>Date</th><th>Trip</th><th>Purpose</th><th>Billing</th><th className="right">Miles</th></tr></thead>
              <tbody>
                {trips.map((t) => (
                  <tr key={t.id} className="click" onClick={() => setEdit(t)}>
                    <td className="muted">{fmtDate(t.trip_date)}</td>
                    <td>{[t.start_place, t.end_place].filter(Boolean).join(' → ')}{t.round_trip && <span className="small muted"> · round trip</span>}</td>
                    <td className="muted">{t.purpose}{t.client_id && ` · ${derived.clients[t.client_id]?.name}`}</td>
                    <td>{t.invoice_id ? <span className="pill sent">#{derived.invoices[t.invoice_id]?.number}</span> : t.billable ? <span className="pill partial">To bill</span> : <span className="small muted">—</span>}</td>
                    <td className="right num">{miles(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
      {edit && <TripModal trip={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function TripModal({ trip, onClose }) {
  const s = useStore();
  const isNew = !trip.id;
  const [f, setF] = useState({ trip_date: trip.trip_date || todayISO(), start_place: trip.start_place || '', end_place: trip.end_place || '', miles: trip.miles ?? '', round_trip: trip.round_trip ?? true, purpose: trip.purpose || '', client_id: trip.client_id || null, billable: !!trip.billable });
  const save = async () => {
    const row = { ...f, miles: num(f.miles), rate: trip.rate ?? s.db.profile.mileage_rate };
    if (isNew) await s.insert('mileage_trips', row);
    else await s.update('mileage_trips', trip.id, row);
    onClose();
  };
  return (
    <Modal title={isNew ? 'Log a trip' : 'Edit trip'} onClose={onClose} footer={<>{!isNew && <Button variant="ghost" className="danger" icon="trash" style={{ marginRight: 'auto' }} onClick={async () => { await s.remove('mileage_trips', trip.id); onClose(); }}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!num(f.miles)}>Save</Button></>}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Date"><input className="input" type="date" value={f.trip_date} onChange={(e) => setF({ ...f, trip_date: e.target.value })} /></Field>
        <Field label="Miles (one way)"><MoneyInput value={f.miles} onChange={(v) => setF({ ...f, miles: v })} /></Field>
        <Field label="From"><input className="input" value={f.start_place} onChange={(e) => setF({ ...f, start_place: e.target.value })} placeholder="Home" /></Field>
        <Field label="To"><input className="input" value={f.end_place} onChange={(e) => setF({ ...f, end_place: e.target.value })} placeholder="Shoot location" /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.round_trip} onChange={(e) => setF({ ...f, round_trip: e.target.checked })} />Round trip (counts the miles twice)</label>
      <Field label="Purpose"><input className="input" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="e.g. Brand shoot" /></Field>
      <Combobox label="Client (optional)" value={f.client_id} options={s.db.clients.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => setF({ ...f, client_id: v })} placeholder="Search clients" />
      <label className="check"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} />Bill this to the client (add it from the invoice editor → Mileage)</label>
    </Modal>
  );
}

/* ================================================================== */
/* Crew payouts                                                        */
/* ================================================================== */
const NEC_THRESHOLD = 2000; // 1099-NEC filing threshold for payments made in 2026+ (was $600 before). Check with your tax preparer.

function Crew() {
  const s = useStore();
  const { db, derived } = s;
  const [year, setYear] = useState(todayISO().slice(0, 4));
  const [edit, setEdit] = useState(null);
  const [member, setMember] = useState(null);
  const pays = db.crew_payouts.filter((p) => (p.paid_on || p.work_date)?.startsWith(year)).sort((a, b) => (a.work_date < b.work_date ? 1 : -1));
  const unpaid = db.crew_payouts.filter((p) => !p.paid_on);
  const byMember = db.crew_members.map((m) => ({ m, paid: db.crew_payouts.filter((p) => p.crew_id === m.id && p.paid_on?.startsWith(year)).reduce((t, p) => t + num(p.amount), 0) })).sort((a, b) => b.paid - a.paid);
  const years = [...new Set([todayISO().slice(0, 4), ...db.crew_payouts.map((p) => (p.paid_on || p.work_date)?.slice(0, 4))].filter(Boolean))].sort().reverse();
  return (
    <>
      <div className="grid">
        <div className="card kpi"><span className="muted">Paid to crew · {year}</span><span className="v">{money(byMember.reduce((t, x) => t + x.paid, 0), { cents: false })}</span><span className="small muted">Counts as contract labor (Schedule C line 11)</span></div>
        <div className="card kpi"><span className="muted">You still owe crew</span><span className="v">{money(unpaid.reduce((t, p) => t + num(p.amount), 0), { cents: false })}</span><span className="small muted">{plural(unpaid.length, 'unpaid payout')}</span></div>
      </div>
      <div className="row wrap between">
        <select className="input" style={{ width: 110 }} value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">{years.map((y) => <option key={y}>{y}</option>)}</select>
        <div className="row wrap"><Button icon="crew" onClick={() => setMember({})}>Add crew member</Button><Button variant="primary" icon="plus" disabled={!db.crew_members.length} onClick={() => setEdit({})}>Add payout</Button></div>
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Payouts</h2></div>
          {pays.length === 0 && <Empty icon="crew" title="No payouts">When you hire a 2nd shooter, AC or PA, log what you owe them here.</Empty>}
          {pays.map((p) => (
            <button key={p.id} className="list-row" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => setEdit(p)}>
              <span className="col" style={{ gap: 0 }}><b style={{ fontWeight: 500 }}>{derived.crew[p.crew_id]?.name} · {p.description || 'Work'}</b><span className="small muted">{fmtDate(p.work_date)}{p.client_id ? ` · ${derived.clients[p.client_id]?.name}` : ''}</span></span>
              <span className="col" style={{ alignItems: 'flex-end', gap: 2 }}><span className="num">{money(p.amount)}</span>{p.paid_on ? <span className="pill paid">Paid {fmtShort(p.paid_on)}</span> : <span className="pill overdue">Unpaid</span>}</span>
            </button>
          ))}
        </section>
        <section className="card">
          <div className="card-head"><h2>Crew · {year} totals</h2></div>
          {byMember.length === 0 && <Empty icon="user" title="No crew yet" />}
          {byMember.map(({ m, paid }) => (
            <button key={m.id} className="list-row" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => setMember(m)}>
              <span className="col" style={{ gap: 0 }}><b style={{ fontWeight: 500 }}>{m.name}</b><span className="small muted">{m.role || ''}{paid >= NEC_THRESHOLD ? ' · may need a 1099-NEC from you' : ''}</span></span>
              <span className="num">{money(paid)}</span>
            </button>
          ))}
          <p className="small muted" style={{ padding: '10px 20px 16px' }}>If you pay one person {money(NEC_THRESHOLD, { cents: false })} or more in a year for business work, you may need to send them a 1099-NEC. Collect a W-9 when you hire them. Check the current rules with your tax preparer.</p>
        </section>
      </div>
      {edit && <PayoutModal p={edit} onClose={() => setEdit(null)} />}
      {member && <MemberModal m={member} onClose={() => setMember(null)} />}
    </>
  );
}

function PayoutModal({ p, onClose }) {
  const s = useStore();
  const isNew = !p.id;
  const [f, setF] = useState({ crew_id: p.crew_id || s.db.crew_members[0]?.id, work_date: p.work_date || todayISO(), description: p.description || '', client_id: p.client_id || null, amount: p.amount ?? '', paid_on: p.paid_on || '', method: p.method || '' });
  const save = async () => {
    const row = { ...f, amount: num(f.amount), paid_on: f.paid_on || null, method: f.method || null };
    if (isNew) await s.insert('crew_payouts', row);
    else await s.update('crew_payouts', p.id, row);
    onClose();
  };
  return (
    <Modal title={isNew ? 'Add crew payout' : 'Edit payout'} onClose={onClose} footer={<>{!isNew && <Button variant="ghost" className="danger" icon="trash" style={{ marginRight: 'auto' }} onClick={async () => { await s.remove('crew_payouts', p.id); onClose(); }}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!num(f.amount) || !f.crew_id}>Save</Button></>}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Crew member"><select className="input" value={f.crew_id} onChange={(e) => setF({ ...f, crew_id: e.target.value })}>{s.db.crew_members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <Field label="Work date"><input className="input" type="date" value={f.work_date} onChange={(e) => setF({ ...f, work_date: e.target.value })} /></Field>
        <Field label="Amount"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="What for"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. AC, 2 days" /></Field>
      </div>
      <Combobox label="Client / job (optional)" value={f.client_id} options={s.db.clients.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => setF({ ...f, client_id: v })} placeholder="Search clients" />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Paid on" hint="(leave empty if unpaid)"><input className="input" type="date" value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></Field>
        <Field label="How"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">—</option>{['Zelle', 'Venmo', 'Bank transfer', 'Check', 'Cash', 'PayPal', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></Field>
      </div>
      {!f.paid_on && <Button size="sm" onClick={() => setF({ ...f, paid_on: todayISO() })}>Paid today</Button>}
    </Modal>
  );
}

function MemberModal({ m, onClose }) {
  const s = useStore();
  const isNew = !m.id;
  const [f, setF] = useState({ name: m.name || '', email: m.email || '', phone: m.phone || '', role: m.role || '', notes: m.notes || '' });
  const save = async () => {
    if (isNew) await s.insert('crew_members', f);
    else await s.update('crew_members', m.id, f);
    onClose();
  };
  return (
    <Modal title={isNew ? 'Add crew member' : m.name} onClose={onClose} footer={<>{!isNew && <Button variant="ghost" className="danger" icon="trash" style={{ marginRight: 'auto' }} onClick={async () => { try { await s.remove('crew_members', m.id); onClose(); } catch { s.toast('Delete their payouts first', { error: true }); } }}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!f.name}>Save</Button></>}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Role"><input className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="AC, 2nd shooter, PA…" /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      </div>
      <Field label="Notes"><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. W-9 on file" /></Field>
    </Modal>
  );
}

