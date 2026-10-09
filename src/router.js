// Minimal router with clean URLs: /invoices/123?tab=x → { path: '/invoices/123', parts: ['invoices','123'], query: {tab:'x'} }.
// Old "#/…" links (bookmarks, links already emailed to clients) still work: they're turned into the clean form on load.
// GitHub Pages has no server routing, so the build also writes 404.html (a copy of the app) to answer deep links.
import { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, ''); // '' at the domain root

/** "#/reports" (old style, or an <a href="#/…">) → "/reports", without adding a history step. */
function fromHash() {
  const h = window.location.hash;
  if (h.startsWith('#/')) window.history.replaceState(window.history.state, '', BASE + h.slice(1));
}

function parse() {
  fromHash();
  const path = window.location.pathname.slice(BASE.length) || '/';
  const query = Object.fromEntries(new URLSearchParams(window.location.search));
  return { path, parts: path.split('/').filter(Boolean), query };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    window.addEventListener('wrap-nav', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('hashchange', on);
      window.removeEventListener('wrap-nav', on);
    };
  }, []);
  return route;
}

export function go(to) {
  const path = to.replace(/^#/, '');
  if (BASE + path === window.location.pathname + window.location.search) return;
  window.history.pushState(null, '', BASE + path);
  window.dispatchEvent(new Event('wrap-nav'));
}

/** Client links keep the "#/" form: it opens the app straight away on any static host (no 404 step). */
export function shareUrl(token, kind = 'i') {
  return `${window.location.origin}${BASE}/#/${kind}/${token}`;
}
