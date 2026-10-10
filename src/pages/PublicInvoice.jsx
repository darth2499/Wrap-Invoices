// What your client sees when they open the link (no sign-in).
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { Button, Icon, Spinner } from '../components/ui.jsx';
import { pdfFileName } from '../lib/format.js';
import { buildInvoiceZip, downloadBlob } from '../lib/files.js';
import { money, fmtLong, fmtShort, fmtTsDate, num } from '../lib/format.js';
import { useRoute } from '../router.js';
import { linkToken } from '../lib/publicFast.js';

export default function PublicInvoice({ token: rawToken }) {
  const token = linkToken(rawToken) || rawToken;
  const route = useRoute();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState('');

  const [tries, setTries] = useState(0);
  useEffect(() => {
    // A hiccup (the server waking up, a bad connection) is retried once by itself before showing anything.
    const get = (again) => api.publicCall('invoice', { token, preview: route.query.preview === '1' }).then(setData).catch((e) => {
      const missing = e.status === 404 || /not found/i.test(e.message || '');
      if (missing || again) setError(missing ? 'missing' : e.message || 'failed');
      else setTimeout(() => get(true), 1500);
    });
    setError('');
    get(false);
  }, [token, tries]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (data?.business?.business_name) document.title = `${data.kind === 'quote' ? 'Quote' : 'Invoice'} #${data.number} · ${data.business.business_name}`;
  }, [data]);

  if (error === 'missing') return <Center><h2>Link not found</h2><p className="muted">This link may be mistyped or no longer active. Ask the sender for a new one.</p></Center>;
  if (error) return <Center><h2>Couldn’t open this right now</h2><p className="muted">Check your connection and try again.</p><Button variant="primary" onClick={() => { setError(''); setData(null); setTries((n) => n + 1); }}>Try again</Button></Center>;
  if (!data) return <Center><Spinner label="Loading…" /></Center>;
  const biz = data.business || {};
  const label = data.kind === 'quote' ? 'Quote' : 'Invoice';
  if (data.state === 'paid') return <Center><span style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--good-bg)', color: 'var(--good)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={28} /></span><h2>{label} #{data.number} is paid in full</h2><p className="muted">Thank you! — {biz.business_name}</p></Center>;
  if (data.state === 'void') return <Center><h2>{label} #{data.number} is no longer active</h2><p className="muted">Contact {biz.business_name || 'the sender'} if you have questions.</p></Center>;

  const inv = data.invoice;
  const paid = data.payments.reduce((t, p) => t + num(p.amount), 0);
  const due = num(inv.total) - paid;
  const isQuote = inv.kind === 'quote';

  // Made on the server from the saved invoice, so nothing changed on this page (e.g. with "Inspect") can end up in the PDF.
  const pdf = () => api.publicPdf(token);
  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { alert(`Sorry, that didn’t work: ${e.message}`); }
    setBusy('');
  };

  return (
    <div style={{ minHeight: '100vh', padding: '32px 16px 64px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <header className="row wrap between" style={{ alignItems: 'flex-end', gap: 16 }}>
          <div className="col" style={{ gap: 4 }}>
            <span className="muted">{label} from {biz.business_name}</span>
            <span className="num" style={{ fontSize: 34, fontWeight: 500, letterSpacing: '-0.02em' }}>{money(isQuote ? inv.total : due)}</span>
            <span style={{ color: 'var(--ink-2)' }}>
              {isQuote ? (inv.due_date ? `Valid until ${fmtLong(inv.due_date)}` : '') : inv.due_date ? `Due ${fmtLong(inv.due_date)}` : ''} · {label} #{inv.number}
              {inv.version > 1 && <span className="muted"> · updated {fmtTsDate(inv.updated_at)}</span>}
            </span>
          </div>
          <div className="row wrap">
            <Button icon="download" busy={busy === 'pdf'} onClick={() => run('pdf', async () => downloadBlob(new Blob([await pdf()], { type: 'application/pdf' }), pdfFileName(inv)))}>Download PDF</Button>
            {data.receipts.some((r) => r.url) && <Button variant="primary" icon="zip" busy={busy === 'zip'} onClick={() => run('zip', async () => downloadBlob(await buildInvoiceZip(await pdf(), pdfFileName(inv), data.receipts, data.lines), pdfFileName(inv).replace(/\.pdf$/, '_with_receipts.zip')))}>Download all (.zip)</Button>}
          </div>
        </header>

        {isQuote && ['sent', 'draft'].includes(inv.status) && !accepted && (
          <section className="card card-pad row wrap" style={{ gap: 12 }}>
            <div className="grow col" style={{ gap: 2, minWidth: 220 }}><strong>Ready to go ahead?</strong><span className="small muted">Accepting lets {biz.business_name} know to book it.</span></div>
            <input className="input" style={{ width: 200 }} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
            <Button variant="primary" icon="check" busy={busy === 'acc'} onClick={() => run('acc', async () => { await api.publicCall('accept_quote', { token, name }); setAccepted(true); })}>Accept quote</Button>
          </section>
        )}
        {(accepted || inv.status === 'accepted') && isQuote && <div className="banner good"><Icon name="check" />Quote accepted — thank you!</div>}

        <InvoiceDoc business={biz} invoice={inv} client={data.client} lines={data.lines} payments={data.payments} logoUrl={biz.logo_url} />

        {data.receipts.length > 0 && (
          <section className="card card-pad col" style={{ gap: 12 }}>
            <div className="row between wrap"><h2>Receipts ({data.receipts.length})</h2><span className="small muted">Backup for the expenses on this {label.toLowerCase()}</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
              {data.receipts.map((r) => (
                <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="card" style={{ padding: 10, textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ height: 130, borderRadius: 8, background: 'var(--hover)', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
                    {r.mime === 'application/pdf' ? <span className="muted small">PDF</span> : r.url ? <img src={r.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} /> : null}
                  </span>
                  <span style={{ fontWeight: 500 }}>{r.vendor || 'Receipt'}</span>
                  <span className="small muted num">{money(r.total)} · {fmtShort(r.date)}</span>
                </a>
              ))}
            </div>
          </section>
        )}
        <p className="small muted" style={{ textAlign: 'center', lineHeight: 1.7 }}>
          Private link{isQuote ? '' : ' · active until this invoice is paid'}
          {inv.verify_code && <><br />Verification code <span className="num" style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{inv.verify_code}</span> · a genuine PDF of this version shows the same code at the bottom of each page</>}
        </p>
      </div>
    </div>
  );
}

export function Center({ children }) {
  return <div className="login"><div className="card card-pad col" style={{ maxWidth: 440, alignItems: 'center', textAlign: 'center', gap: 12, padding: 32 }}>{children}</div></div>;
}
