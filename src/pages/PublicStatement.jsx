// A client's statement: every open invoice in one place (no sign-in).
import { useEffect, useState } from 'react';
import { publicApi } from '../api/index.js';
import { Spinner } from '../components/ui.jsx';
import { Center } from './PublicInvoice.jsx';
import { money, fmtDate, todayISO } from '../lib/format.js';

export default function PublicStatement({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    publicApi(token).publicCall('statement', { token }).then(setData).catch((e) => setError(e.message));
  }, [token]);
  if (error) return <Center><h2>Link not found</h2><p className="muted">Ask the sender for a new link.</p></Center>;
  if (!data) return <Center><Spinner label="Loading…" /></Center>;
  const today = todayISO();
  const base = `${window.location.origin}${window.location.pathname}`;
  return (
    <div style={{ minHeight: '100vh', padding: '32px 16px 64px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <header className="col" style={{ gap: 4 }}>
          <span className="muted">Statement from {data.business?.business_name} for {data.client.name}</span>
          <span className="num" style={{ fontSize: 34, fontWeight: 500 }}>{money(data.total_due)}</span>
          <span style={{ color: 'var(--ink-2)' }}>{data.invoices.length} open invoice{data.invoices.length === 1 ? '' : 's'} · as of {fmtDate(today)}</span>
        </header>
        <section className="card">
          {data.invoices.length === 0 ? <p style={{ padding: 24 }} className="muted">Nothing is owed right now. Thank you!</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th className="right">Amount due</th></tr></thead>
                <tbody>
                  {data.invoices.map((i) => (
                    <tr key={i.number} className="click" onClick={() => (window.location.href = `${base}#/i/${i.share_token}`)}>
                      <td><a href={`${base}#/i/${i.share_token}`}>#{i.number}</a></td>
                      <td className="muted">{fmtDate(i.issue_date)}</td>
                      <td style={{ color: i.due_date < today ? 'var(--bad)' : undefined }}>{fmtDate(i.due_date)}{i.due_date < today ? ' · overdue' : ''}</td>
                      <td className="right num">{money(i.due)}{i.paid > 0 && <div className="small muted">of {money(i.total)}</div>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3} style={{ fontWeight: 600, borderTop: '1px solid var(--line)' }}>Total due</td><td className="right num" style={{ fontWeight: 600, borderTop: '1px solid var(--line)' }}>{money(data.total_due)}</td></tr></tfoot>
              </table>
            </div>
          )}
        </section>
        {data.business?.payment_instructions && <section className="card card-pad"><h3>How to pay</h3><p style={{ whiteSpace: 'pre-line', marginTop: 6 }}>{data.business.payment_instructions}</p></section>}
        <p className="small muted" style={{ textAlign: 'center' }}>Open any invoice to download its PDF and receipts.</p>
      </div>
    </div>
  );
}
