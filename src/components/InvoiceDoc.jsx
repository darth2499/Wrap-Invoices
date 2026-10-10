// The invoice as the client sees it (screen version). The PDF is drawn to match in lib/pdf.js.
import { useState } from 'react';
import { money, fmtLong, num, payMethod } from '../lib/format.js';
import { depositAmount } from '../lib/calc.js';
import { presetLogoUrl } from '../lib/logos.js';

export default function InvoiceDoc({ business = {}, invoice, client, lines, payments = [], logoUrl: uploaded }) {
  const template = business.template || 'minimal';
  const accent = business.accent || '#16161A';
  // A ready-made logo (if picked) wins over an uploaded one; "bar" and "stacked" already spell out your name.
  const logoUrl = business.logo_preset ? presetLogoUrl(business.logo_preset, business.business_name, accent) : uploaded;
  const nameInLogo = ['bar', 'stack'].includes(business.logo_preset);
  const isQuote = invoice.kind === 'quote';
  const paid = payments.reduce((s, p) => s + num(p.amount), 0);
  const due = num(invoice.total) - paid;
  const deposit = depositAmount(invoice);
  const headStyle =
    template === 'classic' ? { background: '#16161A', color: '#fff' }
      : template === 'bold' ? { background: accent, color: '#fff' }
        : { borderBottom: '1.5px solid #16161A', color: '#5f6168' };
  const hasTax = lines.some((l) => num(l.tax_rate) > 0);
  // Price only adds anything when some quantity isn't 1 (2 days at $750); otherwise it just repeats the amount.
  const showPrice = lines.some((l) => num(l.qty) !== 1);
  if (template === 'bold') return <BoldDoc {...{ business, invoice, client, lines, payments, logoUrl, accent, isQuote, paid, due, deposit, hasTax, showPrice }} />;

  return (
    <article className="doc" style={template === 'bold' ? { paddingTop: 0, overflow: 'hidden' } : null}>
      {template === 'bold' && <div style={{ height: 10, background: accent, margin: '0 calc(-1 * clamp(20px, 5vw, 44px))' }} />}
      <header className="doc-head" style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div className="col" style={{ gap: 8, minWidth: 0 }}>
          {logoUrl ? <img src={logoUrl} alt="" style={{ maxWidth: 180, maxHeight: 80, objectFit: 'contain', objectPosition: 'left' }} /> : null}
          {(!logoUrl || (business.logo_mode === 'both' && !nameInLogo)) && <strong style={{ fontSize: logoUrl ? 16 : 20, letterSpacing: '.03em' }}>{(business.business_name || '').toUpperCase()}</strong>}
        </div>
        <div className="doc-from" style={{ textAlign: 'right', fontSize: 13, color: '#45464d', lineHeight: 1.55 }}>
          <div style={{ fontSize: 26, fontWeight: 600, color: template === 'bold' ? accent : '#16161a', letterSpacing: '.02em' }}>{isQuote ? 'QUOTE' : 'INVOICE'}</div>
          {logoUrl && business.logo_mode !== 'both' && !nameInLogo && <div style={{ fontWeight: 600, color: '#16161a' }}>{business.business_name}</div>}
          <div style={{ whiteSpace: 'pre-line' }}>{business.address}</div>
          {business.phone && <div>{business.phone}</div>}
          {business.business_email && <div>{business.business_email}</div>}
          {business.website && <div>{business.website}</div>}
        </div>
      </header>

      <section style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', fontSize: 13, lineHeight: 1.6 }}>
        <div>
          <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Bill to</div>
          {client ? (
            <>
              <strong style={{ fontWeight: 600 }}>{client.name}</strong>
              {client.address && <div style={{ whiteSpace: 'pre-line' }}>{client.address}</div>}
              {client.email && <div>{client.email}</div>}
            </>
          ) : <span className="muted">—</span>}
        </div>
        <table className="doc-meta" style={{ fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={{ textAlign: 'right', fontWeight: 600, padding: '1px 12px 1px 0' }}>{isQuote ? 'Quote' : 'Invoice'} number:</td><td>{invoice.number}</td></tr>
            <tr><td style={{ textAlign: 'right', fontWeight: 600, padding: '1px 12px 1px 0' }}>{isQuote ? 'Date' : 'Invoice date'}:</td><td>{fmtLong(invoice.issue_date)}</td></tr>
            {invoice.due_date && <tr><td style={{ textAlign: 'right', fontWeight: 600, padding: '1px 12px 1px 0' }}>{isQuote ? 'Valid until' : 'Payment due'}:</td><td>{fmtLong(invoice.due_date)}</td></tr>}
            <tr style={{ background: '#f4f4f1' }}><td style={{ textAlign: 'right', fontWeight: 600, padding: '4px 12px 4px 6px' }}>{isQuote ? 'Total (USD)' : 'Amount due (USD)'}:</td><td className="num" style={{ fontWeight: 600, paddingRight: 6 }}>{money(isQuote ? invoice.total : due)}</td></tr>
          </tbody>
        </table>
      </section>

      {/* Phones: one tappable row per item (tap to see details) instead of a wide table. */}
      <div className="doc-mlines">
        {lines.map((l, i) => <MobileLine key={l.id || i} l={l} />)}
      </div>
      <div className="table-wrap doc-table">
        <table className="doc-lines" style={{ minWidth: 460 }}>
          <thead>
            <tr style={headStyle}>
              <th>Items</th>
              <th className="r">Quantity</th>
              {showPrice && <th className="r">Price</th>}
              {hasTax && <th className="r">Tax</th>}
              <th className="r">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id || i}>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.item}</div>
                  {l.description && <div style={{ color: '#5f6168', whiteSpace: 'pre-line' }}>{l.description}</div>}
                  {l.note && <div style={{ color: '#5f6168', fontSize: 12, marginTop: 2, whiteSpace: 'pre-line' }}>{l.note}</div>}
                </td>
                <td className="r num">{Number(l.qty).toLocaleString('en-US', { maximumFractionDigits: 3 })}</td>
                {showPrice && <td className="r num">{money(l.rate)}</td>}
                {hasTax && <td className="r num">{num(l.tax_rate) ? `${num(l.tax_rate)}%` : '—'}</td>}
                <td className="r num">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <table className="doc-totals" style={{ fontSize: 13, borderCollapse: 'collapse', minWidth: 260 }}>
          <tbody>
            {(num(invoice.discount_total) > 0 || num(invoice.tax_total) > 0) && <TotRow label="Subtotal" value={money(invoice.subtotal)} />}
            {num(invoice.discount_total) > 0 && <TotRow label="Discount" value={`−${money(invoice.discount_total)}`} />}
            {num(invoice.tax_total) > 0 && <TotRow label="Tax" value={money(invoice.tax_total)} />}
            <TotRow label="Total" value={money(invoice.total)} strong />
            {payments.map((p, i) => <TotRow key={i} label={`Payment on ${fmtLong(p.paid_on)}${payMethod(p.method) ? ` (${payMethod(p.method)})` : ''}`} value={`−${money(p.amount)}`} muted />)}
            {!isQuote && <TotRow label="Amount due (USD)" value={money(due)} strong big />}
            {deposit > 0 && paid < deposit && <TotRow label={`Deposit due now (${num(invoice.deposit_percent)}%)`} value={money(deposit - paid)} strong />}
          </tbody>
        </table>
      </section>

      {(invoice.notes || invoice.terms) && (
        <section style={{ fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600 }}>Notes / Terms</div>
          {invoice.terms && <div>{invoice.terms}</div>}
          {invoice.notes && <div style={{ whiteSpace: 'pre-line' }}>{invoice.notes}</div>}
        </section>
      )}
      {business.payment_instructions && !isQuote && (
        <section style={{ fontSize: 13, lineHeight: 1.6, padding: 14, background: '#f6f6f4', borderRadius: 10 }}>
          <div style={{ fontWeight: 600 }}>How to pay</div>
          <div style={{ whiteSpace: 'pre-line' }}>{business.payment_instructions}</div>
        </section>
      )}
      {business.footer_note && <footer style={{ textAlign: 'center', fontSize: 12, color: '#5f6168' }}>{business.footer_note}</footer>}
    </article>
  );
}

function TotRow({ label, value, strong, big, muted }) {
  return (
    <tr>
      <td style={{ padding: '4px 20px 4px 0', textAlign: 'right', fontWeight: strong ? 600 : 400, color: muted ? '#5f6168' : undefined }}>{label}:</td>
      <td className="num" style={{ padding: '4px 0', textAlign: 'right', fontWeight: strong ? 600 : 400, fontSize: big ? 15 : 13, color: muted ? '#5f6168' : undefined, borderTop: big ? '1.5px solid #16161a' : undefined }}>{value}</td>
    </tr>
  );
}

function MobileLine({ l }) {
  const [open, setOpen] = useState(false);
  const desc = String(l.description || '');
  const first = desc.split('\n')[0];
  const more = desc.includes('\n') || !!l.note || num(l.qty) !== 1 || num(l.tax_rate) > 0;
  return (
    <button type="button" className={`doc-mline ${open ? 'open' : ''}`} onClick={() => more && setOpen(!open)} aria-expanded={more ? open : undefined}>
      <span className="doc-mline-main">
        <span className="doc-mline-item">{l.item}</span>
        {first && <span className={`doc-mline-desc ${open ? 'full' : ''}`}>{open ? desc : first}</span>}
        {open && l.note && <span className="doc-mline-desc full">{l.note}</span>}
        {open && <span className="doc-mline-qty num">{Number(l.qty).toLocaleString('en-US', { maximumFractionDigits: 3 })} × {money(l.rate)}{num(l.tax_rate) ? ` · tax ${num(l.tax_rate)}%` : ''}</span>}
      </span>
      <span className="doc-mline-amt num">{money(l.amount)}</span>
      {more && <svg className="doc-mline-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>}
    </button>
  );
}

/** "Bold" template: big title, company + contact columns, gray details band, open table with a Description column. */
function BoldDoc({ business, invoice, client, lines, payments, logoUrl, accent, isQuote, paid, due, deposit, hasTax, showPrice }) {
  const label = isQuote ? 'Quote' : 'Invoice';
  const msg = [invoice.terms, invoice.notes].filter(Boolean).join('\n');
  return (
    <article className="doc bold-doc" style={{ borderTop: `8px solid ${accent}` }}>
      <header className="bd-head">
        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          {logoUrl && <img src={logoUrl} alt="" style={{ maxWidth: 170, maxHeight: 64, objectFit: 'contain', objectPosition: 'left' }} />}
          <div className="bd-from">
            <div>
              <strong>{business.business_name}</strong>
              {business.address && <div style={{ whiteSpace: 'pre-line' }}>{business.address}</div>}
            </div>
            <div>
              {business.phone && <div><b>Phone #</b> {business.phone}</div>}
              {business.business_email && <div><b>Email</b> {business.business_email}</div>}
              {business.website && <div><b>Website</b> {business.website}</div>}
            </div>
          </div>
        </div>
        <h1 className="bd-title">{label}</h1>
      </header>

      <section className="bd-band">
        <div>
          <b>Bill to</b>
          {client ? <><div className="bd-strong">{client.name}</div>{client.address && <div style={{ whiteSpace: 'pre-line' }}>{client.address}</div>}{client.email && <div>{client.email}</div>}</> : <div>—</div>}
        </div>
        <dl>
          <b>Details</b>
          <div><dt>{label} #</dt><dd>{invoice.number}</dd></div>
          <div><dt>{isQuote ? 'Date' : 'Invoice date'}</dt><dd>{fmtLong(invoice.issue_date)}</dd></div>
          {invoice.terms && <div><dt>Terms</dt><dd>{invoice.terms}</dd></div>}
          {invoice.due_date && <div><dt>{isQuote ? 'Valid until' : 'Due date'}</dt><dd>{fmtLong(invoice.due_date)}</dd></div>}
          <div><dt>{isQuote ? 'Total' : 'Amount due'}</dt><dd className="num bd-strong">{money(isQuote ? invoice.total : due)}</dd></div>
        </dl>
      </section>

      <div className="doc-mlines">{lines.map((l, i) => <MobileLine key={l.id || i} l={l} />)}</div>
      <div className="table-wrap doc-table">
        <table className="bd-lines">
          <thead><tr><th>Product / service</th><th>Description</th><th className="r">Qty</th>{showPrice && <th className="r">Rate</th>}{hasTax && <th className="r">Tax</th>}<th className="r">Amount</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id || i}>
                <td>{l.item}</td>
                <td className="bd-desc">{[l.description, l.note].filter(Boolean).join('\n')}</td>
                <td className="r num">{Number(l.qty).toLocaleString('en-US', { maximumFractionDigits: 3 })}</td>
                {showPrice && <td className="r num">{money(l.rate)}</td>}
                {hasTax && <td className="r num">{num(l.tax_rate) ? `${num(l.tax_rate)}%` : '—'}</td>}
                <td className="r num">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="bd-foot">
        <div>{msg && <><b>Message</b><div style={{ whiteSpace: 'pre-line' }}>{msg}</div></>}</div>
        <table className="doc-totals bd-totals">
          <tbody>
            {(num(invoice.discount_total) > 0 || num(invoice.tax_total) > 0) && <TotRow label="Subtotal" value={money(invoice.subtotal)} />}
            {num(invoice.discount_total) > 0 && <TotRow label="Discount" value={`−${money(invoice.discount_total)}`} />}
            {num(invoice.tax_total) > 0 && <TotRow label="Tax" value={money(invoice.tax_total)} />}
            <TotRow label="Total" value={money(invoice.total)} strong big />
            {payments.map((p, i) => <TotRow key={i} label={`Payment on ${fmtLong(p.paid_on)}`} value={`−${money(p.amount)}`} muted />)}
            {!isQuote && payments.length > 0 && <TotRow label="Amount due" value={money(due)} strong />}
            {deposit > 0 && paid < deposit && <TotRow label={`Deposit due now (${num(invoice.deposit_percent)}%)`} value={money(deposit - paid)} strong />}
          </tbody>
        </table>
      </section>
      {business.payment_instructions && !isQuote && (
        <section style={{ fontSize: 13, lineHeight: 1.6, padding: 14, background: '#f6f6f4', borderRadius: 10 }}>
          <div style={{ fontWeight: 600 }}>How to pay</div>
          <div style={{ whiteSpace: 'pre-line' }}>{business.payment_instructions}</div>
        </section>
      )}
      {business.footer_note && <footer style={{ textAlign: 'center', fontSize: 12, color: '#5f6168' }}>{business.footer_note}</footer>}
    </article>
  );
}
