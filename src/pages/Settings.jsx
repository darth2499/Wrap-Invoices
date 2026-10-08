import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Empty, Field, Icon, Modal, MoneyInput, Seg, Switch } from '../components/ui.jsx';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { exportBackup, readBackup, restoreBackup } from '../lib/backup.js';
import { parseCSV, downloadBlob, pickFiles } from '../lib/files.js';
import { CLIENT_FIELDS, INVOICE_FIELDS, autoMap, clientsFromCsv, invoicesFromCsv, importInvoices, invoiceFromPdf } from '../lib/importer.js';
import { money, num, todayISO, addDays, plural } from '../lib/format.js';
import { DEMO } from '../config.js';
import { resetDemo } from '../api/demo.js';
import { go } from '../router.js';

const SECTIONS = [
  { value: 'business', label: 'Business' },
  { value: 'look', label: 'Invoice look' },
  { value: 'rates', label: 'Rates & items' },
  { value: 'email', label: 'Email & reminders' },
  { value: 'people', label: 'People' },
  { value: 'data', label: 'Data & backup' },
];

export default function Settings({ section = 'business' }) {
  const s = useStore();
  useEffect(() => {
    const check = () => {
      const msg = sessionStorage.getItem('wrap_gmail_result');
      if (msg) {
        sessionStorage.removeItem('wrap_gmail_result');
        s.toast(msg, { error: msg.startsWith('Gmail not') });
        s.reload('profile');
      }
    };
    check();
    window.addEventListener('wrap-gmail', check);
    return () => window.removeEventListener('wrap-gmail', check);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>
      <Seg value={section} onChange={(v) => go(`/settings?section=${v}`)} options={SECTIONS.filter((x) => x.value !== 'people' || s.db.profile.is_admin)} label="Settings section" />
      {section === 'business' && <Business />}
      {section === 'look' && <Look />}
      {section === 'rates' && <Rates />}
      {section === 'email' && <Email />}
      {section === 'people' && <People />}
      {section === 'data' && <Data />}
    </div>
  );
}

/** Edits a few profile fields with one Save button. */
function useProfileForm(fields) {
  const s = useStore();
  const [f, setF] = useState(() => Object.fromEntries(fields.map((k) => [k, s.db.profile[k] ?? ''])));
  const [busy, setBusy] = useState(false);
  const dirty = fields.some((k) => String(f[k] ?? '') !== String(s.db.profile[k] ?? ''));
  const save = async (extra = {}) => {
    setBusy(true);
    try {
      await s.updateProfile({ ...f, ...extra });
      s.toast('Saved');
    } catch (e) {
      s.toast(e.message, { error: true });
    }
    setBusy(false);
  };
  return { f, setF, save, busy, dirty };
}

function Business() {
  const s = useStore();
  const { f, setF, save, busy, dirty } = useProfileForm(['business_name', 'business_email', 'phone', 'website', 'address']);
  const [logo, setLogo] = useState(null);
  useEffect(() => {
    if (s.db.profile.logo_key) s.api.files.urls([s.db.profile.logo_key]).then((u) => setLogo(u[s.db.profile.logo_key]));
    else setLogo(null);
  }, [s.db.profile.logo_key]); // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async () => {
    const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp' });
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return s.toast('Logo must be under 3 MB', { error: true });
    const key = await s.api.files.upload(file, { folder: 'logo', ext: file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg' });
    const old = s.db.profile.logo_key;
    await s.updateProfile({ logo_key: key });
    if (old) s.api.files.remove([old]).catch(() => {});
    s.toast('Logo updated');
  };
  return (
    <div className="grid-2">
      <section className="card card-pad col" style={{ gap: 14 }}>
        <h2>Your business</h2>
        <p className="small muted">Shown at the top of every invoice.</p>
        <Field label="Business or your name"><input className="input" value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} /></Field>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field label="Email on invoices"><input className="input" type="email" value={f.business_email} onChange={(e) => setF({ ...f, business_email: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <Field label="Website" hint="(optional)"><input className="input" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="asahina.me" /></Field>
        <Field label="Address"><textarea className="input" rows={3} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Button variant="primary" busy={busy} disabled={!dirty} onClick={() => save()} style={{ alignSelf: 'flex-start' }}>Save</Button>
      </section>
      <section className="card card-pad col" style={{ gap: 14 }}>
        <h2>Logo</h2>
        <div style={{ height: 120, borderRadius: 12, background: 'var(--bg)', display: 'grid', placeItems: 'center', border: '1px dashed var(--field)' }}>
          {logo ? <img src={logo} alt="Your logo" style={{ maxHeight: 100, maxWidth: '90%' }} /> : <span className="muted small">No logo — your name is shown instead</span>}
        </div>
        <div className="row wrap">
          <Button icon="upload" onClick={upload}>{logo ? 'Replace logo' : 'Upload logo'}</Button>
          {logo && <Button variant="ghost" onClick={async () => { const k = s.db.profile.logo_key; await s.updateProfile({ logo_key: null }); s.api.files.remove([k]).catch(() => {}); }}>Remove</Button>}
        </div>
        <p className="small muted">PNG with a transparent background looks best. Wide logos work better than tall ones.</p>
      </section>
    </div>
  );
}

const SAMPLE = {
  invoice: { kind: 'invoice', number: '1', issue_date: todayISO(), due_date: addDays(todayISO(), 30), subtotal: 2026.4, discount_total: 0, tax_total: 0, total: 2026.4, notes: 'Month of October', terms: 'Net 30' },
  client: { name: 'Sample Client', email: 'client@example.com', address: '1 Market St\nSan Francisco, CA' },
  lines: [
    { item: 'Camera Operator', description: 'Orchestra (10/08-10/09)', note: '$750 + $750 (plus 1 hour OT)', qty: 1, rate: 1612.5, amount: 1612.5 },
    { item: 'Parking', description: 'Orchestra (10/08)', qty: 1, rate: 26, amount: 26 },
    { item: 'Sound Gear', description: 'Felicis (10/06)', qty: 1, rate: 387.9, amount: 387.9 },
  ],
};

function Look() {
  const s = useStore();
  const { f, setF, save, busy, dirty } = useProfileForm(['template', 'accent', 'payment_instructions', 'footer_note', 'default_terms_days', 'next_invoice_number', 'next_quote_number']);
  const [logo, setLogo] = useState(null);
  useEffect(() => { if (s.db.profile.logo_key) s.api.files.urls([s.db.profile.logo_key]).then((u) => setLogo(u[s.db.profile.logo_key])); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="row wrap" style={{ alignItems: 'flex-start', gap: 16 }}>
      <section className="card card-pad col" style={{ gap: 14, flex: '1 1 320px' }}>
        <h2>Template</h2>
        <Seg value={f.template} onChange={(v) => setF({ ...f, template: v })} label="Template" options={[{ value: 'minimal', label: 'Minimal' }, { value: 'classic', label: 'Classic' }, { value: 'bold', label: 'Bold' }]} />
        <Field label="Accent color" hint="(used by Bold and on emails)">
          <div className="row">
            <input type="color" value={f.accent || '#16161A'} onChange={(e) => setF({ ...f, accent: e.target.value })} style={{ width: 48, height: 40, border: '1px solid var(--field)', borderRadius: 10, padding: 3, background: '#fff' }} aria-label="Accent color" />
            {['#16161A', '#3346D3', '#0F7B6C', '#B4441F', '#7A3FB8'].map((c) => <button key={c} type="button" aria-label={`Use ${c}`} onClick={() => setF({ ...f, accent: c })} style={{ width: 28, height: 28, borderRadius: 8, border: f.accent === c ? '2px solid var(--ink)' : '1px solid var(--field)', background: c, cursor: 'pointer' }} />)}
          </div>
        </Field>
        <Field label="How to pay" hint="(shown on every invoice)"><textarea className="input" rows={3} value={f.payment_instructions} onChange={(e) => setF({ ...f, payment_instructions: e.target.value })} placeholder={'Zelle: you@email.com\nChecks payable to …'} /></Field>
        <Field label="Footer note"><input className="input" value={f.footer_note} onChange={(e) => setF({ ...f, footer_note: e.target.value })} placeholder="Thank you!" /></Field>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
          <Field label="Default terms (days)"><input className="input num" inputMode="numeric" value={f.default_terms_days} onChange={(e) => setF({ ...f, default_terms_days: e.target.value })} /></Field>
          <Field label="Next invoice #"><input className="input num" inputMode="numeric" value={f.next_invoice_number} onChange={(e) => setF({ ...f, next_invoice_number: e.target.value })} /></Field>
          <Field label="Next quote #"><input className="input num" inputMode="numeric" value={f.next_quote_number} onChange={(e) => setF({ ...f, next_quote_number: e.target.value })} /></Field>
        </div>
        <Button variant="primary" busy={busy} disabled={!dirty} style={{ alignSelf: 'flex-start' }} onClick={() => save({ default_terms_days: parseInt(f.default_terms_days, 10) || 30, next_invoice_number: parseInt(f.next_invoice_number, 10) || 1, next_quote_number: parseInt(f.next_quote_number, 10) || 1 })}>Save</Button>
      </section>
      <div style={{ flex: '2 1 480px', minWidth: 0 }} className="col">
        <span className="small muted">Preview</span>
        <InvoiceDoc business={{ ...s.db.profile, ...f }} invoice={SAMPLE.invoice} client={SAMPLE.client} lines={SAMPLE.lines} logoUrl={logo} />
      </div>
    </div>
  );
}

function Rates() {
  const s = useStore();
  const { db } = s;
  const { f, setF, save, busy, dirty } = useProfileForm(['ot_base_hours', 'ot_mult1', 'ot_mult1_hours', 'ot_mult2', 'mileage_rate']);
  const [item, setItem] = useState(null);
  const items = [...db.catalog_items].sort((a, b) => a.position - b.position);
  const kinds = [['labor', 'Your rates (labor)'], ['gear', 'Gear rental'], ['expense', 'Expenses & other']];
  return (
    <>
      <section className="card">
        <div className="card-head"><div><h2>Saved items &amp; gear</h2><p className="small muted">Pick these when building an invoice instead of typing rates every time.</p></div><Button variant="primary" icon="plus" onClick={() => setItem({ kind: 'labor', unit: 'day' })}>Add item</Button></div>
        {items.length === 0 && <Empty icon="file" title="No saved items yet" />}
        {kinds.map(([k, label]) => {
          const list = items.filter((i) => (k === 'expense' ? ['expense', 'other'].includes(i.kind) : i.kind === k));
          if (!list.length) return null;
          return (
            <div key={k}>
              <div className="small muted" style={{ padding: '10px 20px 4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
              {list.map((i) => (
                <button key={i.id} className="list-row" style={{ gridTemplateColumns: '1fr auto', opacity: i.archived ? 0.5 : 1 }} onClick={() => setItem(i)}>
                  <span className="col" style={{ gap: 0 }}><b style={{ fontWeight: 500 }}>{i.name}</b>{i.description && <span className="small muted">{i.description}</span>}</span>
                  <span className="num">{i.unit === 'flat' && !num(i.rate) ? 'Amount varies' : `${money(i.rate)}${i.unit === 'flat' ? '' : ` / ${i.unit}`}`}{i.week_rate ? <span className="small muted"> · {money(i.week_rate)}/wk</span> : null}</span>
                </button>
              ))}
            </div>
          );
        })}
      </section>
      <div className="grid-2">
        <section className="card card-pad col" style={{ gap: 12 }}>
          <h2>Overtime</h2>
          <p className="small muted">Used by the Advanced invoice editor. Hourly rate = day rate ÷ base hours. You can override the base hours per client.</p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <Field label="OT starts after (hours)"><MoneyInput value={f.ot_base_hours} onChange={(v) => setF({ ...f, ot_base_hours: v })} /></Field>
            <Field label="First tier multiplier"><MoneyInput value={f.ot_mult1} onChange={(v) => setF({ ...f, ot_mult1: v })} /></Field>
            <Field label="…for this many hours"><MoneyInput value={f.ot_mult1_hours} onChange={(v) => setF({ ...f, ot_mult1_hours: v })} /></Field>
            <Field label="Then multiplier"><MoneyInput value={f.ot_mult2} onChange={(v) => setF({ ...f, ot_mult2: v })} /></Field>
          </div>
          <p className="small muted">Example: $750 day, {f.ot_base_hours} h base, 13 h worked → {money(750 + Math.min(Math.max(0, 13 - num(f.ot_base_hours)), num(f.ot_mult1_hours)) * (750 / (num(f.ot_base_hours) || 10)) * num(f.ot_mult1) + Math.max(0, 13 - num(f.ot_base_hours) - num(f.ot_mult1_hours)) * (750 / (num(f.ot_base_hours) || 10)) * num(f.ot_mult2))}</p>
          <Field label="Mileage rate ($ per mile)" hint="— check the IRS standard rate each January"><MoneyInput value={f.mileage_rate} onChange={(v) => setF({ ...f, mileage_rate: v })} /></Field>
          <Button variant="primary" busy={busy} disabled={!dirty} style={{ alignSelf: 'flex-start' }} onClick={() => save()}>Save</Button>
        </section>
        <DayTypes />
      </div>
      <TaxRates />
      {item && <ItemModal item={item} onClose={() => setItem(null)} />}
    </>
  );
}

function ItemModal({ item, onClose }) {
  const s = useStore();
  const isNew = !item.id;
  const [f, setF] = useState({ name: item.name || '', description: item.description || '', kind: item.kind || 'labor', unit: item.unit || 'day', rate: item.rate ?? '', week_rate: item.week_rate ?? '', archived: !!item.archived });
  const save = async () => {
    const row = { ...f, rate: num(f.rate), week_rate: f.week_rate === '' ? null : num(f.week_rate), ot_eligible: f.kind === 'labor' && f.unit === 'day' };
    if (isNew) await s.insert('catalog_items', { ...row, position: s.db.catalog_items.length });
    else await s.update('catalog_items', item.id, row);
    onClose();
  };
  return (
    <Modal title={isNew ? 'New saved item' : item.name} onClose={onClose} footer={<>{!isNew && <Button variant="ghost" className="danger" icon="trash" style={{ marginRight: 'auto' }} onClick={async () => { await s.remove('catalog_items', item.id); onClose(); }}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name} onClick={save}>Save</Button></>}>
      <Field label="Type">
        <Seg value={f.kind} onChange={(k) => setF({ ...f, kind: k, unit: k === 'expense' ? 'flat' : f.unit })} options={[{ value: 'labor', label: 'Labor' }, { value: 'gear', label: 'Gear rental' }, { value: 'expense', label: 'Expense' }]} label="Type" />
      </Field>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'gear' ? 'Camera Package (FX6)' : 'Camera Operator'} autoFocus /></Field>
        <Field label="Charged per"><select className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="day">Day</option><option value="hour">Hour</option><option value="week">Week</option><option value="flat">Flat amount</option></select></Field>
        <Field label="Rate"><MoneyInput value={f.rate} onChange={(v) => setF({ ...f, rate: v })} /></Field>
        {f.kind === 'gear' && <Field label="Weekly rate" hint="(optional)"><MoneyInput value={f.week_rate} onChange={(v) => setF({ ...f, week_rate: v })} /></Field>}
      </div>
      <Field label="Default description" hint="(optional)"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={f.kind === 'gear' ? 'Sony FX6, 3 lenses, media' : ''} /></Field>
      {!isNew && <label className="check"><input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />Hide from pickers</label>}
    </Modal>
  );
}

function DayTypes() {
  const s = useStore();
  const list = [...s.db.day_types].sort((a, b) => a.position - b.position);
  const [name, setName] = useState('');
  const [pct, setPct] = useState(50);
  return (
    <section className="card card-pad col" style={{ gap: 10 }}>
      <h2>Day types &amp; fees</h2>
      <p className="small muted">Pick these per day or per line. The % is applied to the day rate (e.g. half day at 60%, cancellation under 24 h at 100%).</p>
      {list.map((d) => (
        <div key={d.id} className="row between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
          <span>{d.name}</span>
          <span className="row">
            <input className="input num" style={{ width: 80 }} inputMode="numeric" defaultValue={Math.round(num(d.multiplier) * 100)} aria-label={`${d.name} percent`} onBlur={(e) => { const v = num(e.target.value) / 100; if (v !== num(d.multiplier)) s.update('day_types', d.id, { multiplier: v }); }} />
            <span className="small muted">%</span>
            {d.name !== 'Full day' && <button className="btn ghost icon" aria-label={`Delete ${d.name}`} onClick={() => s.remove('day_types', d.id)}><Icon name="x" size={16} /></button>}
          </span>
        </div>
      ))}
      <form className="row" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await s.insert('day_types', { name: name.trim(), multiplier: num(pct) / 100, position: list.length }); setName(''); }}>
        <input className="input" placeholder="e.g. Rain day" value={name} onChange={(e) => setName(e.target.value)} aria-label="New day type" />
        <input className="input num" style={{ width: 80 }} value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Percent" />
        <Button type="submit">Add</Button>
      </form>
    </section>
  );
}

function TaxRates() {
  const s = useStore();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  return (
    <section className="card card-pad col" style={{ gap: 10 }}>
      <h2>Tax rates</h2>
      <p className="small muted">Optional. When you add one, invoices get a Tax column you can set per line.</p>
      {s.db.tax_rates.map((t) => (
        <div key={t.id} className="row between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
          <span>{t.name}</span>
          <span className="row"><span className="num">{num(t.rate)}%</span><button className="btn ghost icon" aria-label={`Delete ${t.name}`} onClick={() => s.remove('tax_rates', t.id)}><Icon name="x" size={16} /></button></span>
        </div>
      ))}
      <form className="row" onSubmit={async (e) => { e.preventDefault(); if (!name.trim() || !num(rate)) return; await s.insert('tax_rates', { name: name.trim(), rate: num(rate) }); setName(''); setRate(''); }}>
        <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Tax name" />
        <input className="input num" style={{ width: 90 }} placeholder="%" value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Tax percent" />
        <Button type="submit">Add</Button>
      </form>
    </section>
  );
}

function Email() {
  const s = useStore();
  const p = s.db.profile;
  const [days, setDays] = useState((p.reminder_days || []).join(', '));
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid-2">
      <section className="card card-pad col" style={{ gap: 12 }}>
        <h2>Gmail</h2>
        {p.gmail_email ? (
          <>
            <div className="banner good"><Icon name="check" /><span>Sending from <b>{p.gmail_email}</b>. Replies go to your inbox.</span></div>
            <div className="row wrap">
              <Button onClick={() => s.api.auth.connectGmail()}>Reconnect</Button>
              <Button variant="ghost" className="danger" busy={busy} onClick={async () => { setBusy(true); await s.api.gmail('disconnect'); await s.reload('profile'); setBusy(false); s.toast('Gmail disconnected'); }}>Disconnect</Button>
            </div>
          </>
        ) : (
          <>
            <p style={{ lineHeight: 1.6 }}>Connect Gmail to email invoices, reminders and statements from your own address. Google will ask to allow <b>“Send email on your behalf”</b> — Wrap can only send, never read your mail.</p>
            <Button variant="primary" icon="mail" style={{ alignSelf: 'flex-start' }} onClick={() => s.api.auth.connectGmail()}>Connect Gmail</Button>
          </>
        )}
      </section>
      <section className="card card-pad col" style={{ gap: 12 }}>
        <h2>Automatic reminders</h2>
        <p className="small muted">For invoices with “Automatic reminders” on, Wrap emails the client this many days after the due date (once each). Runs every morning.</p>
        <Field label="Days after due date"><input className="input num" value={days} onChange={(e) => setDays(e.target.value)} placeholder="3, 7, 14" /></Field>
        <label className="row between"><span>Turn on for new invoices by default</span><Switch checked={p.auto_remind_default} onChange={(v) => s.updateProfile({ auto_remind_default: v })} label="Default auto-remind" /></label>
        <Button variant="primary" style={{ alignSelf: 'flex-start' }} onClick={async () => {
          const arr = [...new Set(days.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((x) => x > 0 && x < 366))].sort((a, b) => a - b);
          await s.updateProfile({ reminder_days: arr.length ? arr : [3, 7, 14] });
          setDays((arr.length ? arr : [3, 7, 14]).join(', '));
          s.toast('Saved');
        }}>Save</Button>
        {!p.gmail_email && <span className="small" style={{ color: 'var(--warn)' }}>Connect Gmail first — reminders are sent from it.</span>}
      </section>
    </div>
  );
}

function People() {
  const s = useStore();
  const [email, setEmail] = useState('');
  if (!s.db.profile.is_admin) return <Empty title="Only the account owner can invite people" />;
  return (
    <section className="card card-pad col" style={{ gap: 12, maxWidth: 640 }}>
      <h2>Invite people</h2>
      <p className="small muted">Wrap is invite-only. Each person signs in with their Google account and gets their own private workspace — nobody can see anyone else’s invoices unless a link is shared.</p>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); const em = email.trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(em)) return s.toast('Enter an email', { error: true }); try { await s.insert('invites', { email: em }); setEmail(''); s.toast(`${em} can now sign in`); } catch (err) { s.toast(err.message, { error: true }); } }}>
        <input className="input" type="email" placeholder="name@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email to invite" />
        <Button type="submit" variant="primary">Invite</Button>
      </form>
      {s.db.invites.map((i) => (
        <div key={i.email} className="row between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
          <span>{i.email} {i.is_admin && <span className="pill draft">Owner</span>}</span>
          {!i.is_admin && <Button size="sm" variant="ghost" onClick={async () => { if (await s.confirm({ title: `Remove ${i.email}?`, body: 'They won’t be able to create a new account. If they already signed up, their data stays until you delete their user in Supabase.', ok: 'Remove' })) await s.remove('invites', i.email); }}>Remove</Button>}
        </div>
      ))}
      <p className="small muted">After inviting, send them your Wrap address so they can sign in.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
function Data() {
  const s = useStore();
  const [step, setStep] = useState('');
  const [restore, setRestore] = useState(null);
  const [imp, setImp] = useState(null);
  const counts = { invoices: s.db.invoices.length, receipts: s.db.receipts.length, clients: s.db.clients.length };
  const backup = async () => {
    setStep('Preparing…');
    try {
      const { blob, name, missing } = await exportBackup(s.api, s.db, setStep);
      downloadBlob(blob, name);
      s.toast(missing.length ? `Backup saved — ${missing.length} files couldn’t be downloaded` : 'Backup downloaded');
      localStorage.setItem('wrap_last_backup', todayISO());
    } catch (e) {
      s.toast(e.message, { error: true });
    }
    setStep('');
  };
  const last = (() => { try { return localStorage.getItem('wrap_last_backup'); } catch { return null; } })();
  return (
    <>
      <div className="grid-2">
        <section className="card card-pad col" style={{ gap: 12 }}>
          <h2>Back up everything</h2>
          <p className="muted" style={{ lineHeight: 1.6 }}>Downloads one .zip with all your data ({plural(counts.invoices, 'invoice')}, {plural(counts.receipts, 'receipt')}, {plural(counts.clients, 'client')}…) and every receipt image. Keep it somewhere safe, like Google Drive.</p>
          <Button variant="primary" icon="download" busy={!!step} onClick={backup} style={{ alignSelf: 'flex-start' }}>{step || 'Download backup'}</Button>
          <span className="small muted">{last ? `Last backup from this browser: ${last}` : 'Tip: back up once a month.'}</span>
        </section>
        <section className="card card-pad col" style={{ gap: 12 }}>
          <h2>Restore from a backup</h2>
          <p className="muted" style={{ lineHeight: 1.6 }}>Upload a Wrap backup .zip to bring everything back — data, receipts and settings. Links you shared keep working.</p>
          <Button icon="upload" style={{ alignSelf: 'flex-start' }} onClick={async () => {
            const [file] = await pickFiles({ accept: '.zip,application/zip' });
            if (!file) return;
            try { setRestore({ ...(await readBackup(file)), name: file.name }); } catch (e) { s.toast(e.message, { error: true }); }
          }}>Choose backup file</Button>
        </section>
      </div>
      <section className="card card-pad col" style={{ gap: 12 }}>
        <h2>Import from Wave or another app</h2>
        <p className="muted" style={{ lineHeight: 1.6 }}>Bring in your clients and past invoices so reports and the year-end forecast have history.</p>
        <div className="row wrap">
          <Button icon="clients" onClick={async () => { const [f] = await pickFiles({ accept: '.csv,text/csv' }); if (f) setImp({ type: 'clients', csv: parseCSV(await f.text()) }); }}>Clients from CSV</Button>
          <Button icon="invoice" onClick={async () => { const [f] = await pickFiles({ accept: '.csv,text/csv' }); if (f) setImp({ type: 'invoices', csv: parseCSV(await f.text()) }); }}>Invoices from CSV</Button>
          <Button icon="sparkle" onClick={async () => { const files = await pickFiles({ accept: 'application/pdf', multiple: true }); if (files.length) setImp({ type: 'pdfs', files }); }}>Wave invoice PDFs</Button>
        </div>
        <p className="small muted">In Wave: Sales &amp; Payments → Customers → Export for clients. For invoices, download each invoice as PDF (Wrap reads them, including line items and payments) or export a CSV.</p>
      </section>
      {DEMO && (
        <section className="card card-pad col" style={{ gap: 10 }}>
          <h2>Demo data</h2>
          <p className="muted">You’re in demo mode. Data lives only in this browser.</p>
          <Button className="danger" style={{ alignSelf: 'flex-start' }} onClick={async () => { if (await s.confirm({ title: 'Reset demo data?', body: 'Puts the sample data back.', ok: 'Reset', danger: true })) { resetDemo(); window.location.reload(); } }}>Reset demo data</Button>
        </section>
      )}
      {restore && <RestoreModal backup={restore} onClose={() => setRestore(null)} />}
      {imp && <ImportModal imp={imp} onClose={() => setImp(null)} />}
    </>
  );
}

function RestoreModal({ backup, onClose }) {
  const s = useStore();
  const [mode, setMode] = useState('replace');
  const [step, setStep] = useState('');
  const run = async () => {
    if (mode === 'replace' && !(await s.confirm({ title: 'Replace everything?', body: 'Your current data in Wrap is deleted and replaced with the backup. Download a backup of the current data first if you might need it.', ok: 'Replace', danger: true }))) return;
    setStep('Starting…');
    try {
      const { failed, problems, added } = await restoreBackup(s.api, backup, s.user.id, mode, setStep, s.db);
      await s.load();
      const what = mode === 'merge' ? ` — added ${added.invoices} invoices, ${added.receipts} receipts, ${added.clients} clients` : '';
      s.toast(`Restore complete${what}${failed.length ? ` · ${failed.length} files couldn’t be uploaded` : ''}${problems.length ? ` · ${problems.length} rows skipped` : ''}`, { ms: 9000 });
      if (problems.length) console.warn('Restore problems', problems);
      onClose();
    } catch (e) {
      s.toast(`Restore stopped: ${e.message}`, { error: true });
      setStep('');
    }
  };
  const c = backup.counts;
  return (
    <Modal title="Restore backup" onClose={step ? null : onClose} footer={<><Button onClick={onClose} disabled={!!step}>Cancel</Button><Button variant="primary" busy={!!step} onClick={run}>{step || 'Restore'}</Button></>}>
      <p><b>{backup.name}</b> · made {new Date(backup.data.exported_at).toLocaleString()}</p>
      <p className="muted small">{c.invoices} invoices · {c.receipts} receipts · {c.clients} clients · {c.payments} payments · {backup.files.length} files</p>
      <Seg value={mode} onChange={setMode} label="Restore mode" options={[{ value: 'replace', label: 'Replace everything' }, { value: 'merge', label: 'Merge with current data' }]} />
      <p className="small muted" style={{ lineHeight: 1.5 }}>{mode === 'replace' ? 'Best for moving to a new account or undoing a mistake: Wrap ends up exactly like the backup.' : 'Adds anything from the backup that’s missing here. Things you already have stay exactly as they are.'}</p>
    </Modal>
  );
}

function ImportModal({ imp, onClose }) {
  const s = useStore();
  const fields = imp.type === 'clients' ? CLIENT_FIELDS : INVOICE_FIELDS;
  const [map, setMap] = useState(() => (imp.csv ? autoMap(imp.csv.headers, fields) : {}));
  const [step, setStep] = useState('');
  const [pdfList, setPdfList] = useState(null);
  const [errors, setErrors] = useState([]);
  useEffect(() => {
    if (imp.type !== 'pdfs') return;
    (async () => {
      const out = [];
      const errs = [];
      for (const [i, f] of imp.files.entries()) {
        setStep(`Reading ${i + 1} / ${imp.files.length}: ${f.name}`);
        try { out.push(await invoiceFromPdf(f, s.api)); } catch (e) { errs.push(`${f.name}: ${e.message}`); }
      }
      setPdfList(out);
      setErrors(errs);
      setStep('');
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = imp.type === 'clients' ? clientsFromCsv(imp.csv.rows, map) : imp.type === 'invoices' ? invoicesFromCsv(imp.csv.rows, map) : pdfList || [];
  const run = async () => {
    setStep('Importing…');
    try {
      if (imp.type === 'clients') {
        const existing = new Set(s.db.clients.map((c) => c.name.toLowerCase()));
        const fresh = preview.filter((c) => !existing.has(c.name.toLowerCase()));
        for (let i = 0; i < fresh.length; i += 200) await s.api.insert('clients', fresh.slice(i, i + 200));
        s.toast(`${fresh.length} clients added${preview.length - fresh.length ? `, ${preview.length - fresh.length} already existed` : ''}`);
      } else {
        const { created, skipped } = await importInvoices(preview, { db: s.db, api: s.api, onStep: setStep });
        s.toast(`${created} invoices imported${skipped.length ? ` · skipped ${skipped.join(', ')}` : ''}`, { ms: 8000 });
      }
      await s.load();
      onClose();
    } catch (e) {
      s.toast(e.message, { error: true });
      setStep('');
    }
  };
  return (
    <Modal wide title={imp.type === 'clients' ? 'Import clients' : 'Import invoices'} onClose={step ? null : onClose} footer={<><Button onClick={onClose} disabled={!!step}>Cancel</Button><Button variant="primary" busy={!!step} disabled={!preview.length} onClick={run}>{step || `Import ${preview.length}`}</Button></>}>
      {imp.csv && (
        <>
          <p className="small muted">Match your file’s columns. We guessed what we could.</p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
            {fields.map((fl) => (
              <Field key={fl.key} label={fl.label}>
                <select className="input" value={map[fl.key] || ''} onChange={(e) => setMap({ ...map, [fl.key]: e.target.value })}>
                  <option value="">— none —</option>{imp.csv.headers.map((h) => <option key={h}>{h}</option>)}
                </select>
              </Field>
            ))}
          </div>
        </>
      )}
      {step && !preview.length && <span className="row muted"><span className="spinner" />{step}</span>}
      {errors.map((e) => <div key={e} className="banner bad">{e}</div>)}
      <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
        <table className="table">
          <tbody>
            {preview.slice(0, 100).map((r, i) => imp.type === 'clients'
              ? <tr key={i}><td>{r.name}</td><td className="muted">{r.email}</td><td className="small muted" style={{ whiteSpace: 'pre-line' }}>{r.address}</td></tr>
              : <tr key={i}><td>#{r.number}</td><td>{r.client}</td><td className="muted">{r.date}</td><td className="small muted">{r.lines.length} lines</td><td className="right num">{money(r.total)}</td><td className="right num muted">{r.amountDue > 0 ? `${money(r.amountDue)} due` : 'Paid'}</td></tr>)}
          </tbody>
        </table>
      </div>
      <span className="small muted">{preview.length} found{preview.length > 100 ? ' (showing 100)' : ''}</span>
    </Modal>
  );
}
