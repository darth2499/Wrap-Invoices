// Day/night switch: a soft sun (light) or moon (dark) rises from below the page, arcs across and sets,
// and the new theme wipes in right behind it, following its edge across the screen.
// Browsers without View Transitions get the same arc with a quick color blend instead.
import { useState } from 'react';
import { createPortal, flushSync } from 'react-dom';

const KEY = 'wrap_theme';
const MS = 1200;
export function initialTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* private mode */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#1b1c21' : '#16161A');
}

// cubic-bezier(.12,.72,.88,.28): fast up, hangs at the top, fast down.
function bezier(p1x, p1y, p2x, p2y) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (at(p1x, p2x, m) < x) lo = m; else hi = m; }
    return at(p1y, p2y, (lo + hi) / 2);
  };
}
const ease = bezier(0.12, 0.72, 0.88, 0.28);

/** The orb's path: centre points across the screen, sampled over the animation. */
// An ellipse sized to the window, so on a tall phone the orb still climbs to the upper third
// (a circle would only peek over the bottom edge). It starts and ends below the screen.
function arc(n = 48) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const rx = 0.6 * W;
  const ry = 0.78 * H;
  const pivotY = H * 1.04;
  return Array.from({ length: n + 1 }, (_, i) => {
    const deg = -108 + 216 * ease(i / n);
    const a = (deg * Math.PI) / 180;
    return { x: W / 2 + rx * Math.sin(a), y: pivotY - ry * Math.cos(a) };
  });
}

export default function ThemeToggle({ className = '', label }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const [orb, setOrb] = useState(null);
  const flip = () => {
    if (orb) return;
    const next = theme === 'dark' ? 'light' : 'dark';
    const kind = next === 'dark' ? 'moon' : 'sun';
    try { localStorage.setItem(KEY, next); } catch { /* not saved */ }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { applyTheme(next); setTheme(next); return; }

    if (document.startViewTransition) {
      // The new theme is revealed by a soft-edged mask whose edge rides with the orb.
      const pts = arc();
      const W = window.innerWidth;
      const html = document.documentElement;
      html.classList.add('vt-wipe');
      const vt = document.startViewTransition(() => flushSync(() => { applyTheme(next); setTheme(next); setOrb(`${kind} vt`); }));
      vt.ready.then(() => {
        const opts = { duration: MS, easing: 'linear', fill: 'both' };
        html.animate(pts.map((p) => ({ maskPosition: `${Math.round(p.x - W)}px 0`, WebkitMaskPosition: `${Math.round(p.x - W)}px 0` })), { ...opts, pseudoElement: '::view-transition-new(root)' });
        const half = (document.querySelector('.orb-vt')?.offsetWidth || 180) / 2;
        html.animate(pts.map((p) => ({ transform: `translate(${Math.round(p.x - half)}px, ${Math.round(p.y - half)}px)` })), { ...opts, pseudoElement: '::view-transition-group(wrap-orb)' });
      }).catch(() => {});
      vt.finished.finally(() => { html.classList.remove('vt-wipe'); setOrb(null); });
      return;
    }

    const html = document.documentElement;
    html.classList.add('theme-blend');
    setOrb(kind);
    setTimeout(() => { applyTheme(next); setTheme(next); }, 380);
    setTimeout(() => { html.classList.remove('theme-blend'); setOrb(null); }, MS + 50);
  };
  const icons = (
    <>
      <svg className="sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></svg>
      <svg className="moon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 14.6A8.5 8.5 0 0 1 9.4 4a8.5 8.5 0 1 0 10.6 10.6Z" /></svg>
    </>
  );
  return (
    <>
      <button type="button" className={`${label ? 'theme-row' : 'theme-toggle'} ${className}`} onClick={flip} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
        {label && <span>{label}</span>}
        {label ? <span className="theme-toggle" aria-hidden="true">{icons}</span> : icons}
      </button>
      {/* Drawn at the top of the page (not inside the sidebar), so nothing can cover it. */}
      {orb && createPortal(
        orb.endsWith(' vt')
          ? <span className={`orb-vt ${orb.split(' ')[0]}`} aria-hidden="true" />
          : <span className={`orb-arc ${orb}`} aria-hidden="true"><span className="orb-body" /></span>,
        document.body,
      )}
    </>
  );
}
