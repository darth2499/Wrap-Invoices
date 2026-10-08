// Minimal hash router: #/invoices/123?tab=x  →  { path: '/invoices/123', parts: ['invoices','123'], query: {tab:'x'} }
import { useEffect, useState } from 'react';

function parse() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { path, parts: path.split('/').filter(Boolean), query };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(to) {
  window.location.hash = to.startsWith('#') ? to : `#${to}`;
}

export function shareUrl(token, kind = 'i') {
  return `${window.location.origin}${window.location.pathname}#/${kind}/${token}`;
}
