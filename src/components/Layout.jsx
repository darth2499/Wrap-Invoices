import { useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import { queueFiles } from '../lib/scanQueue.js';
import { go } from '../router.js';
import { useStore } from '../store.jsx';
import { APP_NAME, DEMO, LIVE_CONFIGURED } from '../config.js';
import { api } from '../api/index.js';

const NAV = [
  { id: '', label: 'Overview', icon: 'overview' },
  { id: 'invoices', label: 'Invoices', icon: 'invoice' },
  { id: 'quotes', label: 'Quotes', icon: 'quote' },
  { id: 'expenses', label: 'Expenses', icon: 'receipt' },
  { id: 'clients', label: 'Clients', icon: 'clients' },
  { id: 'reports', label: 'Reports', icon: 'reports' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export default function Layout({ route, children }) {
  const { db, user } = useStore();
  const section = route.parts[0] || '';
  const review = db.receipts.filter((r) => r.status === 'review').length;
  const current = section === 'invoices' && route.query.kind === 'quote' ? 'quotes' : section;
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <a className="brand" href="#/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="brand-mark">{APP_NAME[0]}</span>
          <span className="brand-text col" style={{ gap: 0 }}>
            <strong style={{ fontSize: 15 }}>{APP_NAME}</strong>
            <span className="small muted" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{db.profile.business_name || user.email}</span>
          </span>
        </a>
        <button className="btn primary new-btn" style={{ margin: '0 0 12px', flex: 'none' }} onClick={() => go('/invoices/new')} aria-label="New invoice">
          <Icon name="plus" size={16} /><span>New invoice</span>
        </button>
        {NAV.map((n) => (
          <a key={n.id} href={`#/${n.id}`} className={`nav ${current === n.id ? 'on' : ''}`} aria-current={current === n.id ? 'page' : undefined}>
            <Icon name={n.icon} />
            <span className={n.id === '' ? '' : ''}>{n.label}</span>
            {n.id === 'expenses' && review > 0 && <span className="pill review badge" title="Receipts to review">{review}</span>}
          </a>
        ))}
        <div className="side-foot col" style={{ gap: 6 }}>
          {DEMO && <span className="pill partial" style={{ alignSelf: 'flex-start' }}>Demo mode</span>}
          <span>{DEMO ? 'Data stays in this browser' : `Signed in as ${user.email}`}</span>
          <button className="btn link small" style={{ alignSelf: 'flex-start' }} onClick={() => api.auth.signOut()}>{DEMO && LIVE_CONFIGURED ? 'Exit demo' : 'Sign out'}</button>
        </div>
      </nav>
      <main className="main">{children}</main>
      <MobileNav current={current} review={review} />
    </div>
  );
}

function MobileNav({ current, review }) {
  const [open, setOpen] = useState(false);
  const cam = useRef(null);
  const item = (id, label, icon) => (
    <a href={`#/${id}`} className={current === id ? 'on' : ''} aria-current={current === id ? 'page' : undefined} onClick={() => setOpen(false)}>
      <Icon name={icon} size={22} />{label}
    </a>
  );
  return (
    <>
      {open && <div className="scrim" style={{ background: 'rgba(0,0,0,.2)', zIndex: 39 }} onClick={() => setOpen(false)} />}
      {open && (
        <div className="sheet" role="menu">
          <a href="#/invoices/new" onClick={() => setOpen(false)}><Icon name="plus" />New invoice</a>
          <a href="#/invoices/new?kind=quote" onClick={() => setOpen(false)}><Icon name="quote" />New quote</a>
          <a href="#/quotes" onClick={() => setOpen(false)}><Icon name="quote" />Quotes</a>
          <a href="#/clients" onClick={() => setOpen(false)}><Icon name="clients" />Clients</a>
          <a href="#/reports" onClick={() => setOpen(false)}><Icon name="reports" />Reports</a>
          <a href="#/settings" onClick={() => setOpen(false)}><Icon name="settings" />Settings</a>
          <button onClick={() => api.auth.signOut()}><Icon name="logout" />{DEMO && LIVE_CONFIGURED ? 'Exit demo' : 'Sign out'}</button>
        </div>
      )}
      <nav className="mobile-nav" aria-label="Main">
        {item('', 'Home', 'overview')}
        {item('invoices', 'Invoices', 'invoice')}
        <button type="button" className="scan" aria-label="Scan a receipt" onClick={() => cam.current?.click()}>
          <span className="bubble"><Icon name="camera" size={24} /></span>
        </button>
        <a href="#/expenses" className={current === 'expenses' ? 'on' : ''} onClick={() => setOpen(false)} style={{ position: 'relative' }}>
          <Icon name="receipt" size={22} />Expenses
          {review > 0 && <span className="pill review" style={{ position: 'absolute', top: 2, right: 10, padding: '0 6px', fontSize: 10 }}>{review}</span>}
        </a>
        <button type="button" className={open ? 'on' : ''} aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="more" size={22} />More</button>
        <input ref={cam} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) { queueFiles(f); go('/expenses'); } }} />
      </nav>
    </>
  );
}
