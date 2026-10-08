// The invoice as the client sees it (screen version). The PDF is drawn to match in lib/pdf.js.
import { money, fmtLong, num } from '../lib/format.js';
import { depositAmount } from '../lib/calc.js';

export default function InvoiceDoc({ business = {}, invoice, client, lines, payments = [], logoUrl }) {
  const template = business.template || 'minimal';
  const accent = business.accent || '#16161A';
  const isQuote = invoice.kind === 'quote';
  const paid = payments.reduce((s, p) => s + num(p.amount), 0);
  const due = num(invoice.total) - paid;
  const deposit = depositAmount(invoice);
  const headStyle =
    template === 'classic' ? { background: '#16161A', color: '#fff' }
      : template === 'bold' ? { background: accent, color: '#fff' }
        : { borderBottom: '1.5px solid #16161A', color: '#5f6168' };
  const hasTax = lines.some((l) => num(l.tax_rate) > 0);

  return (
    <article className="doc" style={template === 'bold' ? { paddingTop: 0, overflow: 'hidden' } : null}>
      {template === 'bold' && <div style={{ height: 10, background: accent, margin: '0 calc(-1 * clamp(20px, 5vw, 44px))' }} />}
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div className="col" style={{ gap: 8, minWidth: 0 }}>
          {logoUrl ? <img src={logoUrl} alt="" style={{ maxWidth: 180, maxHeight: 80, objectFit: 'contain', objectPosition: 'left' }} /> : null}
          {!logoUrl && <strong style={{ fontSize: 20, letterSpacing: '.03em' }}>{(business.business_name || '').toUpperCase()}</strong>}
        </div>
        <div style={{ textAlign: 'right', fontSize: 13, color: '#45464d', lineHeight: 1.55 }}>
          <div style={{ fontSize: 26, fontWeight: 600, color: template === 'bold' ? accent : '#16161a', letterSpacing: '.02em' }}>{isQuote ? 'QUOTE' : 'INVOICE'}</div>
          {logoUrl && <div style={{ fontWeight: 600, color: '#16161a' }}>{business.business_name}</div>}
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
        <table style={{ fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={{ textAlign: 'right', fontWeight: 600, padding: '1px 12px 1px 0' }}>{isQuote ? 'Quote' : 'Invoice'} number:</td><td>{invoice.number}</td></tr>
            <tr><td style={{ textAlign: 'right', fontWeight: 600, padding: '1px 12px 1px 0' }}>{isQuote ? 'Date' : 'Invoice date'}:</td><td>{fmtLong(invoice.issue_date)}</td></tr>
            {invoice.due_date && <tr><td style={{ textAlign: 'right', fontWeight: 600, padding: '1px 12px 1px 0' }}>{isQuote ? 'Valid until' : 'Payment due'}:</td><td>{fmtLong(invoice.due_date)}</td></tr>}
            <tr style={{ background: '#f4f4f1' }}><td style={{ textAlign: 'right', fontWeight: 600, padding: '4px 12px 4px 6px' }}>{isQuote ? 'Total (USD)' : 'Amount due (USD)'}:</td><td className="num" style={{ fontWeight: 600, paddingRight: 6 }}>{money(isQuote ? invoice.total : due)}</td></tr>
          </tbody>
        </table>
      </section>

      <div className="table-wrap">
        <table className="doc-lines" style={{ minWidth: 460 }}>
          <thead>
            <tr style={headStyle}>
              <th>Items</th>
              <th className="r">Quantity</th>
              <th className="r">Price</th>
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
                  {l.note && <div style={{ color: '#5f6168', fontSize: 12, marginTop: 2 }}>{l.note}</div>}
                </td>
                <td className="r num">{Number(l.qty).toLocaleString('en-US', { maximumFractionDigits: 3 })}</td>
                <td className="r num">{money(l.rate)}</td>
                {hasTax && <td className="r num">{num(l.tax_rate) ? `${num(l.tax_rate)}%` : '—'}</td>}
                <td className="r num">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <table style={{ fontSize: 13, borderCollapse: 'collapse', minWidth: 260 }}>
          <tbody>
            {(num(invoice.discount_total) > 0 || num(invoice.tax_total) > 0) && <TotRow label="Subtotal" value={money(invoice.subtotal)} />}
            {num(invoice.discount_total) > 0 && <TotRow label="Discount" value={`−${money(invoice.discount_total)}`} />}
            {num(invoice.tax_total) > 0 && <TotRow label="Tax" value={money(invoice.tax_total)} />}
            <TotRow label="Total" value={money(invoice.total)} strong />
            {payments.map((p, i) => <TotRow key={i} label={`Payment on ${fmtLong(p.paid_on)}${p.method ? ` (${p.method})` : ''}`} value={`−${money(p.amount)}`} muted />)}
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
