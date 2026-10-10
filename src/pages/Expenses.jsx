import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import AddressInput from '../components/AddressInput.jsx';
import { Button, Empty, Field, Icon, Modal, MoneyInput, Pill, Seg, Switch, Combobox, DateInput, useTableColumns } from '../components/ui.jsx';
import { categoryList, categoryLabel } from '../lib/categories.js';
import { addReceiptFile, attachToReceipt } from '../lib/receipts.js';
import { setBillable } from '../lib/actions.js';
import { money, fmtDate, fmtShort, num, todayISO, round2, plural, inPeriod, periodOptions } from '../lib/format.js';
import { pickFiles } from '../lib/files.js';
import { go } from '../router.js';
import { takeFiles, onFiles } from '../lib/scanQueue.js';
import { rateFor, followsIrs } from '../lib/mileage.js';
import { rankInvoicesFor } from '../lib/suggest.js';
import { canUploadReceipts } from '../lib/plan.js';
import { DuplicatesButton } from '../components/Duplicates.jsx';
import BillImport from '../components/BillImport.jsx';

/** "Sony · Apr 27, 2026 · on invoice #123" — where an existing receipt is. */
function whereIs(r, derived) {
  const inv = r.invoice_id && derived.invoices[r.invoice_id];
  return [r.vendor || 'No vendor', fmtDate(r.receipt_date), inv ? `on invoice #${inv.number}` : 'not on an invoice'].filter(Boolean).join(' · ');
}

/**
 * Click a vendor, date, category or amount in the table to change it right there (Enter or click away saves,
 * Esc cancels). A receipt billed on an invoice updates that invoice's line too.
 */
function EditCell({ r, field, children }) {
  const s = useStore();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  const start = (e) => {
    e.stopPropagation();
    setV(field === 'total' ? (r.total ?? '') : (r[field] ?? ''));
    setEditing(true);
  };
  const save = async (val = v) => {
    setEditing(false);
    const next = field === 'total' ? (String(val).trim() === '' ? null : round2(String(val).replace(/[$,\s]/g, ''))) : (val || null);
    if (next === (r[field] ?? null) || (field === 'total' && Number.isNaN(next))) return;
    try {
      await s.update('receipts', r.id, { [field]: next });
      if (r.invoice_id && r.billable) await setBillable(s, s.derived.invoices[r.invoice_id], { ...r, [field]: next }, true);
    } catch (e) { s.toast(e.message, { error: true }); }
  };
  const key = (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') setEditing(false); };
  const cls = `cell-edit${field === 'total' ? ' right' : ''}${field === 'category' ? ' small' : ''}${field === 'vendor' ? ' strong' : ''}`;
  // A pencil shows on hover (like the categories in Settings), so you can tell it's editable.
  const pen = <span className="cell-pen" aria-hidden="true"><Icon name="edit" size={13} /></span>;
  if (!editing) return <span className={cls} role="button" tabIndex={0} onClick={start} onKeyDown={(e) => e.key === 'Enter' && start(e)}><span className="cell-text">{children}</span>{pen}</span>;
  return (
    <span className={`${cls} editing`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {/* The text stays (invisible) to hold the cell's size; the field sits right on top, so nothing moves. */}
      <span className="cell-ghost" aria-hidden="true"><span className="cell-text">{children}</span>{pen}</span>
      <span className="cell-ctl">
      {field === 'category' ? (
        <select autoFocus value={v} onChange={(e) => save(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={key} aria-label="Category">
          <option value="">Uncategorized</option>
          {categoryList(s.db.profile).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      ) : field === 'receipt_date' ? (
        <DateInput value={v} defaultOpen onChange={(d) => save(d)} onDismiss={() => setEditing(false)} aria-label="Date" />
      ) : (
        <input className={field === 'total' ? 'num' : undefined} autoFocus value={v} inputMode={field === 'total' ? 'decimal' : undefined} onChange={(e) => setV(e.target.value)} onBlur={() => save()} onKeyDown={key} onFocus={(e) => e.target.select()} aria-label={field === 'total' ? 'Amount' : 'Vendor'} />
      )}
      </span>
    </span>
  );
}

// Receipt table columns (drag a header to reorder, click to sort).
const RCOLS = {
  vendor: { label: 'Vendor', sort: (r) => String(r.vendor || '').toLowerCase(), cell: (r) => <><EditCell r={r} field="vendor"><span style={{ fontWeight: 500 }}>{r.vendor || <span className="muted">Unknown vendor</span>}</span></EditCell>{r.status === 'review' && <div><Pill kind="review">Check</Pill></div>}</> },
  date: { label: 'Date', sort: (r) => r.receipt_date || '', cell: (r) => <EditCell r={r} field="receipt_date"><span className="muted">{fmtDate(r.receipt_date) || '—'}</span></EditCell> },
  category: { label: 'Category', sort: (r) => categoryLabel(r.category), cell: (r) => <EditCell r={r} field="category"><span className="muted small">{categoryLabel(r.category)}</span></EditCell> },
  invoice: { label: 'Invoice', sort: (r) => r.invoice_id || '', cell: (r, derived) => (r.invoice_id ? <a href={`#/invoices/${r.invoice_id}`} onClick={(e) => e.stopPropagation()} className="pill sent" style={{ textDecoration: 'none' }}>#{derived.invoices[r.invoice_id]?.number}{r.billable ? ' · billed' : ''}</a> : <span className="small muted">—</span>) },
  amount: { label: 'Amount', right: true, sort: (r) => num(r.total), cell: (r) => <EditCell r={r} field="total">{r.total != null ? money(r.total) : '—'}</EditCell> },
};

export default function Expenses({ tab, query }) {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Expenses</h1>
        <Seg value={tab} onChange={(t) => go(`/expenses${t === 'receipts' ? '' : `/${t}`}`)} label="Expense type" options={[{ value: 'receipts', label: 'Receipts' }, { value: 'mileage', label: 'Mileage' }, { value: 'crew', label: 'Crew payouts' }]} />
      </div>
      {tab === 'mileage' ? <Mileage /> : tab === 'crew' ? <Crew query={query} /> : <Receipts query={query} />}
    </div>
  );
}

/* ================================================================== */
/* Receipts                                                            */
/* ================================================================== */
function Receipts({ query }) {
  const s = useStore();
  const { db, derived } = s;
  // The filter and period you picked are remembered on this device.
  const [saved] = useState(() => { try { return JSON.parse(localStorage.getItem('wrap_exp_view')) || {}; } catch { return {}; } });
  const table = useTableColumns('wrap_exp_cols', RCOLS, ['vendor', 'date', 'category', 'invoice', 'amount']);
  const [filter, setFilterState] = useState(query.status === 'review' ? 'review' : saved.filter || 'all');
  const [year, setYearState] = useState(saved.year || 'all');
  const [cat, setCatState] = useState(saved.cat || '');
  const [range, setRangeState] = useState(saved.range || { from: '', to: '' }); // for "Custom range"
  const remember = (patch) => { try { localStorage.setItem('wrap_exp_view', JSON.stringify({ filter, year, cat, range, ...patch })); } catch { /* not saved */ } };
  const setCat = (v) => { setCatState(v); remember({ cat: v }); };
  const setRange = (v) => { setRangeState(v); remember({ range: v }); };
  const setFilter = (v) => { setFilterState(v); remember({ filter: v }); };
  const setYear = (v) => { setYearState(v); remember({ year: v }); };
  const [q, setQ] = useState('');
  const [queue, setQueue] = useState([]); // { name, step, status, message }
  const [open, setOpen] = useState(query.open || null);
  const [urls, setUrls] = useState({});
  const [over, setOver] = useState(false);
  const busy = queue.some((x) => x.status === 'working');
  const uploads = canUploadReceipts(db.profile);
  // User plan: the scanned photo isn't saved, but it's kept on screen (this visit only) while you check the details.
  const [previews, setPreviews] = useState({});
  // An expense typed in by hand (no photo): a blank receipt opens to fill in; closed without anything, it's removed.
  const newExpense = async () => {
    try { const r = await s.insert('receipts', { receipt_date: todayISO(), status: 'review', ai: { manual: true } }); setOpen(r.id); } catch (e) { s.toast(e.message, { error: true }); }
  };
  const closeModal = () => {
    const r = derived.receipts[open];
    if (r?.ai?.manual && r.status === 'review' && !r.vendor && r.total == null && !r.file_key) s.remove('receipts', r.id).catch(() => {});
    setOpen(null);
  };
  useEffect(() => { if (query.new === '1') { go('/expenses'); newExpense(); } }, [query.new]); // eslint-disable-line react-hooks/exhaustive-deps
  // Once a receipt is checked (or deleted) it leaves "Just added"; skipped duplicates and errors stay until cleared.
  const shownQueue = queue.filter((x) => x.status !== 'done' || !x.receiptId || derived.receipts[x.receiptId]?.status === 'review');

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return db.receipts
      .filter((r) => filter === 'all' || (filter === 'review' ? r.status === 'review' : filter === 'unattached' ? !r.invoice_id : !!r.invoice_id))
      .filter((r) => (year === 'custom'
        ? (!range.from || (r.receipt_date && r.receipt_date >= range.from)) && (!range.to || (r.receipt_date && r.receipt_date <= range.to))
        : inPeriod(r.receipt_date, year)))
      .filter((r) => !cat || (cat === '—' ? !r.category : r.category === cat))
      .filter((r) => !t || `${r.vendor} ${r.category} ${r.total} ${r.notes}`.toLowerCase().includes(t))
      .sort((a, b) => (a.status === 'review' ? 0 : 1) - (b.status === 'review' ? 0 : 1) || String(b.receipt_date || b.created_at).localeCompare(String(a.receipt_date || a.created_at)));
  }, [db.receipts, filter, year, q, cat, range]);
  const shownKeys = list.slice(0, 400).map((r) => r.file_key).filter(Boolean);

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
      const res = await addReceiptFile(f, { api: s.api, receipts: known, confirm: s.confirm, store: uploads, onStep: (step) => setItem({ step }) });
      if (res.status === 'added') {
        if (res.preview) setPreviews((m) => ({ ...m, [res.receipt.id]: { url: URL.createObjectURL(res.preview), pdf: res.preview.type === 'application/pdf' } }));
        known.push(res.receipt);
        added.push(res.receipt);
        s.setDb((d) => ({ ...d, receipts: [...d.receipts, res.receipt] }));
        setItem({ status: 'done', step: `${res.receipt.vendor || 'Receipt'} · ${res.receipt.total != null ? money(res.receipt.total) : 'amount?'}`, message: res.message, receiptId: res.receipt.id });
      } else if (res.status === 'duplicate') {
        dupes++;
        setItem({ status: 'dupe', step: 'Already saved — skipped', message: res.existing ? whereIs(res.existing, derived) : res.message, receiptId: res.existing?.id });
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

  const reviewCount = db.receipts.filter((r) => r.status === 'review' && !r.ai?.manual).length;
  const highConf = db.receipts.filter((r) => r.status === 'review' && r.ai?.confidence === 'high' && r.ai?.check !== 'mismatch' && r.total != null && r.receipt_date);
  const total = list.reduce((t, r) => t + num(r.total), 0);
  const cameraRef = useRef(null);
  // Drop a file straight onto a receipt in the list to attach it (or replace its file).
  const [rowOver, setRowOver] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);
  const rowDrop = (r) => (!uploads ? {} : {
    onDragOver: (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setRowOver(r.id); } },
    onDragLeave: () => setRowOver((x) => (x === r.id ? null : x)),
    onDrop: async (e) => {
      e.preventDefault(); e.stopPropagation(); setRowOver(null);
      const file = e.dataTransfer.files[0];
      if (!file || rowBusy) return;
      if (r.file_key && !(await s.confirm({ title: `Replace the file on ${r.vendor || 'this receipt'}?`, body: `${file.name} takes the place of the current file.`, ok: 'Replace' }))) return;
      setRowBusy(r.id);
      try { s.toast((await attachToReceipt(s, r, file)) === 'replaced' ? 'File replaced' : 'File added'); } catch (err) {
        if (err.twin) s.toast(`Already saved: ${whereIs(err.twin, derived)}`, { error: true, action: { label: 'Show', run: () => setOpen(err.twin.id) } });
        else s.toast(err.message, { error: true });
      }
      setRowBusy(null);
    },
  });
  const rowCls = (r) => (rowOver === r.id ? ' row-drop' : '');
  const thumb = (r) => (rowBusy === r.id ? <span className="spinner" /> : urls[r.file_key] && r.mime !== 'application/pdf' ? <img src={urls[r.file_key]} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : r.mime === 'application/pdf' ? 'PDF' : <Icon name="receipt" size={16} />);

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <button className="card phone-only" style={{ padding: 22, alignItems: 'center', gap: 14, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }} onClick={() => cameraRef.current?.click()} disabled={busy}>
          <span style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--primary)', color: 'var(--on-primary)', display: 'grid', placeItems: 'center' }}><Icon name="camera" size={22} /></span>
          <span className="col" style={{ gap: 2 }}><strong>Scan a receipt</strong><span className="small muted">{uploads ? 'Opens your camera. Auto-crops and sharpens.' : 'Opens your camera and fills in the details.'}</span></span>
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
          <span className="small muted">{uploads ? 'or click to choose · duplicates are skipped automatically' : 'or click to choose · the details are filled in for you'}</span>
        </div>
      </div>

      {shownQueue.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>{busy ? 'Adding receipts…' : 'Just added'}</h2>{!busy && <Button size="sm" variant="ghost" onClick={() => setQueue([])}>Clear</Button>}</div>
          {shownQueue.map((x) => (
            <div key={x.id} className="list-row" style={{ gridTemplateColumns: '22px 1fr auto', cursor: x.receiptId ? 'pointer' : 'default' }} onClick={() => x.receiptId && setOpen(x.receiptId)}>
              {x.status === 'working' ? <span className="spinner" style={{ color: 'var(--accent)' }} /> : <Icon name={x.status === 'done' ? 'check' : x.status === 'dupe' ? 'copy' : x.status === 'error' ? 'x' : 'file'} size={18} style={{ color: x.status === 'done' ? 'var(--good)' : x.status === 'error' ? 'var(--bad)' : 'var(--muted)' }} />}
              <span className="col" style={{ gap: 0, minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.step}</span>
                <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.message || x.name}</span>
              </span>
              {x.receiptId && <span className="small" style={{ color: 'var(--accent)' }}>{x.status === 'dupe' ? 'Show' : 'Check'}</span>}
            </div>
          ))}
        </section>
      )}

      <div className="row wrap between">
        <div className="row wrap">
          <Seg value={filter} onChange={setFilter} label="Filter" options={[{ value: 'all', label: 'All' }, { value: 'review', label: 'To review', count: reviewCount }, { value: 'unattached', label: 'Not on an invoice' }, { value: 'attached', label: 'On an invoice' }]} />
          <select className="input" style={{ width: 160 }} value={year} onChange={(e) => setYear(e.target.value)} aria-label="Period">{[...periodOptions(db.receipts.map((r) => r.receipt_date)), { value: 'custom', label: 'Custom range…' }].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          {year === 'custom' && (
            <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <span style={{ width: 150 }}><DateInput value={range.from} onChange={(v) => setRange({ ...range, from: v })} placeholder="From" clearable aria-label="From date" /></span>
              <span className="muted">–</span>
              <span style={{ width: 150 }}><DateInput value={range.to} onChange={(v) => setRange({ ...range, to: v })} placeholder="To" clearable align="right" aria-label="To date" /></span>
            </span>
          )}
          <select className="input" style={{ width: 180 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categoryList(db.profile).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            <option value="—">Uncategorized</option>
          </select>
        </div>
        <div className="row wrap" style={{ marginLeft: 'auto' }}>
          {highConf.length > 0 && filter === 'review' && <Button size="sm" icon="check" onClick={async () => { for (const r of highConf) await s.update('receipts', r.id, { status: 'confirmed' }); s.toast(`${highConf.length} confirmed`); }}>Confirm {highConf.length} sure ones</Button>}
          <input className="input search" style={{ width: 220 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search receipts" />
          <Button icon="plus" onClick={newExpense}>New expense</Button>
        </div>
      </div>

      <section className="card">
        {list.length === 0 ? (
          <Empty icon="receipt" title={db.receipts.length ? 'Nothing matches' : 'No receipts yet'}>{!db.receipts.length && 'Scan or drop your first receipt above.'}</Empty>
        ) : (
          <>
          <div className="m-list">
            {list.slice(0, 400).map((r) => (
              <button type="button" key={r.id} className={`m-card m-card-thumb${rowCls(r)}`} onClick={() => setOpen(r.id)} {...rowDrop(r)}>
                <span className="thumb">{thumb(r)}</span>
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
              <thead><tr><th style={{ width: 56 }} />{table.headers}</tr></thead>
              <tbody>
                {table.sorted(list).slice(0, 400).map((r) => (
                  <tr key={r.id} className={`click${rowCls(r)}`} onClick={() => setOpen(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)} {...rowDrop(r)}>
                    <td><span className="thumb">{thumb(r)}</span></td>
                    {table.order.map((k) => <td key={k} className={RCOLS[k].right ? 'right num' : undefined}>{RCOLS[k].cell(r, derived)}</td>)}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={table.order.length} className="small muted" style={{ borderTop: '1px solid var(--line)' }}>{plural(list.length, 'receipt')}</td><td className="right num" style={{ borderTop: '1px solid var(--line)', fontWeight: 600 }}>{money(total)}</td></tr></tfoot>
            </table>
          </div>
          </>
        )}
      </section>

      {open && <ReceiptModal id={open} preview={previews[open]} onClose={closeModal} onNext={(nid) => setOpen(nid)} />}
    </>
  );
}

export function ReceiptModal({ id, preview, onClose, onNext }) {
  const s = useStore();
  const { db, derived } = s;
  const r = derived.receipts[id];
  const [f, setF] = useState(() => ({ vendor: r?.vendor || '', receipt_date: r?.receipt_date || todayISO(), total: r?.total ?? '', category: r?.category || '', notes: r?.notes || '', invoice_id: r?.invoice_id || null, billable: !!r?.billable }));
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false); // (all hooks must sit above the early return below)
  const [over, setOver] = useState(false);
  const uploads = canUploadReceipts(db.profile);
  const [pdf, setPdf] = useState(null); // { pages: [img urls], total, url (the whole PDF, for opening) }
  useEffect(() => {
    if (r) s.api.files.urls([r.file_key].filter(Boolean)).then(setUrls).catch(() => {});
  }, [r?.file_key]); // eslint-disable-line react-hooks/exhaustive-deps
  // PDFs are drawn as pages inside the app (same look as a photo), not in the browser's PDF viewer.
  useEffect(() => {
    const u = (r?.mime === 'application/pdf' && urls[r.file_key]) || (!r?.file_key && preview?.pdf && preview.url);
    setPdf(null);
    if (!u) return undefined;
    let made = [];
    let gone = false;
    (async () => {
      const blob = new Blob([await (await fetch(u)).blob()], { type: 'application/pdf' });
      const { pdfPages } = await import('../lib/pdftext.js');
      const { pages, total } = await pdfPages(blob, { max: 6 });
      made = [...pages, URL.createObjectURL(blob)];
      if (gone) made.forEach((x) => URL.revokeObjectURL(x));
      else setPdf({ pages, total, url: made[made.length - 1] });
    })().catch(() => !gone && setPdf({ pages: [], total: 0, url: u }));
    return () => { gone = true; made.forEach((x) => URL.revokeObjectURL(x)); };
  }, [urls, r?.file_key, r?.mime, preview?.url]);
  if (!r) return null;
  const ai = r.ai || {};
  const chips = [];
  if (ai.total_paid != null) chips.push({ label: 'Total paid', amount: ai.total_paid });
  for (const a of ai.amounts || []) if (!chips.some((c) => Math.abs(c.amount - a.amount) < 0.005)) chips.push(a);
  if (ai.subtotal != null && !chips.some((c) => Math.abs(c.amount - ai.subtotal) < 0.005)) chips.push({ label: 'Subtotal', amount: ai.subtotal });
  const reviewQueue = db.receipts.filter((x) => x.status === 'review' && x.id !== id);
  const invoices = db.invoices.filter((i) => i.kind === 'invoice' && i.status !== 'void').sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)));
  const invLabel = (i) => `#${i.number} · ${derived.clients[i.client_id]?.name || 'No client'} · ${fmtShort(i.issue_date)}${i.status === 'draft' ? ' (draft)' : ''}`;
  // Invoices this receipt most likely belongs to: a work day on the invoice is the receipt's day (or next to it),
  // or the invoice is dated that day; a matching amount or item helps. Best first, with the reason.
  const ranked = rankInvoicesFor({ ...r, ...f, total: f.total === '' ? null : f.total }, invoices, { linesFor: derived.linesFor, clientName: (i) => derived.clients[i.client_id]?.name });
  const likely = ranked.map((x) => x.inv);
  const whyFor = Object.fromEntries(ranked.map((x) => [x.inv.id, x.why]));
  const local = !r.file_key && preview; // shown, not saved (User plan)
  const url = local ? preview.url : urls[r.file_key];
  const isPdf = local ? preview.pdf : r.mime === 'application/pdf';
  const manual = !!r.ai?.manual && !r.file_key;
  // Without receipt uploads (User plan) there's no photo side at all, unless the receipt already has a file.
  const showFile = uploads || !!r.file_key || !!local;
  // Turn a stored photo a quarter turn clockwise (for the odd one the automatic turn got wrong).
  const rotate = async () => {
    if (fileBusy || !url) return;
    setFileBusy(true);
    try {
      const { rotatePhoto } = await import('../lib/scan.js');
      const blob = await rotatePhoto(await (await fetch(url)).blob(), 90);
      const key = await s.api.files.upload(blob, { folder: 'receipts', ext: 'jpg' });
      const old = [r.file_key, r.original_key].filter(Boolean);
      await s.update('receipts', r.id, { file_key: key, original_key: null, mime: 'image/jpeg' });
      await s.api.files.remove(old).catch(() => {});
    } catch (e) { s.toast(e.message, { error: true }); }
    setFileBusy(false);
  };
  // Add a file to a receipt that has none (e.g. imported from Wave), or swap in a new one. Pick or drop.
  const attachFile = async (dropped) => {
    const file = dropped || (await pickFiles({ accept: 'image/*,application/pdf' }))[0];
    if (!file || fileBusy) return;
    setFileBusy(true);
    try {
      const how = await attachToReceipt(s, r, file);
      s.toast(how === 'replaced' ? 'File replaced' : 'File added');
    } catch (e) {
      if (e.twin) s.toast(`Already saved: ${whereIs(e.twin, derived)}`, { error: true, action: { label: 'Show', run: () => onNext(e.twin.id) } });
      else s.toast(e.message, { error: true });
    }
    setFileBusy(false);
  };
  const dropProps = {
    onDragOver: (e) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e) => { e.preventDefault(); setOver(false); const file = e.dataTransfer.files[0]; if (file) attachFile(file); },
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
    <Modal wide={showFile} title={manual ? 'New expense' : r.status === 'review' ? 'Check this receipt' : 'Receipt'} onClose={fileBusy ? () => {} : onClose} footer={
      <>
        <Button variant="ghost" className="danger" icon="trash" onClick={del} style={{ marginRight: 'auto' }}>Delete</Button>
        {r.status === 'review' && !manual && reviewQueue.length > 0 && <Button busy={busy} disabled={fileBusy} onClick={() => save(true)}>Save &amp; next ({reviewQueue.length})</Button>}
        <Button variant="primary" busy={busy} disabled={fileBusy} onClick={() => save(false)}>{r.status === 'review' && !manual ? 'Looks right — save' : 'Save'}</Button>
      </>
    }>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
        {showFile && <div className="col" style={{ flex: '1 1 280px', minWidth: 0, gap: 8 }}>
          <div className={`receipt-view ${over ? 'over' : ''} ${r.file_key || local ? 'has-file' : ''}`} {...(uploads ? dropProps : {})}>
            {!r.file_key && !local
              ? <button type="button" className="file-drop" onClick={() => attachFile()} disabled={fileBusy}>{fileBusy ? <span className="spinner" /> : <Icon name="upload" size={22} />}<span>Add or drop a receipt image or PDF</span></button>
              : !url || (isPdf && !pdf) ? <span className="spinner" />
              : isPdf ? (
                <div className="rv-pages">
                  {pdf.pages.map((src, i) => <a key={src} href={pdf.url} target="_blank" rel="noreferrer" className="rv-page"><img src={src} alt={`Page ${i + 1}`} /></a>)}
                  {!pdf.pages.length && <a href={pdf.url} target="_blank" rel="noreferrer" className="file-drop" style={{ minHeight: 200 }}><Icon name="file" size={22} /><span>Open PDF</span></a>}
                  {pdf.total > pdf.pages.length && <a href={pdf.url} target="_blank" rel="noreferrer" className="small muted">+{pdf.total - pdf.pages.length} more page{pdf.total - pdf.pages.length === 1 ? '' : 's'}</a>}
                </div>
              )
              : <div className="rv-pages"><a href={url} target="_blank" rel="noreferrer" className="rv-page"><img src={url} alt="Receipt" /></a></div>}
            {fileBusy && r.file_key && <span className="receipt-busy"><span className="spinner" /></span>}
            {r.file_key && url && uploads && (
              <div className="rv-tools">
                {!isPdf && <button type="button" className="icon-btn" onClick={rotate} disabled={fileBusy} title="Rotate" aria-label="Rotate"><Icon name="rotate" size={16} /></button>}
                <button type="button" className="icon-btn" onClick={() => attachFile()} disabled={fileBusy} title="Replace file" aria-label="Replace file"><Icon name="upload" size={16} /></button>
              </div>
            )}
          </div>
        </div>}
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
            <Field label="Date"><DateInput value={f.receipt_date || ''} onChange={(v) => setF({ ...f, receipt_date: v })} /></Field>
          </div>
          <Field label="Category">
            <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              <option value="">Choose…</option>
              {[...categoryList(db.profile), ...(f.category && !categoryList(db.profile).some((c) => c.name === f.category) ? [{ name: f.category }] : [])].map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Attach to invoice" hint={likely.length ? '(best matches first)' : '(optional)'}>
            <select className="input" value={f.invoice_id || ''} onChange={(e) => setF({ ...f, invoice_id: e.target.value || null, billable: e.target.value ? f.billable : false })}>
              <option value="">Not attached</option>
              {likely.length > 0 && <optgroup label="Suggested">{likely.map((i) => <option key={`s${i.id}`} value={i.id}>{invLabel(i)} — {whyFor[i.id]}</option>)}</optgroup>}
              <optgroup label={likely.length ? 'All invoices' : 'Invoices'}>{invoices.filter((i) => !likely.includes(i)).map((i) => <option key={i.id} value={i.id}>{invLabel(i)}</option>)}</optgroup>
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
        <div className="card kpi"><span className="muted">Mileage deduction</span><span className="v">{money(deduction, { cents: false })}</span><span className="small muted">{followsIrs(db.profile.mileage_rate) ? 'IRS rate' : 'Your rate'} ${rateFor(db.profile, todayISO())}/mile</span></div>
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
    const row = { ...f, miles: num(f.miles), rate: trip.rate ?? rateFor(s.db.profile, f.trip_date) };
    if (isNew) await s.insert('mileage_trips', row);
    else await s.update('mileage_trips', trip.id, row);
    onClose();
  };
  return (
    <Modal title={isNew ? 'Log a trip' : 'Edit trip'} onClose={onClose} footer={<>{!isNew && <Button variant="ghost" className="danger" icon="trash" style={{ marginRight: 'auto' }} onClick={async () => { await s.remove('mileage_trips', trip.id); onClose(); }}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!num(f.miles)}>Save</Button></>}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Date"><DateInput value={f.trip_date} onChange={(v) => setF({ ...f, trip_date: v })} /></Field>
        <Field label="Miles (one way)"><MoneyInput value={f.miles} onChange={(v) => setF({ ...f, miles: v })} /></Field>
        <Field label="From"><AddressInput value={f.start_place} onChange={(v) => setF({ ...f, start_place: v })} placeholder="Home" /></Field>
        <Field label="To"><AddressInput value={f.end_place} onChange={(v) => setF({ ...f, end_place: v })} placeholder="Shoot location" /></Field>
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

function Crew({ query = {} }) {
  const s = useStore();
  const { db, derived } = s;
  const [year, setYear] = useState(todayISO().slice(0, 4));
  const [edit, setEdit] = useState(null);
  // Opened from the heads up, the calendar or "In your Wrap" on a client link.
  useEffect(() => {
    const p = query.payout && db.crew_payouts.find((x) => x.id === query.payout);
    if (p) { setEdit(p); go('/expenses/crew'); }
  }, [query.payout, db.crew_payouts]); // eslint-disable-line react-hooks/exhaustive-deps
  const [member, setMember] = useState(null);
  const [bills, setBills] = useState([]); // invoices you picked to import, one at a time
  const importBills = async () => {
    const files = await pickFiles({ accept: 'application/pdf,image/*', multiple: true });
    if (files?.length) setBills([...files]);
  };
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
        <div className="row wrap"><DuplicatesButton kind="crew" /><Button icon="upload" onClick={importBills}>Import invoice</Button><Button icon="crew" onClick={() => setMember({})}>Add crew member</Button><Button variant="primary" icon="plus" disabled={!db.crew_members.length} onClick={() => setEdit({})}>Add payout</Button></div>
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Payouts</h2></div>
          {pays.length === 0 && <Empty icon="crew" title="No payouts">When you hire a 2nd shooter, AC or PA, log what you owe them here.</Empty>}
          {pays.map((p) => (
            <button key={p.id} className="list-row" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => setEdit(p)}>
              <span className="col" style={{ gap: 0 }}><b style={{ fontWeight: 500 }}>{derived.crew[p.crew_id]?.name} · {p.description || 'Work'}</b><span className="small muted">{fmtDate(p.work_date)}{p.client_id ? ` · ${derived.clients[p.client_id]?.name}` : ''}</span></span>
              <span className="col" style={{ alignItems: 'flex-end', gap: 2 }}><span className="num">{money(p.amount)}</span>{p.paid_on ? <span className="pill paid">Paid {fmtShort(p.paid_on)}</span> : <PayDue p={p} />}</span>
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
      {edit && (edit.source_key || edit.source_token ? <BillModal p={edit} onClose={() => setEdit(null)} /> : <PayoutModal p={edit} onClose={() => setEdit(null)} />)}
      {member && <MemberModal m={member} onClose={() => setMember(null)} />}
      {bills.length > 0 && <BillImport key={`${bills.length}-${bills[0].name}`} file={bills[0]} onClose={() => setBills((b) => b.slice(1))} />}
    </>
  );
}

/** Unpaid, with its due date when it has one: "Due Oct 20" / "Due today" / "Overdue". */
function PayDue({ p }) {
  const today = todayISO();
  if (!p.due_date) return <span className="pill overdue">Unpaid</span>;
  if (p.due_date < today) return <span className="pill overdue">Overdue · {fmtShort(p.due_date)}</span>;
  return <span className={`pill ${p.due_date === today ? 'partial' : 'sent'}`}>{p.due_date === today ? 'Due today' : `Due ${fmtShort(p.due_date)}`}</span>;
}

/** One line of their invoice as plain text, for pasting anywhere. */
const lineText = (l) => [l.item, l.description, l.note, `${num(l.qty) !== 1 ? `${num(l.qty)} × ${money(l.rate)} = ` : ''}${money(l.amount)}`].filter(Boolean).join('\n');

/** An invoice someone sent you (Import to Wrap): every line, easy to read and copy, plus when you paid it. */
function BillModal({ p, onClose }) {
  const s = useStore();
  const d = p.source_detail || null;
  const from = d?.from || s.derived.crew[p.crew_id]?.name || 'Them';
  const [f, setF] = useState({ paid_on: p.paid_on || '', method: p.method || '' });
  const today = todayISO();
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); s.toast(`${what} copied`); } catch { s.toast('Couldn’t copy', { error: true }); }
  };
  const all = d ? [`${from} · Invoice #${p.source_number}`, ...(d.lines || []).map(lineText),
    [num(d.discount) > 0 && `Discount −${money(d.discount)}`, num(d.tax) > 0 && `Tax ${money(d.tax)}`, `Total ${money(d.total)}`].filter(Boolean).join('\n')].join('\n\n') : '';
  const save = async () => { await s.update('crew_payouts', p.id, { paid_on: f.paid_on || null, method: f.method || null }); onClose(); };
  const st = p.paid_on ? ['paid', `Paid ${fmtShort(p.paid_on)}`] : !p.due_date ? ['overdue', 'Unpaid'] : p.due_date < today ? ['overdue', 'Overdue'] : p.due_date === today ? ['partial', 'Due today'] : ['sent', `Due ${fmtShort(p.due_date)}`];
  return (
    <Modal title={`${from} · #${p.source_number}`} onClose={onClose} footer={<>
      <Button variant="ghost" className="danger" icon="trash" style={{ marginRight: 'auto' }} onClick={async () => { if (!window.confirm('Remove this bill from your Wrap?')) return; await s.remove('crew_payouts', p.id); onClose(); }}>Delete</Button>
      {p.source_token && <Button icon="link" onClick={() => window.open(`#/i/${p.source_token}`, '_blank', 'noopener')}>Their invoice</Button>}
      <Button variant="primary" onClick={save}>Save</Button>
    </>}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <span className="col" style={{ gap: 2 }}>
          <span className="num" style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em' }}>{money(p.amount)}</span>
          <span className="small muted">{d?.issue_date && `Invoice date ${fmtDate(d.issue_date)}`}</span>
        </span>
        <span className={`pill ${st[0]}`}>{st[1]}</span>
      </div>
      {d ? (
        <section className="bill-lines">
          <div className="bill-head"><span className="small muted">{plural((d.lines || []).length, 'item')}</span><Button size="sm" icon="copy" onClick={() => copy(all, 'All items')}>Copy all</Button></div>
          {(d.lines || []).map((l, i) => (
            <div key={i} className="bill-line">
              <span className="col" style={{ gap: 2, minWidth: 0 }}>
                <b style={{ fontWeight: 500 }}>{l.item || 'Item'}</b>
                {l.description && <span className="small muted" style={{ whiteSpace: 'pre-line' }}>{l.description}</span>}
                {l.note && <span className="small muted" style={{ whiteSpace: 'pre-line' }}>{l.note}</span>}
                {num(l.qty) !== 1 && <span className="small muted num">{num(l.qty)} × {money(l.rate)}</span>}
              </span>
              <span className="num">{money(l.amount)}</span>
              <button type="button" className="bill-copy" aria-label={`Copy ${l.item || 'item'}`} onClick={() => copy(lineText(l), l.item || 'Item')}><Icon name="copy" size={15} /></button>
            </div>
          ))}
          {num(d.discount) > 0 && <div className="bill-line bill-sum"><span className="muted">Discount</span><span className="num">−{money(d.discount)}</span><span /></div>}
          {num(d.tax) > 0 && <div className="bill-line bill-sum"><span className="muted">Tax</span><span className="num">{money(d.tax)}</span><span /></div>}
          <div className="bill-line bill-total"><b>Total</b><span className="num">{money(d.total)}</span><span /></div>
          {num(d.total) - num(d.due) > 0.004 && <div className="bill-line bill-sum"><span className="muted">Already paid</span><span className="num">−{money(num(d.total) - num(d.due))}</span><span /></div>}
        </section>
      ) : p.source_token && <p className="small muted">Open <a href={`#/i/${p.source_token}`} target="_blank" rel="noreferrer">their invoice</a> and tap Update in Wrap to bring the items in here.</p>}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Paid on"><DateInput clearable value={f.paid_on} onChange={(v) => setF({ ...f, paid_on: v })} /></Field>
        <Field label="How"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">—</option>{['Zelle', 'Venmo', 'Bank transfer', 'Check', 'Cash', 'PayPal', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></Field>
      </div>
      {!f.paid_on && <Button size="sm" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, paid_on: todayISO() })}>Paid today</Button>}
    </Modal>
  );
}

function PayoutModal({ p, onClose }) {
  const s = useStore();
  const isNew = !p.id;
  const [f, setF] = useState({ crew_id: p.crew_id || s.db.crew_members[0]?.id, work_date: p.work_date || todayISO(), description: p.description || '', client_id: p.client_id || null, amount: p.amount ?? '', paid_on: p.paid_on || '', method: p.method || '', due_date: p.due_date || '' });
  const save = async () => {
    const row = { ...f, amount: num(f.amount), paid_on: f.paid_on || null, method: f.method || null, due_date: f.due_date || null };
    if (!row.due_date && p.due_date === undefined) delete row.due_date; // works before 016 is run, too
    if (isNew) await s.insert('crew_payouts', row);
    else await s.update('crew_payouts', p.id, row);
    onClose();
  };
  return (
    <Modal title={isNew ? 'Add crew payout' : 'Edit payout'} onClose={onClose} footer={<>{!isNew && <Button variant="ghost" className="danger" icon="trash" style={{ marginRight: 'auto' }} onClick={async () => { await s.remove('crew_payouts', p.id); onClose(); }}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!num(f.amount) || !f.crew_id}>Save</Button></>}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Crew member"><select className="input" value={f.crew_id} onChange={(e) => setF({ ...f, crew_id: e.target.value })}>{s.db.crew_members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <Field label="Work date"><DateInput value={f.work_date} onChange={(v) => setF({ ...f, work_date: v })} /></Field>
        <Field label="Amount"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="What for"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. AC, 2 days" /></Field>
        <Field label="Due" hint="(optional)"><DateInput clearable value={f.due_date} onChange={(v) => setF({ ...f, due_date: v })} /></Field>
      </div>
      {p.source_token && <a className="small" href={`#/i/${p.source_token}`} target="_blank" rel="noreferrer" style={{ alignSelf: 'flex-start' }}><Icon name="link" size={13} /> Their invoice #{p.source_number}</a>}
      <Combobox label="Client / job (optional)" value={f.client_id} options={s.db.clients.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => setF({ ...f, client_id: v })} placeholder="Search clients" />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Paid on" hint="(leave empty if unpaid)"><DateInput clearable value={f.paid_on} onChange={(v) => setF({ ...f, paid_on: v })} /></Field>
        <Field label="How"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">—</option>{['Zelle', 'Venmo', 'Bank transfer', 'Check', 'Cash', 'PayPal', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></Field>
      </div>
      {!f.paid_on && <Button size="sm" onClick={() => setF({ ...f, paid_on: todayISO() })}>Paid today</Button>}
    </Modal>
  );
}

function MemberModal({ m, onClose }) {
  const s = useStore();
  const isNew = !m.id;
  const [f, setF] = useState({ name: m.name || '', email: m.email || '', phone: m.phone || '', role: m.role || '', address: m.address || '', notes: m.notes || '' });
  const save = async () => {
    const row = { ...f };
    if (!row.address && m.address === undefined) delete row.address; // works before 011 is run, too
    if (isNew) await s.insert('crew_members', row);
    else await s.update('crew_members', m.id, row);
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
      <Field label="Address" hint="(for their 1099)"><AddressInput multiline value={f.address} onChange={(v) => setF({ ...f, address: v })} /></Field>
      <Field label="Notes"><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. W-9 on file" /></Field>
    </Modal>
  );
}

