// Day/night switch. Clicking plays a short sunset/moonrise, then flips the theme halfway through.
import { useState } from 'react';

const KEY = 'wrap_theme';
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

export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const [sky, setSky] = useState(null);
  const flip = () => {
    if (sky) return;
    const next = theme === 'dark' ? 'light' : 'dark';
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    try { localStorage.setItem(KEY, next); } catch { /* not saved */ }
    if (reduce) { applyTheme(next); setTheme(next); return; }
    setSky(next);
    setTimeout(() => { applyTheme(next); setTheme(next); }, 550);
    setTimeout(() => setSky(null), 1350);
  };
  return (
    <>
      <button type="button" className={`theme-toggle ${className}`} onClick={flip} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
        <svg className="sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></svg>
        <svg className="moon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 14.6A8.5 8.5 0 0 1 9.4 4a8.5 8.5 0 1 0 10.6 10.6Z" /></svg>
      </button>
      {sky && (
        <div className={`sky to-${sky}`} aria-hidden="true">
          <span className="orb sun-orb" />
          <span className="orb moon-orb" />
        </div>
      )}
    </>
  );
}
