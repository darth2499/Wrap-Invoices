// Automatic theme: follows the sun where you work. Light by day, dark by night, and in between the page
// drifts so slowly (a tiny step every 20 seconds over ~2½ hours around sunset and sunrise) that you can't see it move.
// Text has to switch from dark to light once (two dim grays would be unreadable), so that one moment is a slow 4-second fade
// at dusk, when the background is already dimmed most of the way.

const LIGHT = { bg: '#f6f6f4', surface: '#ffffff', sunken: '#ececE8', hover: '#f1f1ee', line: '#e6e6e2', 'line-2': '#efefec', field: '#dadad5', 'chip-neutral': '#ededea' };
const DIM_L = { bg: '#c9c9cb', surface: '#d6d6d8', sunken: '#bfbfc2', hover: '#cfcfd1', line: '#b5b5b9', 'line-2': '#bdbdc0', field: '#a9a9ad', 'chip-neutral': '#c2c2c5' };
const DIM_D = { bg: '#3a3b42', surface: '#44454d', sunken: '#4b4c54', hover: '#4a4b53', line: '#55565f', 'line-2': '#4c4d55', field: '#60616b', 'chip-neutral': '#55565f' };
const DARK = { bg: '#1b1c21', surface: '#24252b', sunken: '#2d2e35', hover: '#2b2c33', line: '#34353d', 'line-2': '#2c2d34', field: '#43444d', 'chip-neutral': '#34353d' };
const FADE = 75; // minutes before and after sunset/sunrise

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixHex = (a, b, t) => `#${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
const smooth = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

/** Sunrise and sunset (minutes after local midnight) for a date and place — NOAA's simplified formula. */
export function sunTimes(date = new Date(), lat = 37.7, lon = -122.2) {
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date - start) / 86400000);
  const g = ((2 * Math.PI) / 365) * (day - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const r = Math.PI / 180;
  const cosHa = Math.cos(90.833 * r) / (Math.cos(lat * r) * Math.cos(decl)) - Math.tan(lat * r) * Math.tan(decl);
  const ha = Math.acos(Math.min(1, Math.max(-1, cosHa))) / r;
  const off = date.getTimezoneOffset();
  return { rise: 720 - 4 * (lon + ha) - eq - off, set: 720 - 4 * (lon - ha) - eq - off };
}

/**
 * Where to compute the sun for. The last address typed is a good hint, but only if it's in this device's time zone
 * (an address picked for a client across the country, or the demo's, would put sunset hours off).
 * Otherwise the time zone's own longitude is used: the standard-time meridian is a close stand-in.
 */
function place(now) {
  const y = now.getFullYear();
  const std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset());
  const meridian = -std / 4;
  try {
    const b = JSON.parse(localStorage.getItem('wrap_geo_bias'));
    if (Number.isFinite(b?.lat) && Number.isFinite(b?.lon) && Math.abs(b.lon - meridian) <= 15) return { lat: b.lat, lon: b.lon };
  } catch { /* no hint yet */ }
  return { lat: Math.abs(meridian + 122) < 15 ? 37.7 : 38, lon: meridian };
}

/** 0 = full day (light) … 1 = full night (dark). */
export function darkness(now = new Date()) {
  const { lat, lon } = place(now);
  const { rise, set } = sunTimes(now, lat, lon);
  const m = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  if (m >= rise + FADE && m <= set - FADE) return 0;
  if (m > set - FADE && m < set + FADE) return smooth((m - (set - FADE)) / (2 * FADE));
  if (m > rise - FADE && m < rise + FADE) return 1 - smooth((m - (rise - FADE)) / (2 * FADE));
  return 1;
}

let timer = null;
const root = () => document.documentElement;

function paint(first = false) {
  const t = darkness();
  const dark = t >= 0.5;
  const html = root();
  if (!first && (html.dataset.theme === 'dark') !== dark) {
    // The one visible moment: text flips. Fade it slowly.
    html.classList.add('theme-slow');
    setTimeout(() => html.classList.remove('theme-slow'), 4500);
  }
  html.dataset.theme = dark ? 'dark' : 'light';
  const [from, to, k] = dark ? [DIM_D, DARK, (t - 0.5) * 2] : [LIGHT, DIM_L, t * 2];
  for (const name of Object.keys(LIGHT)) html.style.setProperty(`--${name}`, mixHex(from[name], to[name], k));
  html.style.setProperty('--glass', dark ? 'rgba(36,37,43,.94)' : 'rgba(255,255,255,.96)');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mixHex(from.bg, to.bg, k));
}

// Coming back to the app after a while: catch up at once instead of fading in front of you.
const onVisible = () => { if (document.visibilityState === 'visible') paint(true); };

export function startAuto() {
  stopAuto(false);
  paint(true); // turning it on: switch right away (the slow fade is only for sunset/sunrise)
  timer = setInterval(paint, 20000);
  document.addEventListener('visibilitychange', onVisible);
}

export function stopAuto(clear = true) {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisible);
  if (clear) for (const name of [...Object.keys(LIGHT), 'glass']) root().style.removeProperty(`--${name}`);
}

export const isAuto = () => !!timer;
