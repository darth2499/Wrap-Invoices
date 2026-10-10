// Automatic theme: light from sunrise to sunset, dark at night, where you work. It simply switches at sunrise
// and sunset (a quick blend, like tapping the button without the sun/moon).

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

/** 1 at night (dark), 0 by day (light). */
export function darkness(now = new Date()) {
  const { lat, lon } = place(now);
  const { rise, set } = sunTimes(now, lat, lon);
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= rise && m < set ? 0 : 1;
}

let timer = null;
const root = () => document.documentElement;

function paint(first = false) {
  const next = darkness() ? 'dark' : 'light';
  const html = root();
  if (html.dataset.theme === next) return;
  if (!first) {
    html.classList.add('theme-blend');
    setTimeout(() => html.classList.remove('theme-blend'), 800);
  }
  html.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#1b1c21' : '#f6f6f4');
}

// Coming back to the app after a while: catch up at once.
const onVisible = () => { if (document.visibilityState === 'visible') paint(true); };

export function startAuto() {
  stopAuto();
  paint(true);
  timer = setInterval(paint, 60000);
  document.addEventListener('visibilitychange', onVisible);
}

export function stopAuto() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisible);
  // (earlier versions faded colors in between: clear anything left over)
  for (const name of ['bg', 'surface', 'sunken', 'hover', 'line', 'line-2', 'field', 'chip-neutral', 'glass']) root().style.removeProperty(`--${name}`);
}

export const isAuto = () => !!timer;
