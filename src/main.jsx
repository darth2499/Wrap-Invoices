import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { applyTheme, initialTheme } from './components/ThemeToggle.jsx';

applyTheme(initialTheme());

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

createRoot(document.getElementById('root')).render(<App />);
