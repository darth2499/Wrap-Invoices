import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Field, Icon, Menu, Modal, MoneyInput, Pill, Switch, Empty } from '../components/ui.jsx';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { statusOf, dueText } from '../lib/calc.js';
import { money, fmtDate, fmtDateTime, fmtShort, fmtTsDate, num, todayISO, round2 } from '../lib/format.js';
import * as A from '../lib/actions.js';
import { go, shareUrl } from '../router.js';

const METHODS = ['Bank transfer', 'Zelle', 'Check', 'Venmo', 'PayPal', 'Cash', 'Card', 'Other'];

export default function InvoiceDetail({ id }) {
  const s = useStore();
  const { db, derived } = s;
  const inv = derived.invoices[id];
  const [logoUrl, setLogoUrl] = useState(null);
  const [receiptUrls, setReceiptUrls] = useState({});
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState('');

  const receipts = inv ? db.receipts.filter((r) => r.invoice_id === inv.id) : [];
  useEffect(() => {
    const keys = [db.profile.logo_key, ...receipts.map((r) => r.file_key)].filter(Boolean);
    if (!keys.length) return;
    s.api.files.urls(keys).then((u) => {
      setLogoUrl(db.profile.logo_key ? u[db.profile.logo_key] : null);
      setReceiptUrls(u);
    }).catch(() => {});
  }, [db.profile.logo_key, receipts.map((r) => r.file_key).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!inv) return <div className="page"><Empty title="Not found"><a href="#/invoices">Back to invoices</a></Empty></div>;
  const isQuote = inv.kind === 'quote';
  const label = isQuote ? 'Quote' : 'Invoice';
  const client = derived.clients[inv.client_id];
  const lines = derived.linesFor(inv.id);
  const payments = db.payments.filter((p) => p.invoice_id === inv.id).sort((a, b) => (a.paid_on < b.paid_on ? -1 : 1));
  const paid = derived.paidFor(inv.id);
  const due = round2(num(inv.total) - paid);
  const st = statusOf(inv, paid);
  const events = db.invoice_events.filter((e) => e.invoice_id === inv.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const revisions = db.invoice_revisions.filter((r) => r.invoice_id === inv.id).sort((a, b) => b.version - a.version);
  const canRemind = !isQuote && inv.status === 'sent';

  const run = async (key, fn, ok) => {
    setBusy(key);
    try {
      await fn();
      if (ok) s.toast(ok);
    } catch (e) {
      s.toast(e.message, { error: true });
    } finally {
      setBusy('');
    }
  };

  const more = [
    { label: 'Duplicate', icon: 'copy', onClick: () => go(`/invoices/new?from=${inv.id}`) },
    inv.status === 'draft' && { label: 'Mark as sent', icon: 'check', onClick: () => run('sent', () => A.markSent(s, inv), 'Marked as sent') },
    isQuote && ['sent', 'draft'].includes(inv.status) && { label: 'Mark accepted', icon: 'check', onClick: () => run('acc', () => s.update('invoices', inv.id, { status: 'accepted' }), 'Marked accepted') },
    isQuote && ['sent', 'draft', 'accepted'].includes(inv.status) && { label: 'Mark declined', icon: 'x', onClick: () => run('dec', () => s.update('invoices', inv.id, { status: 'declined' }), 'Marked declined') },
    { label: 'Open client view', icon: 'eye', onClick: () => window.open(shareUrl(inv.share_token) + '?preview=1', '_blank') },
    inv.status === 'void' && { label: 'Undo void', icon: 'history', onClick: () => run('unvoid', () => A.unvoidInvoice(s, inv), 'Restored') },
    inv.status !== 'void' && inv.status !== 'draft' && !isQuote && {
      label: 'Void invoice', icon: 'x', danger: true,
      onClick: async () => (await s.confirm({ title: `Void invoice #${inv.number}?`, body: 'It stays in your records (numbers stay in order) but no longer counts as owed. The client link will say it’s no longer active.', ok: 'Void', danger: true })) && run('void', () => A.voidInvoice(s, inv), 'Voided'),
    },
    (inv.status === 'draft' || isQuote) && {
      label: `Delete ${label.toLowerCase()}`, icon: 'trash', danger: true,
      onClick: async () => { if (await s.confirm({ title: `Delete #${inv.number}?`, body: 'This can’t be undone. Attached receipts are kept.', ok: 'Delete', danger: true })) { await A.deleteInvoice(s, inv); go(isQuote ? '/quotes' : '/invoices'); } },
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div className="col" style={{ gap: 6 }}>
          <a href={isQuote ? '#/quotes' : '#/invoices'} className="small">← All {isQuote ? 'quotes' : 'invoices'}</a>
          <div className="row wrap" style={{ gap: 12 }}>
            <h1>{label} #{inv.number}</h1>
            <Pill kind={st.key}>{st.label}{st.key === 'overdue' ? ` · ${st.days} days` : ''}</Pill>
            {inv.version > 1 && <span className="pill draft">Version {inv.version}</span>}
          </div>
          <span className="muted">{client?.name || 'No client'} · {money(inv.total)}{!isQuote && inv.status === 'sent' ? ` · ${dueText(inv)}` : ''}</span>
        </div>
        <div className="row wrap">
          {inv.status !== 'void' && inv.status !== 'converted' && <Button icon="edit" onClick={() => go(`/invoices/${inv.id}/edit`)}>Edit</Button>}
          {isQuote && ['accepted', 'sent', 'draft'].includes(inv.status) && <Button variant="primary" icon="convert" busy={busy === 'conv'} onClick={() => run('conv', async () => { const nid = await A.convertQuote(s, inv); go(`/invoices/${nid}`); }, 'Invoice created from quote')}>Turn into invoice</Button>}
          {isQuote && inv.converted_invoice_id && <Button onClick={() => go(`/invoices/${inv.converted_invoice_id}`)}>Open invoice</Button>}
          {!isQuote && inv.status !== 'void' && inv.status !== 'paid' && <Button variant="primary" icon="cash" onClick={() => setModal({ type: 'pay' })}>Record payment</Button>}
          <Menu label="More" items={more} />
        </div>
      </div>

      {inv.status === 'void' && <div className="banner warn">This invoice is void. It isn’t counted as owed, and the client link shows it as no longer active.</div>}
      {inv.quote_id && <div className="banner info">Created from quote #{derived.invoices[inv.quote_id]?.number} — <a href={`#/invoices/${inv.quote_id}`}>open quote</a></div>}

      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: '2 1 520px', minWidth: 0 }} className="doc-col">
          <InvoiceDoc business={db.profile} invoice={inv} client={client} lines={lines} payments={payments} logoUrl={logoUrl} />
        </div>

        <div className="col" style={{ gap: 16, minWidth: 0, flex: '1 1 320px' }}>
          <section className="card card-pad col" style={{ gap: 10 }}>
            <h2>Share &amp; download</h2>
            {inv.status !== 'void' && (
              <>
                <Button variant="primary" icon="link" busy={busy === 'link'} onClick={() => run('link', () => A.copyLink(s, inv))}>Copy client link</Button>
                <span className="small muted" style={{ textAlign: 'center' }}>{isQuote ? 'Your client can view and accept the quote' : 'Link stays active until this invoice is paid'}{inv.view_count ? ` · viewed ${inv.view_count}×` : ''}</span>
                <Button icon="mail" onClick={() => setModal({ type: 'email', reminder: false })}>Email from Gmail</Button>
              </>
            )}
            <Button icon="download" busy={busy === 'pdf'} onClick={() => run('pdf', () => A.downloadPdf(s, inv))}>Download PDF</Button>
            {receipts.length > 0 && <Button icon="zip" busy={busy === 'zip'} onClick={() => run('zip', () => A.downloadZip(s, inv))}>PDF + {receipts.length} receipt{receipts.length === 1 ? '' : 's'} (.zip)</Button>}
            {canRemind && <Button icon="bell" onClick={() => setModal({ type: 'email', reminder: true })}>Send reminder</Button>}
            {!isQuote && inv.status !== 'void' && inv.status !== 'paid' && (
              <label className="row between" style={{ paddingTop: 6, borderTop: '1px solid var(--line-2)' }}>
                <span className="col" style={{ gap: 0 }}><span>Automatic reminders</span><span className="small muted">{(db.profile.reminder_days || []).join(', ')} days after due{inv.reminders_sent ? ` · ${inv.reminders_sent} sent` : ''}</span></span>
                <Switch checked={inv.auto_remind} label="Automatic reminders" onChange={(v) => run('ar', () => s.update('invoices', inv.id, { auto_remind: v }), v ? 'Automatic reminders on' : 'Automatic reminders off')} />
              </label>
            )}
          </section>

          {!isQuote && (
            <section className="card">
              <div className="card-head"><h2>Payments</h2><span className="num small muted">{money(paid)} of {money(inv.total)}</span></div>
              {payments.length === 0 && <p className="small muted" style={{ padding: '0 20px 16px' }}>No payments yet.</p>}
              {payments.map((p) => (
                <div key={p.id} className="list-row" style={{ gridTemplateColumns: '1fr auto auto', cursor: 'default' }}>
                  <span className="col" style={{ gap: 0 }}><span>{fmtDate(p.paid_on)}</span><span className="small muted">{p.method || 'Payment'}{p.note ? ` · ${p.note}` : ''}</span></span>
                  <span className="num">{money(p.amount)}</span>
                  <Menu label="" icon="more" variant="ghost icon" items={[{ label: 'Edit', icon: 'edit', onClick: () => setModal({ type: 'pay', payment: p }) }, { label: 'Delete payment', icon: 'trash', danger: true, onClick: async () => (await s.confirm({ title: 'Delete this payment?', body: `${money(p.amount)} on ${fmtDate(p.paid_on)}`, ok: 'Delete', danger: true })) && run('dp', () => A.deletePayment(s, p), 'Payment deleted') }]} />
                </div>
              ))}
              {inv.status !== 'paid' && inv.status !== 'void' && due > 0 && <div className="list-row" style={{ gridTemplateColumns: '1fr auto', cursor: 'default' }}><strong>Still due</strong><strong className="num">{money(due)}</strong></div>}
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <h2>Receipts</h2>
              <Button size="sm" icon="plus" onClick={() => setModal({ type: 'attach' })}>Attach</Button>
            </div>
            <p className="small muted" style={{ padding: '0 20px 10px' }}>Turn on “Bill” to add a receipt to the total. Off = backup only. All go in the zip.</p>
            {receipts.length === 0 && <p className="small muted" style={{ padding: '0 20px 16px' }}>None attached.</p>}
            {receipts.map((r) => (
              <div key={r.id} className="list-row" style={{ gridTemplateColumns: '40px 1fr auto auto', cursor: 'default' }}>
                <a href={receiptUrls[r.file_key]} target="_blank" rel="noreferrer" className="thumb" aria-label={`Open ${r.vendor || 'receipt'}`}>
                  {receiptUrls[r.file_key] && r.mime !== 'application/pdf' ? <img src={receiptUrls[r.file_key]} alt="" className="thumb" style={{ border: 0 }} /> : r.mime === 'application/pdf' ? 'PDF' : '—'}
                </a>
                <span className="col" style={{ gap: 0, minWidth: 0 }}><b style={{ fontWeight: 500 }}>{r.vendor || 'Receipt'}</b><span className="small muted num">{money(r.total)} · {fmtShort(r.receipt_date)}</span></span>
                <label className="row small muted" style={{ gap: 6 }}>Bill<Switch checked={r.billable} label={`Bill client for ${r.vendor}`} onChange={(v) => run('bill', () => A.setBillable(s, inv, r, v), v ? 'Added to the invoice' : 'Removed from the total')} /></label>
                <Menu label="" icon="more" variant="ghost icon" items={[{ label: 'Detach from invoice', icon: 'x', onClick: () => run('det', () => A.detachReceipt(s, inv, r), 'Detached') }]} />
              </div>
            ))}
          </section>

          <section className="card card-pad col" style={{ gap: 10 }}>
            <h2>History</h2>
            {events.length === 0 && <span className="small muted">Nothing yet.</span>}
            {events.slice(0, 30).map((e) => (
              <div key={e.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <span style={{ width: 8, height: 8, marginTop: 6, borderRadius: '50%', background: e.type === 'payment' ? 'var(--good)' : e.type === 'viewed' ? 'var(--accent)' : '#9a9ba1', flex: 'none' }} />
                <span className="col" style={{ gap: 0 }}>
                  <span>{eventText(e, label)}</span>
                  <span className="small muted">{fmtDateTime(e.created_at)}</span>
                </span>
              </div>
            ))}
            {revisions.length > 0 && (
              <div className="col" style={{ gap: 6, borderTop: '1px solid var(--line-2)', paddingTop: 10 }}>
                <span className="small muted">Earlier versions (what the client saw before each change)</span>
                {revisions.map((r) => (
                  <button key={r.id} className="btn sm" style={{ justifyContent: 'space-between' }} onClick={() => setModal({ type: 'rev', rev: r })}>
                    <span>Version {r.version}{r.summary ? ` — ${r.summary}` : ''}</span><span className="muted small">{fmtTsDate(r.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {modal?.type === 'pay' && <PaymentModal inv={inv} due={due} payment={modal.payment} onClose={() => setModal(null)} />}
      {modal?.type === 'email' && <EmailModal inv={inv} client={client} reminder={modal.reminder} due={due} onClose={() => setModal(null)} />}
      {modal?.type === 'attach' && <AttachModal inv={inv} onClose={() => setModal(null)} />}
      {modal?.type === 'rev' && (
        <Modal wide title={`Version ${modal.rev.version}${modal.rev.summary ? ` — before: ${modal.rev.summary}` : ''}`} onClose={() => setModal(null)}>
          <InvoiceDoc business={db.profile} invoice={modal.rev.snapshot.invoice} client={client} lines={modal.rev.snapshot.lines} payments={[]} logoUrl={logoUrl} />
        </Modal>
      )}
    </div>
  );
}

function eventText(e, label) {
  const t = {
    created: `${label} created`, sent: e.detail || 'Sent', viewed: 'Client opened the link', reminder: e.detail || 'Reminder sent',
    payment: `Payment: ${e.detail || ''}`, edited: e.detail || 'Edited', voided: 'Voided', accepted: e.detail || 'Quote accepted', converted: e.detail || 'Converted to invoice',
  }[e.type];
  return t || e.detail || e.type;
}

function PaymentModal({ inv, due, payment, onClose }) {
  const s = useStore();
  const [amount, setAmount] = useState(payment ? num(payment.amount) : due);
  const [date, setDate] = useState(payment?.paid_on || todayISO());
  const [method, setMethod] = useState(payment?.method || 'Bank transfer');
  const [note, setNote] = useState(payment?.note || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!amount) return;
    setBusy(true);
    try {
      if (payment) {
        await s.update('payments', payment.id, { amount: round2(amount), paid_on: date, method, note: note || null });
        await s.reload('invoices', 'payments');
      } else await A.recordPayment(s, inv, { amount, paid_on: date, method, note });
      s.toast(round2(amount) >= due && !payment ? `Paid in full — #${inv.number} marked paid` : 'Payment saved');
      onClose();
    } catch (e) {
      s.toast(e.message, { error: true });
      setBusy(false);
    }
  };
  return (
    <Modal title={payment ? 'Edit payment' : `Record payment · #${inv.number}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save payment</Button></>}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Amount"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Date received"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Method"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      {!payment && <div className="row wrap"><Button size="sm" onClick={() => setAmount(due)}>Full amount {money(due)}</Button>{inv.deposit_percent ? <Button size="sm" onClick={() => setAmount(round2((num(inv.total) * inv.deposit_percent) / 100))}>Deposit {inv.deposit_percent}%</Button> : null}</div>}
    </Modal>
  );
}

function EmailModal({ inv, client, reminder, due, onClose }) {
  const s = useStore();
  const p = s.db.profile;
  const isQuote = inv.kind === 'quote';
  const first = (client?.name || '').split(' ')[0] || 'there';
  const biz = p.business_name || 'me';
  const [to, setTo] = useState(client?.email || '');
  const [cc, setCc] = useState(client?.cc_emails || '');
  const [subject, setSubject] = useState(reminder ? `Reminder: invoice #${inv.number} from ${biz}` : `${isQuote ? 'Quote' : 'Invoice'} #${inv.number} from ${biz}`);
  const [message, setMessage] = useState(
    reminder
      ? `Hi ${first},\n\nJust a friendly reminder that invoice #${inv.number} for ${money(due)} is ${inv.due_date && inv.due_date < todayISO() ? 'now past due' : `due ${fmtDate(inv.due_date)}`}. You can view it and download the PDF and receipts below.\n\nThank you!\n${biz}`
      : `Hi ${first},\n\nHere's ${isQuote ? 'the quote' : `invoice #${inv.number}`}${inv.notes ? ` (${inv.notes})` : ''}. You can view it and download the PDF${isQuote ? '' : ' and receipts'} below.\n\nThank you!\n${biz}`,
  );
  const [busy, setBusy] = useState(false);
  if (!p.gmail_email) {
    return (
      <Modal title="Connect Gmail first" onClose={onClose} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" onClick={() => s.api.auth.connectGmail()}>Connect Gmail</Button></>}>
        <p style={{ lineHeight: 1.6 }}>Emails go out from your own Gmail so replies land in your inbox. Google will ask you to allow “Send email on your behalf” — Wrap can only send, never read your mail.</p>
        <p className="small muted">Or just copy the client link and paste it into any email.</p>
      </Modal>
    );
  }
  const send = async () => {
    setBusy(true);
    try {
      await s.api.gmail('send', { invoice_id: inv.id, type: reminder ? 'reminder' : 'invoice', to, cc, subject, message });
      await s.reload('invoices', 'invoice_events');
      s.toast(reminder ? 'Reminder sent' : 'Email sent');
      onClose();
    } catch (e) {
      s.toast(e.message, { error: true });
      setBusy(false);
    }
  };
  return (
    <Modal title={reminder ? 'Send a reminder' : `Email ${isQuote ? 'quote' : 'invoice'}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="mail" busy={busy} disabled={!to} onClick={send}>Send from {p.gmail_email}</Button></>}>
      <Field label="To"><input className="input" type="email" multiple value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" /></Field>
      <Field label="Cc" hint="(optional)"><input className="input" value={cc} onChange={(e) => setCc(e.target.value)} /></Field>
      <Field label="Subject"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Message"><textarea className="input" rows={7} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      <p className="small muted">A “View {isQuote ? 'quote' : 'invoice'}” button with your private link is added below the message.</p>
    </Modal>
  );
}

function AttachModal({ inv, onClose }) {
  const s = useStore();
  const [sel, setSel] = useState(new Set());
  const [q, setQ] = useState('');
  const list = s.db.receipts.filter((r) => r.invoice_id !== inv.id).filter((r) => !q || `${r.vendor} ${r.total} ${r.category}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => String(b.receipt_date).localeCompare(String(a.receipt_date)));
  const go2 = async (bill) => {
    const picked = s.db.receipts.filter((x) => sel.has(x.id));
    try {
      if (bill) await A.setBillableMany(s, inv, picked, true);
      else for (const r of picked) await s.update('receipts', r.id, { invoice_id: inv.id, billable: false });
      s.toast(`${sel.size} attached${bill ? ' and billed' : ''}`);
      onClose();
    } catch (e) {
      s.toast(e.message, { error: true });
    }
  };
  return (
    <Modal title={`Attach receipts to #${inv.number}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button disabled={!sel.size} onClick={() => go2(false)}>Attach as backup</Button><Button variant="primary" disabled={!sel.size} onClick={() => go2(true)}>Attach &amp; bill client</Button></>}>
      <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="col" style={{ gap: 0, maxHeight: 380, overflowY: 'auto' }}>
        {list.length === 0 && <Empty icon="receipt" title="No other receipts">Add some in Expenses.</Empty>}
        {list.map((r) => (
          <label key={r.id} className="check" style={{ borderTop: '1px solid var(--line-2)' }}>
            <input type="checkbox" checked={sel.has(r.id)} onChange={() => setSel((x) => { const n = new Set(x); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} />
            <span className="grow col" style={{ gap: 0 }}><b style={{ fontWeight: 500, color: 'var(--ink)' }}>{r.vendor || 'Receipt'}</b><span className="small muted">{fmtShort(r.receipt_date)}{r.invoice_id ? ` · now on #${s.derived.invoices[r.invoice_id]?.number}` : ''}</span></span>
            <span className="num">{money(r.total)}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}
