// "Import invoice" in Crew payouts: an invoice someone sent you (any app, PDF or photo) becomes a bill to pay.
// Shows what was read, highlights anything that doesn't add up, and matches the sender to a payee you already
// have (asking when it's only a maybe).
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, DateInput, Field, Icon, Modal, MoneyInput, Spinner } from './ui.jsx';
import { readBill, billProblems, fileKey } from '../lib/billImport.js';
import { findMatch } from '../lib/match.js';
import { money, num, round2, todayISO, plural } from '../lib/format.js';
import { go } from '../router.js';

export default function BillImport({ file, onClose }) {
  const s = useStore();
  const [state, setState] = useState({ step: 'reading' });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const key = await fileKey(file, s.user?.id || '');
        const dupe = s.db.crew_payouts.find((p) => p.source_key === key);
        if (dupe) { if (live) setState({ step: 'dupe', dupe }); return; }
        const { bill, text } = await readBill(file, s.api);
        if (live) setState({ step: 'review', bill, text, key });
      } catch (e) { if (live) setState({ step: 'error', message: e.message }); }
    })();
    return () => { live = false; };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.step === 'reading') return <Modal title="Importing invoice" onClose={onClose}><Spinner label={`Reading ${file.name}…`} /></Modal>;
  if (state.step === 'error') return <Modal title="Couldn’t import it" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}><p className="muted">{state.message}</p></Modal>;
  if (state.step === 'dupe') {
    return (
      <Modal title="Already in your payouts" onClose={onClose} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" onClick={() => { onClose(); go(`/expenses/crew?payout=${state.dupe.id}`); }}>Open it</Button></>}>
        <p className="muted">{file.name} was imported before ({state.dupe.description || 'payout'}, {money(state.dupe.amount)}).</p>
      </Modal>
    );
  }
  return <Review file={file} bill={state.bill} text={state.text} srcKey={state.key} onClose={onClose} />;
}

function Review({ file, bill, text, srcKey, onClose }) {
  const s = useStore();
  const [f, setF] = useState({
    from_name: bill.from_name || '', from_email: bill.from_email || '', from_phone: bill.from_phone || '',
    number: String(bill.number || ''), issue_date: bill.issue_date || '', due_date: bill.due_date || '',
    amount: bill.amount_due ?? bill.total ?? '',
  });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const edited = { ...bill, from_name: f.from_name, number: f.number, issue_date: f.issue_date || null, due_date: f.due_date || null, amount_due: f.amount === '' ? null : num(f.amount) };
  const problems = useMemo(() => {
    const list = billProblems(edited, text);
    const same = s.db.crew_payouts.find((p) => p.source_number && String(p.source_number) === String(f.number).trim() && s.derived.crew[p.crew_id]?.name?.toLowerCase() === f.from_name.trim().toLowerCase());
    if (same) list.push({ field: 'number', message: `You already have invoice #${f.number} from ${f.from_name}.` });
    return list;
  }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = (field) => problems.some((p) => p.field === field);

  // Which payee it goes to: a sure match is picked for you, a maybe is asked.
  const match = useMemo(() => findMatch({ name: f.from_name, email: f.from_email, phone: f.from_phone, address: bill.from_address }, s.db.crew_members), [f.from_name, f.from_email, f.from_phone]); // eslint-disable-line react-hooks/exhaustive-deps
  const [payee, setPayee] = useState(null); // crew id, 'new', or null = follow the match
  const chosen = payee ?? (match?.level === 'same' ? match.item.id : null);
  const asking = payee == null && match?.level === 'ask';
  const target = chosen && chosen !== 'new' ? s.db.crew_members.find((m) => m.id === chosen) : null;

  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      let crewId = target?.id;
      if (!crewId) {
        const m = await s.insert('crew_members', { name: f.from_name.trim() || 'Unknown sender', email: f.from_email || null, phone: f.from_phone || null, address: bill.from_address || null });
        crewId = m.id;
      } else {
        const patch = {};
        if (!target.email && f.from_email) patch.email = f.from_email;
        if (!target.phone && f.from_phone) patch.phone = f.from_phone;
        if (!target.address && bill.from_address) patch.address = bill.from_address;
        if (Object.keys(patch).length) await s.update('crew_members', crewId, patch);
      }
      const items = [...new Set((bill.lines || []).map((l) => String(l.item || '').trim()).filter(Boolean))];
      const amount = round2(num(f.amount));
      const p = await s.insert('crew_payouts', {
        crew_id: crewId,
        work_date: f.issue_date || todayISO(),
        due_date: f.due_date || null,
        amount,
        description: `Invoice #${f.number || '?'}${items.length ? ` · ${items.slice(0, 3).join(', ')}${items.length > 3 ? '…' : ''}` : ''}`.slice(0, 200),
        source_number: f.number || null,
        source_key: srcKey,
        source_detail: {
          from: f.from_name, issue_date: f.issue_date || null, due_date: f.due_date || null, total: num(bill.total), due: amount,
          subtotal: num(bill.subtotal), discount: Math.abs(num(bill.discount)), tax: num(bill.tax),
          lines: (bill.lines || []).map((l) => ({ item: l.item || '', description: l.description || '', note: l.note || '', qty: num(l.qty) || 1, rate: num(l.rate), amount: num(l.amount) })),
          file_name: file.name,
        },
      });
      s.toast(`Invoice #${f.number || ''} from ${f.from_name} added`, { action: { label: 'Open', run: () => go(`/expenses/crew?payout=${p.id}`) } });
      onClose();
    } catch (e) { s.toast(e.message, { error: true }); }
    setBusy(false);
  };

  const lines = bill.lines || [];
  return (
    <Modal title="Check the invoice" onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" busy={busy} disabled={!f.from_name.trim() || !num(f.amount) || asking} onClick={save}>{problems.length ? 'Save anyway' : 'Add to payouts'}</Button>
    </>}>
      {problems.length > 0 && (
        <div className="banner warn" style={{ alignItems: 'flex-start' }}>
          <Icon name="bell" />
          <span className="col" style={{ gap: 2 }}>{problems.map((p, i) => <span key={i}>{p.message}</span>)}</span>
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="From"><input className={`input ${bad('from_name') ? 'is-bad' : ''}`} value={f.from_name} onChange={set('from_name')} /></Field>
        <Field label="Invoice #"><input className={`input ${bad('number') ? 'is-bad' : ''}`} value={f.number} onChange={set('number')} /></Field>
        <Field label="Email" hint="(optional)"><input className="input" type="email" value={f.from_email} onChange={set('from_email')} /></Field>
        <Field label="Phone" hint="(optional)"><input className="input" value={f.from_phone} onChange={set('from_phone')} /></Field>
        <Field label="Invoice date"><span className={bad('issue_date') ? 'is-bad-wrap' : ''}><DateInput value={f.issue_date} onChange={set('issue_date')} /></span></Field>
        <Field label="Due"><span className={bad('due_date') ? 'is-bad-wrap' : ''}><DateInput clearable value={f.due_date} onChange={set('due_date')} /></span></Field>
        <Field label="Amount to pay"><span className={bad('due') || bad('total') ? 'is-bad-wrap' : ''}><MoneyInput value={f.amount} onChange={set('amount')} /></span></Field>
      </div>

      {asking ? (
        <div className="card card-pad col" style={{ gap: 8 }}>
          <span>Is this <b>{match.item.name}</b>, one of your payees?</span>
          <span className="small muted">{match.why.join(' · ')}</span>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" variant="primary" onClick={() => setPayee(match.item.id)}>Yes, same</Button>
            <Button size="sm" onClick={() => setPayee('new')}>No, new payee</Button>
          </div>
        </div>
      ) : (
        <div className="row between wrap small" style={{ gap: 8 }}>
          <span className="muted">{target ? <>Goes to <b style={{ color: 'var(--ink)' }}>{target.name}</b> in your crew</> : <>Adds <b style={{ color: 'var(--ink)' }}>{f.from_name || 'them'}</b> to your crew</>}</span>
          <select className="input" style={{ width: 'auto', minHeight: 32, padding: '4px 10px' }} value={chosen || 'new'} onChange={(e) => setPayee(e.target.value)} aria-label="Payee">
            <option value="new">New payee</option>
            {s.db.crew_members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      )}

      {lines.length > 0 && (
        <section className="bill-lines" style={bad('lines') ? { borderColor: 'var(--bad)' } : undefined}>
          <div className="bill-head"><span className="small muted">{plural(lines.length, 'item')}{bill.reader === 'exact' ? ' · read exactly from the PDF' : ''}</span></div>
          {lines.map((l, i) => (
            <div key={i} className="bill-line" style={{ gridTemplateColumns: '1fr auto' }}>
              <span className="col" style={{ gap: 2, minWidth: 0 }}>
                <b style={{ fontWeight: 500 }}>{l.item || 'Item'}</b>
                {l.description && <span className="small muted" style={{ whiteSpace: 'pre-line' }}>{l.description}</span>}
                {num(l.qty) !== 1 && <span className="small muted num">{num(l.qty)} × {money(l.rate)}</span>}
              </span>
              <span className="num">{money(l.amount)}</span>
            </div>
          ))}
          {num(bill.discount) > 0 && <div className="bill-line bill-sum" style={{ gridTemplateColumns: '1fr auto' }}><span className="muted">Discount</span><span className="num">−{money(Math.abs(num(bill.discount)))}</span></div>}
          {num(bill.tax) > 0 && <div className="bill-line bill-sum" style={{ gridTemplateColumns: '1fr auto' }}><span className="muted">Tax</span><span className="num">{money(bill.tax)}</span></div>}
          <div className="bill-line bill-total" style={{ gridTemplateColumns: '1fr auto' }}><b>Total</b><span className="num">{money(bill.total)}</span></div>
        </section>
      )}
    </Modal>
  );
}
