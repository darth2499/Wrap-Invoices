import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Empty, Field, Icon, Modal, MoneyInput, Seg, Switch } from '../components/ui.jsx';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { exportBackup, readBackup, restoreBackup } from '../lib/backup.js';
import { parseCSV, downloadBlob, pickFiles } from '../lib/files.js';
import { CLIENT_FIELDS, INVOICE_FIELDS, autoMap, clientsFromCsv, invoicesFromCsv, importInvoices, importExpenses, importClients, invoiceFromPdf, pdfMatch } from '../lib/importer.js';
import { isWaveAccounting, parseWaveAccounting, readWaveFiles } from '../lib/wave.js';
import { money, num, todayISO, addDays, plural } from '../lib/format.js';
import { DEMO } from '../config.js';
import { CATEGORIES, ownCategories } from '../lib/categories.js';
import { resetDemo } from '../api/demo.js';
import { go } from '../router.js';

const SECTIONS = [
  { value: 'business', label: 'Business' },
  { value: 'look', label: 'Invoice look' },
  { value: 'rates', label: 'Rates & items' },
  { value: 'categories', label: 'Expense categories' },
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
      {section === 'categories' && <Categories />}
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
        <Field label="Website" hint="(optional)"><input className="input" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="yourwebsite.com" /></Field>
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
    { item: 'Camera Operator', description: 'Brand shoot (10/08-10/09)', note: '$750 + $750 (plus 1 hour OT)', qty: 1, rate: 1612.5, amount: 1612.5 },
    { item: 'Parking', description: 'Brand shoot (10/08)', qty: 1, rate: 26, amount: 26 },
    { item: 'Sound Gear', description: 'Brand shoot (10/06)', qty: 1, rate: 387.9, amount: 387.9 },
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
  const [wave, setWave] = useState(null);
  const counts = { invoices: s.db.invoices.length, receipts: s.db.receipts.length, clients: s.db.clients.length };
  const backup = async () => {
    if (DEMO) return; // demo: downloads are switched off
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
          <Button disabled={DEMO} variant="primary" icon="download" busy={!!step} onClick={() => !DEMO && backup()} style={{ alignSelf: 'flex-start' }}>{step || 'Download backup'}</Button>
          <span className="small muted">{last ? `Last backup from this browser: ${last}` : 'Tip: back up once a month.'}</span>
        </section>
        <section className="card card-pad col" style={{ gap: 12 }}>
          <h2>Restore from a backup</h2>
          <p className="muted" style={{ lineHeight: 1.6 }}>Upload a Wrap backup .zip to bring everything back — data, receipts and settings. Links you shared keep working.</p>
          <Button disabled={DEMO} icon="upload" style={{ alignSelf: 'flex-start' }} onClick={async () => { if (DEMO) return;
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
          <Button disabled={DEMO} variant="primary" icon="upload" onClick={async () => { if (DEMO) return; const files = await pickFiles({ accept: '.zip,.csv,application/zip,text/csv', multiple: true }); if (files.length) setWave(files); }}>Wave export (.zip)</Button>
          <Button disabled={DEMO} icon="clients" onClick={async () => { if (DEMO) return; const [f] = await pickFiles({ accept: '.csv,text/csv' }); if (f) setImp({ type: 'clients', csv: parseCSV(await f.text()) }); }}>Clients from CSV</Button>
          <Button disabled={DEMO} icon="invoice" onClick={async () => { if (DEMO) return; const [f] = await pickFiles({ accept: '.csv,text/csv' }); if (f) setImp({ type: 'invoices', csv: parseCSV(await f.text()) }); }}>Invoices from CSV</Button>
          <Button disabled={DEMO} icon="sparkle" onClick={async () => { if (DEMO) return; const files = await pickFiles({ accept: 'application/pdf', multiple: true }); if (files.length) setImp({ type: 'pdfs', files }); }}>Wave invoice PDFs</Button>
        </div>
        <p className="small muted"><b>Easiest:</b> pick the .zip from Wave (or select its CSV files together). Wrap figures out which file is which and imports customers first, then invoices, payments and expenses. Safe to run again: anything already in Wrap is skipped.</p>
        <p className="small muted">In Wave: Sales &amp; Payments → Customers → Export for clients. Invoice PDFs (Wrap reads line items and payments) can be added any time: if the invoice is already in Wrap from the zip, its line details are filled in instead of making a duplicate.</p>
      </section>
      {DEMO && (
        <section className="card card-pad col" style={{ gap: 10 }}>
          <h2>Demo data</h2>
          <p className="muted">You’re in demo mode. Data lives only in this browser.</p>
          <Button className="danger" style={{ alignSelf: 'flex-start' }} onClick={async () => { if (await s.confirm({ title: 'Reset demo data?', body: 'Puts the sample data back.', ok: 'Reset', danger: true })) { resetDemo(); window.location.reload(); } }}>Reset demo data</Button>
        </section>
      )}
      <StorageCard />
      <ResetSection onBackup={backup} backupBusy={!!step} />
      {restore && <RestoreModal backup={restore} onClose={() => setRestore(null)} />}
      {imp && <ImportModal imp={imp} onClose={() => setImp(null)} />}
      {wave && <WaveModal files={wave} onClose={() => setWave(null)} />}
    </>
  );
}

/** How much of Cloudflare's free 10 GB is used. Uploads stop at the limit, so it never costs anything. */
function StorageCard() {
  const s = useStore();
  const [u, setU] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = async (recount = false) => {
    setBusy(true);
    try {
      if (typeof s.api.files.usage !== 'function') throw new Error('Storage info needs the latest src/api/supabase.js — re-upload it.');
      setU(await s.api.files.usage(recount)); setErr('');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  useEffect(() => { if (!DEMO) load(); else setU({ used: 0, limit: 9.5 * 1024 ** 3, mine: 0 }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const GB = 1024 ** 3;
  const fmt = (n) => (n >= GB ? `${(n / GB).toFixed(2)} GB` : `${Math.max(0, n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`);
  const pct = u ? Math.min(100, (u.used / u.limit) * 100) : 0;
  const color = pct >= 90 ? 'var(--bad)' : pct >= 75 ? 'var(--warn, #b7791f)' : 'var(--accent)';
  const admin = s.db.profile.is_admin;
  return (
    <section className="card card-pad col" style={{ gap: 12 }}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <h2>Receipt storage</h2>
        {admin && <Button size="sm" variant="ghost" busy={busy} onClick={() => load(true)}>Recount</Button>}
      </div>
      {err && <div className="banner bad">{err}</div>}
      {!u && !err && <span className="row muted"><span className="spinner" />Checking…</span>}
      {u && (
        <>
          <div style={{ height: 10, borderRadius: 5, background: 'var(--hover)', overflow: 'hidden' }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Storage used">
            <div style={{ width: `${Math.max(pct, 0.5)}%`, height: '100%', background: color }} />
          </div>
          <span className="row between wrap small" style={{ gap: 8 }}>
            <span><b className="num">{fmt(u.used)}</b> of {fmt(u.limit)} used ({pct.toFixed(pct < 1 ? 2 : 0)}%){admin && u.mine !== u.used ? ` · yours: ${fmt(u.mine)}` : ''}</span>
            <span className="muted">{fmt(Math.max(0, u.limit - u.used))} left</span>
          </span>
          <p className="small muted" style={{ lineHeight: 1.6 }}>Cloudflare is free up to 10 GB. Wrap stops uploads at {fmt(u.limit)}, so you’re never charged: when it’s full, new receipts can’t be added until you delete old receipt images. Shared by everyone you’ve invited.</p>
        </>
      )}
    </section>
  );
}

const SETTINGS_DEFAULTS = {
  business_name: null, business_email: null, address: null, phone: null, website: null, logo_key: null,
  template: 'minimal', accent: '#16161A', payment_instructions: null, footer_note: null,
  default_terms_days: 30, ot_base_hours: 10, ot_mult1: 1.5, ot_mult1_hours: 2, ot_mult2: 2,
  reminder_days: [3, 7, 14], auto_remind_default: false, mileage_rate: 0.7, tax_set_aside_pct: 25,
};

/** "Danger zone": wipes the account. Locked behind a switch, then two separate confirmations. */
function ResetSection({ onBackup, backupBusy }) {
  const s = useStore();
  const [unlocked, setUnlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const start = async () => { if (DEMO) return;
    const ok = await s.confirm({
      title: 'Delete all your data?',
      body: 'Every invoice, quote, client, receipt, expense, payment and report in this account will be deleted. This can’t be undone.',
      ok: 'Yes, continue',
      danger: true,
    });
    if (ok) setOpen(true);
    else setUnlocked(false);
  };
  return (
    <section className="card card-pad col" style={{ gap: 12, borderColor: 'var(--bad)' }}>
      <h2 style={{ color: 'var(--bad)' }}>Reset account</h2>
      <p className="muted" style={{ lineHeight: 1.6 }}>Deletes all your data and receipt files so you can start from scratch. Your login, Gmail connection and invites stay. Download a backup first if you might want it back.</p>
      <label className="row" style={{ gap: 10, alignSelf: 'flex-start', cursor: 'pointer' }}>
        <Switch checked={unlocked} disabled={DEMO} onChange={(v) => !DEMO && setUnlocked(v)} label="Unlock reset" />
        <span>{unlocked ? 'Reset unlocked' : 'Turn on to unlock reset'}</span>
      </label>
      <Button className="danger" icon="trash" disabled={!unlocked} style={{ alignSelf: 'flex-start', opacity: unlocked ? 1 : 0.45 }} onClick={start}>{'Reset account…'}</Button>
      {open && <ResetModal onBackup={onBackup} backupBusy={backupBusy} onClose={() => { setOpen(false); setUnlocked(false); }} />}
    </section>
  );
}

function ResetModal({ onBackup, backupBusy, onClose }) {
  const s = useStore();
  const [typed, setTyped] = useState('');
  const [settingsToo, setSettingsToo] = useState(false);
  const [step, setStep] = useState('');
  const ready = typed.trim().toUpperCase() === 'RESET';
  const counts = { invoices: s.db.invoices.length, clients: s.db.clients.length, receipts: s.db.receipts.length };
  const run = async () => { if (DEMO) return;
    if (!ready) return;
    try {
      const keys = s.db.receipts.flatMap((r) => [r.file_key, r.original_key]).filter(Boolean);
      if (settingsToo && s.db.profile.logo_key) keys.push(s.db.profile.logo_key);
      setStep('Deleting data…');
      await s.api.rpc('wipe_my_data', {});
      for (let i = 0; i < keys.length; i += 200) {
        setStep(`Deleting files ${Math.min(i + 200, keys.length)} / ${keys.length}`);
        try { await s.api.files.remove(keys.slice(i, i + 200)); } catch { /* data is already gone; leftover files are harmless */ }
      }
      await s.api.updateProfile({ next_invoice_number: 1, next_quote_number: 1, ...(settingsToo ? SETTINGS_DEFAULTS : {}) });
      await s.reload();
      s.toast('Account reset — starting fresh');
      onClose();
      go('/');
    } catch (e) {
      s.toast(e.message, { error: true });
      setStep('');
    }
  };
  return (
    <Modal
      title="Last check: reset account"
      onClose={step ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={!!step}>Cancel</Button>
          <Button variant="primary" className="danger-fill" icon="trash" disabled={!ready} busy={!!step} onClick={run}>{step || 'Delete everything'}</Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <p style={{ lineHeight: 1.6 }}>This permanently deletes {plural(counts.invoices, 'invoice')}, {plural(counts.clients, 'client')} and {plural(counts.receipts, 'receipt')} (with their files), plus mileage, crew, saved items and 1099 records. Invoice numbers go back to #1. Shared links stop working.</p>
        <Button icon="download" busy={backupBusy} onClick={onBackup} style={{ alignSelf: 'flex-start' }}>Download a backup first</Button>
        <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={settingsToo} onChange={(e) => setSettingsToo(e.target.checked)} />
          <span>Also reset business details &amp; settings (name, logo, template, overtime, reminders)</span>
        </label>
        <Field label="Type RESET to confirm">
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="RESET" autoComplete="off" autoCapitalize="characters" />
        </Field>
      </div>
    </Modal>
  );
}

function RestoreModal({ backup, onClose }) {
  const s = useStore();
  const [mode, setMode] = useState('replace');
  const [step, setStep] = useState('');
  const run = async () => { if (DEMO) return;
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
  const wave = imp.type === 'invoices' && imp.csv && isWaveAccounting(imp.csv.headers);
  const fields = imp.type === 'clients' ? CLIENT_FIELDS : INVOICE_FIELDS;
  const [map, setMap] = useState(() => (imp.csv && !wave ? autoMap(imp.csv.headers, fields) : {}));
  const [assume, setAssume] = useState('unpaid');
  const [terms, setTerms] = useState(30);
  const [withInvoices, setWithInvoices] = useState(true);
  const [withExpenses, setWithExpenses] = useState(true);
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

  const w = wave ? parseWaveAccounting(imp.csv.rows, { termsDays: Number(terms) || 30 }) : null;
  const existingNums = new Set(s.db.invoices.filter((i) => i.kind === 'invoice').map((i) => String(i.number)));
  const preview = wave
    ? [...w.invoices].sort((a, b) => (b.amountDue > 0) - (a.amountDue > 0) || (Number(b.number) || 0) - (Number(a.number) || 0))
    : imp.type === 'clients' ? clientsFromCsv(imp.csv.rows, map)
      : imp.type === 'invoices' ? invoicesFromCsv(imp.csv.rows, map, { assume }) : pdfList || [];
  const count = wave ? (withInvoices ? w.invoices.length : 0) + (withExpenses ? w.expenses.length : 0) : imp.type === 'pdfs' ? preview.filter((r) => pdfMatch(r, s.db).action !== 'skip').length : preview.length;

  const run = async () => { if (DEMO) return;
    setStep('Importing…');
    try {
      if (imp.type === 'clients') {
        const r = await importClients(preview, { db: s.db, api: s.api });
        s.toast(`${r.created} clients added${r.existing ? `, ${r.existing} already existed${r.updated ? ` (${r.updated} filled in)` : ''}` : ''}`);
      } else {
        const parts = [];
        let action = null;
        if (!wave || withInvoices) {
          const { created, filled, skipped, ids } = await importInvoices(wave ? w.invoices : preview, { db: s.db, api: s.api, onStep: setStep, fill: imp.type === 'pdfs' });
          parts.push(`${created} invoice${created === 1 ? '' : 's'} imported`);
          if (ids.length) action = ids.length === 1 ? { label: 'View invoice', run: () => go(`/invoices/${ids[0]}`) } : { label: 'View invoices', run: () => go('/invoices') };
          if (filled) parts.push(`${filled} existing invoices filled in with line details`);
          if (skipped.length) parts.push(`${skipped.length} skipped: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`);
        }
        if (wave && withExpenses && w.expenses.length) {
          const { created, skipped } = await importExpenses(w.expenses, { db: s.db, api: s.api, onStep: setStep });
          parts.push(`${created} expenses added${skipped ? ` (${skipped} already there)` : ''}`);
        }
        s.toast(parts.join(' · '), { ms: 12000, action });
      }
      await s.load();
      onClose();
    } catch (e) {
      s.toast(e.message, { error: true });
      setStep('');
    }
  };
  return (
    <Modal wide title={imp.type === 'clients' ? 'Import clients' : 'Import invoices'} onClose={step ? null : onClose} footer={<><Button onClick={onClose} disabled={!!step}>Cancel</Button><Button variant="primary" busy={!!step} disabled={!count} onClick={run}>{step || `Import ${count}`}</Button></>}>
      {wave && (
        <>
          <div className="banner good"><Icon name="check" /><span>Wave accounting export found, covering {w.from} to {w.to}. It has <b>{w.invoices.length} invoices</b>, <b>{w.unpaidCount} still unpaid ({money(w.unpaidTotal)})</b>, and <b>{w.expenses.length} expenses</b>. Payments are matched to each invoice, so only the unpaid ones show as owed.</span></div>
          <div className="row wrap" style={{ gap: 18 }}>
            <label className="check"><input type="checkbox" checked={withInvoices} onChange={(e) => setWithInvoices(e.target.checked)} />Invoices &amp; payments</label>
            <label className="check"><input type="checkbox" checked={withExpenses} onChange={(e) => setWithExpenses(e.target.checked)} />Expenses ({w.expenses.length}, without receipt images)</label>
            <label className="row small muted" style={{ gap: 6 }}>Due date = invoice date +<input className="input num" style={{ width: 64 }} value={terms} onChange={(e) => setTerms(e.target.value)} aria-label="Payment terms in days" /> days</label>
          </div>
          <p className="small muted">Wave’s export doesn’t include line descriptions like “Brand shoot (04/06)”, so lines come in with their item name and amount. Import the invoice PDFs afterwards to add those details to the matching invoices (no duplicates).</p>
        </>
      )}
      {imp.csv && !wave && (
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
          {imp.type === 'invoices' && !map.amount_due && (
            <Field label="Your file has no “amount still due” column. Treat these invoices as:" style={{ maxWidth: 420 }}>
              <select className="input" value={assume} onChange={(e) => setAssume(e.target.value)}>
                <option value="unpaid">Unpaid (I'll record payments myself)</option>
                <option value="paid">Paid in full</option>
              </select>
            </Field>
          )}
        </>
      )}
      {step && !preview.length && <span className="row muted"><span className="spinner" />{step}</span>}
      {errors.map((e) => <div key={e} className="banner bad">{e}</div>)}
      {(!wave || withInvoices) && (
        <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
          <table className="table">
            <tbody>
              {preview.slice(0, 100).map((r, i) => imp.type === 'clients'
                ? <tr key={i}><td>{r.name}</td><td className="muted">{r.email}</td><td className="small muted" style={{ whiteSpace: 'pre-line' }}>{r.address}</td></tr>
                : (() => { const m = imp.type === 'pdfs' ? pdfMatch(r, s.db) : { action: existingNums.has(String(r.number)) ? 'skip' : 'new', reason: 'Already in Wrap' }; return <tr key={i} style={{ opacity: m.action === 'skip' ? 0.45 : 1 }}><td>#{r.number}</td><td>{r.client}</td><td className="muted">{r.date}</td><td className="small muted">{plural(r.lines.length, 'line')}{r.notes ? ` · ${r.notes}` : ''}</td><td className="right num">{money(r.total)}</td><td className="right num" style={{ color: m.action === 'fill' ? 'var(--good)' : r.amountDue > 0 && m.action === 'new' ? 'var(--bad)' : 'var(--muted)' }}>{m.action === 'fill' ? 'Adds details to the one in Wrap' : m.action === 'skip' ? m.reason : r.amountDue > 0 ? `${money(r.amountDue)} due` : 'Paid'}</td></tr>; })())}
            </tbody>
          </table>
        </div>
      )}
      {(!wave || withInvoices) && <span className="small muted">{preview.length} found{preview.length > 100 ? ' (showing 100; unpaid first)' : ''}</span>}
    </Modal>
  );
}

function WaveRow({ enabled, checked, disabled, onChange, title, file, children }) {
  return (
    <label className="row" style={{ gap: 12, alignItems: 'flex-start', padding: '12px 0', borderTop: '1px solid var(--line)', cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5 }}>
      <input type="checkbox" style={{ marginTop: 3 }} disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="col" style={{ gap: 3 }}>
        <b>{title}</b>
        <span className="small muted" style={{ lineHeight: 1.5 }}>{children}</span>
        {file && <span className="small muted">From {file}</span>}
      </span>
    </label>
  );
}

/** One-step Wave import: the .zip (or its CSVs). Customers first, then invoices + payments, then expenses. */
function WaveModal({ files, onClose }) {
  const s = useStore();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [terms, setTerms] = useState(30);
  const [want, setWant] = useState({ clients: true, invoices: true, expenses: true });
  const [step, setStep] = useState('');
  useEffect(() => { readWaveFiles(files).then(setData, (e) => setErr(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clients = data?.customers ? clientsFromCsv(data.customers.rows, autoMap(data.customers.headers, CLIENT_FIELDS)) : [];
  const known = new Set(s.db.clients.map((c) => c.name.trim().toLowerCase()));
  const newClients = clients.filter((c) => !known.has(c.name.trim().toLowerCase())).length;
  const w = data?.accounting ? parseWaveAccounting(data.accounting.rows, { termsDays: Number(terms) || 30 }) : null;
  const existingNums = new Set(s.db.invoices.filter((i) => i.kind === 'invoice').map((i) => String(i.number)));
  const newInvoices = w ? w.invoices.filter((i) => !existingNums.has(String(i.number))) : [];
  const unpaid = newInvoices.filter((i) => i.amountDue > 0.009);
  const has = { clients: clients.length > 0, invoices: !!w?.invoices.length, expenses: !!w?.expenses.length };
  const on = (k) => has[k] && want[k];
  const nothing = !on('clients') && !on('invoices') && !on('expenses');

  const run = async () => { if (DEMO) return;
    const parts = [];
    try {
      let db = s.db;
      if (on('clients')) {
        setStep('Adding customers…');
        const r = await importClients(clients, { db, api: s.api });
        db = { ...db, clients: r.clients };
        parts.push(`${r.created} customers added${r.updated ? ` (${r.updated} existing filled in)` : ''}`);
      }
      if (on('invoices')) {
        const r = await importInvoices(w.invoices, { db, api: s.api, onStep: setStep });
        parts.push(`${r.created} invoices imported${r.skipped.length ? ` (${r.skipped.length} already in Wrap)` : ''}`);
      }
      if (on('expenses')) {
        const r = await importExpenses(w.expenses, { db, api: s.api, onStep: setStep });
        parts.push(`${r.created} expenses added${r.skipped ? ` (${r.skipped} already there)` : ''}`);
      }
      s.toast(parts.join(' · '), { ms: 10000 });
      await s.load();
      onClose();
    } catch (e) {
      s.toast(`${parts.length ? `${parts.join(' · ')}, then stopped: ` : ''}${e.message}`, { error: true, ms: 12000 });
      await s.load().catch(() => {});
      setStep('');
    }
  };

  const rowProps = (k) => ({ enabled: has[k], checked: on(k), disabled: !has[k] || !!step, onChange: (v) => setWant({ ...want, [k]: v }) });

  return (
    <Modal wide title="Import from Wave" onClose={step ? null : onClose} footer={<><Button onClick={onClose} disabled={!!step}>Cancel</Button><Button variant="primary" busy={!!step} disabled={!data || nothing} onClick={run}>{step || 'Import'}</Button></>}>
      {err && <div className="banner bad">{err}</div>}
      {!data && !err && <span className="row muted"><span className="spinner" />Reading files…</span>}
      {data && (
        <div className="col" style={{ gap: 0 }}>
          {!data.customers && !data.accounting && <div className="banner bad">No Wave files found. Pick the .zip from Wave, or its accounting and customers CSV files.</div>}
          <p className="small muted" style={{ marginBottom: 6 }}>Runs in this order so every invoice links to the right customer. Anything already in Wrap is skipped.</p>
          <WaveRow {...rowProps('clients')} title={`1. Customers${has.clients ? ` (${clients.length})` : ''}`} file={data.names.customers.join(', ')}>
            {has.clients
              ? <>{newClients} new{clients.length - newClients ? `, ${clients.length - newClients} already in Wrap (missing email, phone or address gets filled in)` : ''}. Contact names go in each client’s notes.</>
              : <>No customers file found. Clients will still be created from the names on invoices, just without email or address.</>}
          </WaveRow>
          <WaveRow {...rowProps('invoices')} title={`2. Invoices & payments${has.invoices ? ` (${w.invoices.length})` : ''}`} file={data.names.accounting.join(', ')}>
            {has.invoices
              ? <>{newInvoices.length} new{w.invoices.length - newInvoices.length ? `, ${w.invoices.length - newInvoices.length} already in Wrap` : ''}. Payments are matched to each invoice, so only <b>{unpaid.length} unpaid ({money(unpaid.reduce((t, i) => t + i.amountDue, 0))})</b> will show as owed. Due date = invoice date + <input className="input num" style={{ width: 52, height: 26, minHeight: 0, padding: '0 6px', display: 'inline-block', verticalAlign: 'middle' }} value={terms} onChange={(e) => setTerms(e.target.value)} aria-label="Payment terms in days" /> days.</>
              : <>No accounting file found.</>}
          </WaveRow>
          <WaveRow {...rowProps('expenses')} title={`3. Expenses${has.expenses ? ` (${w.expenses.length})` : ''}`}>
            {has.expenses ? <>Added as receipts without images, sorted into Schedule C categories.</> : <>None found.</>}
          </WaveRow>
          {unpaid.length > 0 && on('invoices') && (
            <div className="table-wrap" style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
              <table className="table"><tbody>
                {unpaid.map((r) => <tr key={r.number}><td>#{r.number}</td><td>{r.client}</td><td className="muted">{r.date}</td><td className="right num" style={{ color: 'var(--bad)' }}>{money(r.amountDue)} due</td></tr>)}
              </tbody></table>
            </div>
          )}
          {data.ignored.length > 0 && <p className="small muted" style={{ marginTop: 10 }}>Skipped (not needed): {data.ignored.join(', ')}</p>}
          <p className="small muted" style={{ marginTop: 10 }}>Wave’s export has no line descriptions like “Brand shoot (04/06)”, so lines come in as item + amount. To get them, import the invoice PDFs afterwards (Wave invoice PDFs button): Wrap adds their line details to the matching invoices instead of making duplicates.</p>
        </div>
      )}
    </Modal>
  );
}

/** Expense categories: rename any (tap the name), remove ones you never use, add your own. */
function Categories() {
  const s = useStore();
  const p = s.db.profile;
  const hidden = new Set(p.hidden_categories || []);
  const own = ownCategories(p);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);
  const save = (patch) => s.updateProfile(patch).catch((e) => s.toast(e.message, { error: true }));
  const pack = (list) => list.map((c) => (c.line && c.line !== '27a' ? { name: c.name, line: c.line } : c.name));
  const exists = (n) => [...CATEGORIES.filter((c) => !hidden.has(c.name)), ...own].some((c) => c.name.toLowerCase() === n.toLowerCase());
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const builtin = CATEGORIES.find((c) => c.name.toLowerCase() === n.toLowerCase());
    if (builtin) save({ hidden_categories: [...hidden].filter((h) => h !== builtin.name) });
    else if (!exists(n)) save({ custom_categories: pack([...own, { name: n, line: '27a' }]) });
    setName('');
  };
  // Renaming also moves every receipt in the old category over to the new name.
  const rename = async (from, to, isOwn) => {
    to = to.trim();
    setEditing(null);
    if (!to || to === from) return;
    if (exists(to)) { s.toast(`“${to}” already exists`, { error: true }); return; }
    const line = (isOwn ? own.find((c) => c.name === from)?.line : CATEGORIES.find((c) => c.name === from)?.line) || '27a';
    const nextOwn = isOwn ? own.map((c) => (c.name === from ? { ...c, name: to } : c)) : [...own, { name: to, line }];
    await save({ custom_categories: pack(nextOwn), ...(isOwn ? {} : { hidden_categories: [...hidden, from] }) });
    const moving = s.db.receipts.filter((r) => r.category === from);
    for (let i = 0; i < moving.length; i += 20) await Promise.all(moving.slice(i, i + 20).map((r) => s.update('receipts', r.id, { category: to })));
    s.toast(moving.length ? `Renamed · ${plural(moving.length, 'receipt')} moved` : 'Renamed');
  };
  const used = (n) => s.db.receipts.filter((r) => r.category === n).length;
  const Row = ({ n, off, isOwn, onToggle }) => (
    <div className={`cat-row ${off ? 'off' : ''}`}>
      {editing === n
        ? <input className="input" autoFocus defaultValue={n} aria-label={`Rename ${n}`} onBlur={(e) => rename(n, e.target.value, isOwn)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null); }} />
        : <button type="button" className="cat-name" disabled={off} onClick={() => setEditing(n)}>{n}<Icon name="edit" size={13} /></button>}
      <span className="small muted num">{used(n) || ''}</span>
      <Button size="sm" variant="ghost" icon={off ? 'plus' : 'x'} aria-label={off ? `Add ${n} back` : `Remove ${n}`} onClick={onToggle} />
    </div>
  );
  return (
    <section className="card card-pad col" style={{ gap: 12, maxWidth: 640 }}>
      <h2>Expense categories</h2>
      <form className="row" style={{ gap: 8, flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" aria-label="New category" />
        <Button type="submit" variant="primary" icon="plus" disabled={!name.trim()}>Add</Button>
      </form>
      <div className="col" style={{ gap: 0 }}>
        {own.map((c) => <Row key={c.name} n={c.name} isOwn onToggle={() => save({ custom_categories: pack(own.filter((o) => o.name !== c.name)) })} />)}
        {CATEGORIES.map((c) => <Row key={c.name} n={c.name} off={hidden.has(c.name)} onToggle={() => save({ hidden_categories: hidden.has(c.name) ? [...hidden].filter((h) => h !== c.name) : [...hidden, c.name] })} />)}
      </div>
    </section>
  );
}
