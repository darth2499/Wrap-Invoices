import { useEffect, useState } from "react";
import { api } from './api/index.js';
import { StoreProvider, useStore } from './store.jsx';
import { useRoute, go } from './router.js';
import Layout from './components/Layout.jsx';
import { Button, Spinner } from './components/ui.jsx';
import { APP_NAME, DEMO, LIVE_CONFIGURED, setDemoMode } from './config.js';
import Overview from './pages/Overview.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';
import InvoiceEditor from './pages/InvoiceEditor.jsx';
import Expenses from './pages/Expenses.jsx';
import Clients from './pages/Clients.jsx';
import Reports from './pages/Reports.jsx';
import Calendar from './pages/Calendar.jsx';
import Settings from './pages/Settings.jsx';
import PublicInvoice from './pages/PublicInvoice.jsx';
import PublicStatement from './pages/PublicStatement.jsx';

function readAuthError() {
  const all = new URLSearchParams(window.location.search + '&' + window.location.hash.replace(/^#\/?/, ''));
  const desc = all.get('error_description');
  if (!desc) return null;
  if (/saving new user|WRAP_NOT_INVITED/i.test(desc)) return "This Google account isn't invited yet. Ask the account owner to add your email in Settings → People.";
  return desc.replace(/\+/g, ' ');
}

export default function App() {
  const route = useRoute();
  const isPublic = route.parts[0] === 'i' || route.parts[0] === 's';
  const [user, setUser] = useState(undefined);
  const [authError] = useState(readAuthError);

  useEffect(() => {
    if (isPublic) return;
    let alive = true;
    const off = api.auth.onChange((event, session) => {
      const next = session?.user ?? null;
      if (alive) setUser((cur) => (cur && next && cur.id === next.id ? cur : next));
      // Right after "Connect Gmail", Google's permission comes back with the session once.
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.provider_refresh_token && sessionStorage.getItem('wrap_connect_gmail')) {
        sessionStorage.removeItem('wrap_connect_gmail');
        const token = session.provider_refresh_token;
        // Run outside the auth callback (calling Supabase inside it can lock up).
        setTimeout(async () => {
          try {
            const r = await api.gmail('connect', { refresh_token: token });
            sessionStorage.setItem('wrap_gmail_result', `Gmail connected: ${r.email}`);
          } catch (e) {
            sessionStorage.setItem('wrap_gmail_result', `Gmail not connected: ${e.message}`);
          }
          go('/settings?section=email');
          window.dispatchEvent(new Event('wrap-gmail'));
        }, 0);
      }
    });
    api.auth.getUser().then((u) => alive && setUser((cur) => (cur === undefined ? u : cur)));
    return () => {
      alive = false;
      off();
    };
  }, [isPublic]);

  if (route.parts[0] === 'i') return <PublicInvoice token={route.parts[1]} />;
  if (route.parts[0] === 's') return <PublicStatement token={route.parts[1]} />;
  if (user === undefined) return <div className="login"><Spinner label="Loading…" /></div>;
  if (!user) return <Login error={authError} />;
  return (
    <StoreProvider user={user}>
      <Shell route={route} />
    </StoreProvider>
  );
}

function Shell({ route }) {
  const { db, error } = useStore();
  if (error) return <div className="login"><div className="card card-pad col" style={{ maxWidth: 460 }}><h2>Couldn't load your data</h2><p className="muted">{error}</p><Button onClick={() => window.location.reload()}>Try again</Button></div></div>;
  if (!db) return <div className="login"><Spinner label="Loading your invoices…" /></div>;
  const [a, b, c] = route.parts;
  let page;
  if (!a) page = <Overview />;
  else if (a === 'invoices' && b === 'new') page = <InvoiceEditor key={`new-${route.query.kind}-${route.query.from || ''}-${route.query.client || ''}`} kind={route.query.kind || 'invoice'} fromId={route.query.from} clientId={route.query.client} />;
  else if (a === 'invoices' && b && c === 'edit') page = <InvoiceEditor key={`edit-${b}`} id={b} />;
  else if (a === 'invoices' && b) page = <InvoiceDetail key={b} id={b} />;
  else if (a === 'invoices') page = <Invoices kind="invoice" />;
  else if (a === 'quotes') page = <Invoices kind="quote" />;
  else if (a === 'expenses') page = <Expenses tab={b || 'receipts'} query={route.query} />;
  else if (a === 'clients') page = <Clients id={b} />;
  else if (a === 'reports') page = <Reports tab={b || 'overview'} />;
  else if (a === 'calendar') page = <Calendar />;
  else if (a === 'settings') page = <Settings section={route.query.section} />;
  else page = <div className="page"><h1>Not found</h1><a href="#/">Go to overview</a></div>;
  return <Layout route={route}>{page}</Layout>;
}

function Login({ error }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <div className="card" style={{ width: '100%', maxWidth: 400, padding: 32, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="brand-mark" style={{ width: 40, height: 40, fontSize: 20 }}>{APP_NAME[0]}</span>
          <div className="col" style={{ gap: 0 }}>
            <h1 style={{ fontSize: 24 }}>{APP_NAME}</h1>
            <span className="muted">Invoices, receipts and taxes for freelance video work</span>
          </div>
        </div>
        {error && <div className="banner bad">{error}</div>}
        <Button variant="primary" className="block" busy={busy} onClick={() => { setBusy(true); api.auth.signIn(); }} style={{ minHeight: 48 }}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
          {DEMO ? 'Enter demo' : 'Sign in with Google'}
        </Button>
        {LIVE_CONFIGURED && !DEMO && <Button className="block" onClick={() => setDemoMode(true)} style={{ minHeight: 44 }}>Try the demo</Button>}
        <p className="small muted">{DEMO ? 'Demo: made-up sample data, kept only in this browser. Nothing is sent to a server.' : 'Invite-only. Your data is private to your account.'}</p>
      </div>
    </div>
  );
}

