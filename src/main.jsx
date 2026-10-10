import { startEarly, linkToken } from './lib/publicFast.js';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { applyTheme, initialTheme } from './components/ThemeToggle.jsx';
import { startAuto } from './lib/autoTheme.js';

startEarly(); // a client link: ask for the invoice right away
applyTheme(initialTheme());
try { if (localStorage.getItem('wrap_theme') === 'auto') startAuto(); } catch { /* private mode */ }
// Until you pick a theme yourself, Wrap follows the system (and switches when it does).
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
  let saved = null;
  try { saved = localStorage.getItem('wrap_theme'); } catch { /* none */ }
  if (!saved) applyTheme(e.matches ? 'dark' : 'light');
});

// Anything cut off with "…" shows its full text when you hover it (calendar chips, long names, inputs).
document.addEventListener('mouseover', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement) || el.hasAttribute('title')) return;
  const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  if (el.scrollWidth <= el.clientWidth + 1) return;
  if (!isField && getComputedStyle(el).textOverflow !== 'ellipsis') return;
  const text = (isField ? el.value : el.textContent || '').trim();
  if (!text) return;
  el.title = text;
  el.addEventListener('mouseleave', () => el.removeAttribute('title'), { once: true });
}, { passive: true });

// Client links (#/i/…, #/s/…) load only their own page, not the whole app, so they open fast.
const pub = window.location.hash.match(/^#\/(i|s)\/([^/?]+)/);
const root = createRoot(document.getElementById('root'));
// After an update, an old page can ask for code that's gone: reload once to get the new version.
const loaded = (p) => p.then((m) => { sessionStorage.removeItem('wrap_reloaded'); return m; }).catch((e) => {
  if (sessionStorage.getItem('wrap_reloaded')) throw e;
  sessionStorage.setItem('wrap_reloaded', '1');
  window.location.reload();
  return new Promise(() => {});
});
if (pub) {
  const load = pub[1] === 'i' ? import('./pages/PublicInvoice.jsx') : import('./pages/PublicStatement.jsx');
  loaded(load).then(({ default: Page }) => root.render(<Page token={linkToken(pub[2]) || pub[2]} />));
  // Leaving the client page for the app itself: load the app.
  window.addEventListener('hashchange', () => { if (!/^#\/(i|s)\//.test(window.location.hash)) window.location.reload(); });
} else {
  loaded(import('./App.jsx')).then(({ default: App }) => root.render(<App />));
}
