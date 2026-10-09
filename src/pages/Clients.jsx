import { useState } from 'react';
import { useStore } from '../store.jsx';
import { DEMO } from '../config.js';
import AddressInput from '../components/AddressInput.jsx';
import { Button, Empty, Field, Icon, Menu, Modal, Pill } from '../components/ui.jsx';
import { statusOf } from '../lib/calc.js';
import { money, fmtDate, num, todayISO, plural, greetName } from '../lib/format.js';
import { go, shareUrl } from '../router.js';
import EmailPreview from '../components/EmailPreview.jsx';
import { buildStatementEmail } from '../lib/emailTemplate.js';

export default function Clients({ id }) {
  return id ? <ClientDetail id={id} /> : <ClientList />;
}

function useClientStats() {
  const { db, derived } = useStore();
  const year = todayISO().slice(0, 4);
  return (c) => {
    const invs = db.invoices.filter((i) => i.client_id === c.id && i.kind === 'invoice');
    const open = invs.filter((i) => i.status === 'sent');
    const owed = open.reduce((t, i) => t + num(i.total) - derived.paidFor(i.id), 0);
    const ids = new Set(invs.map((i) => i.id));
    const paidYear = db.payments.filter((p) => ids.has(p.invoice_id) && p.paid_on?.startsWith(year)).reduce((t, p) => t + num(p.amount), 0);
    const billed = invs.filter((i) => !['void', 'draft'].includes(i.status)).reduce((t, i) => t + num(i.total), 0);
    return { invs, open, owed, paidYear, billed };
  };
}

function ClientList() {
  const { db } = useStore();
  const stats = useClientStats();
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const list = db.clients
    .filter((c) => showArchived || !c.archived)
    .filter((c) => !q || `${c.name} ${c.email}`.toLowerCase().includes(q.toLowerCase()))
    .map((c) => ({ c, ...stats(c) }))
    .sort((a, b) => b.owed - a.owed || a.c.name.localeCompare(b.c.name));
  return (
    <div className="page">
      <div className="page-head">
        <h1>Clients</h1>
        <div className="row wrap">
          <input className="input search" style={{ width: 220 }} placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
          <Button variant="primary" icon="plus" onClick={() => setEdit({})}>New client</Button>
        </div>
      </div>
      {list.length === 0 ? (
        <div className="card"><Empty icon="clients" title="No clients yet"><Button variant="primary" onClick={() => setEdit({})}>Add your first client</Button></Empty></div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {list.map(({ c, owed, invs, paidYear }) => (
            <button key={c.id} className="card card-pad col" style={{ gap: 8, textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', opacity: c.archived ? 0.6 : 1 }} onClick={() => go(`/clients/${c.id}`)}>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <span className="col" style={{ gap: 0, minWidth: 0 }}><strong style={{ fontSize: 15 }}>{c.name}</strong><span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email || 'No email yet'}</span></span>
                {c.archived ? <Pill kind="void">Archived</Pill> : owed > 0 ? <Pill kind="sent">{money(owed, { cents: false })} owed</Pill> : null}
              </div>
              <span className="small muted">{plural(invs.length, 'invoice')} · {money(paidYear, { cents: false })} paid this year</span>
            </button>
          ))}
        </div>
      )}
      {db.clients.some((c) => c.archived) && <button className="btn link small" onClick={() => setShowArchived((x) => !x)}>{showArchived ? 'Hide' : 'Show'} archived clients</button>}
      {edit && <ClientModal client={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ClientDetail({ id }) {
  const s = useStore();
  const { db, derived } = s;
  const c = derived.clients[id];
  const stats = useClientStats();
  const [edit, setEdit] = useState(false);
  const [mail, setMail] = useState(false);
  const [newProject, setNewProject] = useState('');
  const [showDone, setShowDone] = useState(false); // paid & closed invoices stay folded away
  if (!c) return <div className="page"><Empty title="Client not found"><a href="#/clients">Back to clients</a></Empty></div>;
  const st = stats(c);
  const projects = db.projects.filter((p) => p.client_id === c.id);
  const all = db.invoices.filter((i) => i.client_id === c.id).sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)));
  const isDone = (i) => ['paid', 'void', 'converted', 'declined'].includes(i.status);
  const open = all.filter((i) => !isDone(i));
  const done = all.filter(isDone);
  const copyStatement = async () => {
    const url = shareUrl(c.statement_token, 's');
    try { await navigator.clipboard.writeText(url); s.toast('Statement link copied'); } catch { window.prompt('Copy this link:', url); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div className="col" style={{ gap: 6 }}>
          <a href="#/clients" className="small">← All clients</a>
          <h1>{c.name}</h1>
          <span className="muted">{[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details yet'}</span>
        </div>
        <div className="row wrap">
          <Button icon="edit" onClick={() => setEdit(true)}>Edit</Button>
          <Menu label="Statement" icon="file" items={[
            { label: 'Copy statement link', icon: 'link', onClick: copyStatement },
            { label: 'Email statement', icon: 'mail', onClick: () => setMail(true) },
            { label: 'Open statement', icon: 'eye', onClick: () => window.open(shareUrl(c.statement_token, 's'), '_blank') },
          ]} />
          <Button variant="primary" icon="plus" onClick={() => go(`/invoices/new?client=${c.id}`)}>New invoice</Button>
        </div>
      </div>

      <div className="grid">
        <div className="card kpi"><span className="muted">Owes you</span><span className="v">{money(st.owed)}</span><span className="small muted">{plural(st.open.length, 'open invoice')}</span></div>
        <div className="card kpi"><span className="muted">Paid this year</span><span className="v">{money(st.paidYear, { cents: false })}</span><span className="small muted">{c.expects_1099 ? 'Should send you a 1099' : 'Not marked for a 1099'}</span></div>
        <div className="card kpi"><span className="muted">Billed all time</span><span className="v">{money(st.billed, { cents: false })}</span><span className="small muted">{plural(st.invs.length, 'invoice')}</span></div>
      </div>

      <div className="grid-2">
        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-head"><h2>Invoices &amp; quotes</h2></div>
          {all.length === 0 && <Empty icon="invoice" title="Nothing yet" />}
          {all.length > 0 && open.length === 0 && !showDone && <p className="small muted" style={{ padding: '0 20px 14px' }}>Everything’s paid up.</p>}
          {all.length > 0 && (
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 560 }}>
                <tbody>
                  {(showDone ? all : open).map((i) => {
                    const paid = derived.paidFor(i.id);
                    const stt = statusOf(i, paid);
                    return (
                      <tr key={i.id} className="click" onClick={() => go(`/invoices/${i.id}`)}>
                        <td><Pill kind={stt.key}>{stt.label}</Pill></td>
                        <td>{i.kind === 'quote' ? 'Quote' : 'Invoice'} #{i.number}<div className="small muted">{derived.projects[i.project_id]?.name || i.notes || ''}</div></td>
                        <td className="muted">{fmtDate(i.issue_date)}</td>
                        <td className="right num">{money(i.status === 'sent' && i.kind === 'invoice' ? num(i.total) - paid : i.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {done.length > 0 && (
            <button type="button" className="feed-more" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
              <Icon name="chevD" size={16} style={{ transform: showDone ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              {showDone ? 'Hide paid & closed' : `${done.length} paid & closed`}
            </button>
          )}
        </section>
        <section className="card card-pad col" style={{ gap: 10 }}>
          <h2>Projects</h2>
          {projects.length === 0 && <span className="small muted">Group invoices for a bigger job under a project.</span>}
          {projects.map((p) => (
            <div key={p.id} className="row between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
              <span style={{ opacity: p.archived ? 0.5 : 1 }}>{p.name}</span>
              <span className="row small muted">{plural(db.invoices.filter((i) => i.project_id === p.id).length, 'invoice')}
                <Button size="sm" variant="ghost" onClick={() => s.update('projects', p.id, { archived: !p.archived })}>{p.archived ? 'Unarchive' : 'Archive'}</Button>
              </span>
            </div>
          ))}
          <form className="row" onSubmit={async (e) => { e.preventDefault(); if (newProject.trim()) { await s.insert('projects', { name: newProject.trim(), client_id: c.id }); setNewProject(''); } }}>
            <input className="input" placeholder="New project name" value={newProject} onChange={(e) => setNewProject(e.target.value)} />
            <Button type="submit" disabled={!newProject.trim()}>Add</Button>
          </form>
        </section>
        <section className="card card-pad col" style={{ gap: 8 }}>
          <h2>Details</h2>
          {(c.contact_first || c.contact_last) && <Detail label="Contact" value={[c.contact_first, c.contact_last].filter(Boolean).join(' ')} />}
          <Detail label="Address" value={c.address} />
          <Detail label="CC on emails" value={c.cc_emails} />
          <Detail label="Overtime" value={c.ot_base_hours ? `After ${c.ot_base_hours} hours (instead of your default ${db.profile.ot_base_hours})` : `Your default (after ${db.profile.ot_base_hours} hours)`} />
          <Detail label="Notes" value={c.notes} />
          <div className="small muted" style={{ paddingTop: 6 }}>Statement link: shows {c.name} everything they still owe, with links to each invoice.</div>
        </section>
      </div>
      {edit && <ClientModal client={c} onClose={() => setEdit(false)} />}
      {mail && <StatementEmail client={c} owed={st.owed} onClose={() => setMail(false)} />}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
      <span className="small muted">{label}</span>
      <span style={{ whiteSpace: 'pre-line' }}>{value || <span className="muted">—</span>}</span>
    </div>
  );
}

export function ClientModal({ client, onClose, onSaved, stay = false }) {
  const s = useStore();
  const isNew = !client.id;
  const [f, setF] = useState({ name: client.name || '', contact_first: client.contact_first || '', contact_last: client.contact_last || '', email: client.email || '', cc_emails: client.cc_emails || '', phone: client.phone || '', address: client.address || '', notes: client.notes || '', ot_base_hours: client.ot_base_hours ?? '', expects_1099: !!client.expects_1099, archived: !!client.archived });
  const [err, setErr] = useState('');
  const save = async () => {
    if (!f.name.trim()) return setErr('Add a name');
    const row = { ...f, name: f.name.trim(), contact_first: f.contact_first.trim() || null, contact_last: f.contact_last.trim() || null, ot_base_hours: f.ot_base_hours === '' ? null : num(f.ot_base_hours), email: f.email || null, cc_emails: f.cc_emails || null };
    for (const k of ['contact_first', 'contact_last']) if (!row[k] && client[k] === undefined) delete row[k]; // before 012 is run
    const saved = isNew ? await s.insert('clients', row) : await s.update('clients', client.id, row);
    onSaved?.(saved);
    onClose();
    if (isNew && !stay) go(`/clients/${saved.id}`);
  };
  const del = async () => {
    if (!(await s.confirm({ title: `Delete ${client.name}?`, body: 'Only possible if they have no invoices. Otherwise archive them — they’ll be hidden but your records stay intact.', ok: 'Delete', danger: true }))) return;
    try {
      await s.remove('clients', client.id);
      onClose();
      go('/clients');
    } catch {
      s.toast('This client has invoices — archive instead', { error: true });
    }
  };
  return (
    <Modal title={isNew ? 'New client' : `Edit ${client.name}`} onClose={onClose} footer={<>{!isNew && <Button variant="ghost" className="danger" icon="trash" style={{ marginRight: 'auto' }} onClick={del}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      {err && <div className="banner bad">{err}</div>}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Field label="Company" hint="(or their name, if it's a person)"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Contact first name" hint="(emails say “Hi …”)"><input className="input" value={f.contact_first} onChange={(e) => setF({ ...f, contact_first: e.target.value })} autoComplete="off" /></Field>
        <Field label="Contact last name"><input className="input" value={f.contact_last} onChange={(e) => setF({ ...f, contact_last: e.target.value })} autoComplete="off" /></Field>
        <Field label="Billing email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="CC emails" hint="(comma-separated)"><input className="input" value={f.cc_emails} onChange={(e) => setF({ ...f, cc_emails: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      </div>
      <Field label="Address"><AddressInput multiline value={f.address} onChange={(v) => setF({ ...f, address: v })} /></Field>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Field label="Overtime starts after" hint="(hours, blank = your default)"><input className="input num" inputMode="decimal" value={f.ot_base_hours} onChange={(e) => setF({ ...f, ot_base_hours: e.target.value })} placeholder={String(s.db.profile.ot_base_hours)} /></Field>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.expects_1099} onChange={(e) => setF({ ...f, expects_1099: e.target.checked })} />They’ll send me a 1099</label>
      </div>
      <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      {!isNew && <label className="check"><input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />Archived (hide from lists)</label>}
    </Modal>
  );
}

function StatementEmail({ client, owed, onClose }) {
  const s = useStore();
  const p = s.db.profile;
  const first = greetName(client);
  const [to, setTo] = useState(client.email || '');
  const [subject, setSubject] = useState(`Statement from ${p.business_name || 'me'}`);
  const [message, setMessage] = useState(`Hi ${first},\n\nHere’s a statement of the open invoices — ${money(owed)} in total. Each invoice${s.db.receipts.some((r) => r.file_key && s.db.invoices.some((i) => i.id === r.invoice_id && i.client_id === client.id && i.status === 'sent')) ? ' and its receipts' : ''} can be opened from the link.\n\nThank you!\n${p.business_name || ''}`);
  const [busy, setBusy] = useState(false);
  const open = s.db.invoices
    .filter((i) => i.client_id === client.id && i.kind === 'invoice' && i.status === 'sent')
    .sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date)))
    .map((i) => ({ number: i.number, issueDate: i.issue_date, dueDate: i.due_date, due: num(i.total) - s.derived.paidFor(i.id) }))
    .filter((i) => i.due > 0.009);
  const preview = buildStatementEmail({
    link: shareUrl(client.statement_token, 's'), clientName: client.name, message, accent: p.accent, invoices: open,
    business: { name: p.business_name || p.gmail_email, email: p.business_email, phone: p.phone, website: p.website },
  }).html;
  if (!p.gmail_email && !DEMO) return <Modal title="Connect Gmail first" onClose={onClose} footer={<Button variant="primary" onClick={() => s.api.auth.connectGmail()}>Connect Gmail</Button>}><p>Or copy the statement link and send it yourself.</p></Modal>;
  return (
    <Modal wide title="Email statement" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="mail" busy={busy} disabled={!to} onClick={async () => { setBusy(true); try { await s.api.gmail('send', { type: 'statement', client_id: client.id, to, cc: client.cc_emails, subject, message }); s.toast('Statement sent'); onClose(); } catch (e) { s.toast(e.message, { error: true }); setBusy(false); } }}>Send</Button></>}>
      <div className="email-compose">
        <div className="col" style={{ gap: 12 }}>
          <Field label="To"><input className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Subject"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Message"><textarea className="input" rows={8} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        </div>
        <EmailPreview html={preview} label="What your client sees" />
      </div>
    </Modal>
  );
}

