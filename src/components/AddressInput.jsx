// An address box that suggests real addresses as you type (OpenStreetMap data via Photon, free, no account).
// Only the text you type in this box is sent to look it up — nothing else from Wrap.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import { useStore } from '../store.jsx';

const STATES = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY' };
const cache = new Map();

/** One suggestion → { street, place, label }: "1600 Amphitheatre Pkwy" + "Mountain View, CA 94043". */
function shape(f) {
  const p = f.properties || {};
  const us = p.countrycode === 'US';
  const street = p.housenumber && p.street ? (us ? `${p.housenumber} ${p.street}` : `${p.street} ${p.housenumber}`) : p.street || '';
  const name = p.name && p.name !== street ? p.name : '';
  const region = us ? STATES[p.state] || p.state : p.state;
  const place = [p.city || p.town || p.village || p.county, [region, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ') + (us || !p.country ? '' : `, ${p.country}`);
  return { name, street, place, us };
}

// Results lean toward where you work: the area of your business address (looked up once, kept on this device).
let bias = null;
try { bias = JSON.parse(localStorage.getItem('wrap_geo_bias')); } catch { /* none yet */ }
export async function setBiasFrom(address) {
  const q = String(address || '').replace(/\s*\n\s*/g, ', ').trim();
  if (!q || bias?.q === q) return;
  try {
    const j = await (await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lang=en`)).json();
    const c = j.features?.[0]?.geometry?.coordinates;
    if (c) { bias = { q, lon: c[0], lat: c[1] }; localStorage.setItem('wrap_geo_bias', JSON.stringify(bias)); }
  } catch { /* no bias */ }
}

const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(street|st|avenue|ave|road|rd|way|drive|dr|boulevard|blvd|lane|ln|court|ct|place|pl)\b/g, '').replace(/\s+/g, ' ').trim();

async function lookup(q, signal) {
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  // "1392 grove way": the map data often lacks that exact house number, so we also look up the street
  // and put your number on it, and rank real number matches first.
  const m = q.match(/^(\d+[a-z]?)\s+(.+)$/i);
  const num = m?.[1];
  const near = bias ? `&lat=${bias.lat}&lon=${bias.lon}&zoom=9&location_bias_scale=0.5` : '';
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=12&lang=en${near}`, { signal });
  if (!r.ok) return [];
  const j = await r.json();
  const want = norm(m?.[2] || q).split(' ').filter(Boolean);
  const seen = new Set();
  const list = (j.features || []).map((f) => {
    const x = shape(f);
    const p = f.properties || {};
    const streetHit = want.length && want.every((w) => norm(`${p.street || ''} ${p.name || ''} ${p.city || ''}`).includes(w));
    let score = x.us ? 1 : 0;
    if (num && p.housenumber === num) score += 6;
    else if (num && streetHit && (p.osm_value === 'residential' || p.osm_key === 'highway' || !p.housenumber)) {
      // A street match: use the number you typed.
      const street = p.street || p.name;
      Object.assign(x, { name: '', street: x.us ? `${num} ${street}` : `${street} ${num}` });
      score += 4;
    } else if (streetHit) score += 2;
    return { ...x, score };
  })
    .filter((x) => (x.street || x.name) && x.place)
    .sort((a, b) => b.score - a.score)
    .filter((x) => { const k = `${x.name}|${x.street}|${x.place}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 5);
  cache.set(key, list);
  return list;
}

/**
 * multiline: fills "street\ncity, ST zip" (for invoices and client records).
 * Otherwise one line, e.g. "Paramount Studios, 5555 Melrose Ave, Los Angeles, CA 90038" (for trips).
 */
export default function AddressInput({ value, onChange, multiline = false, placeholder, ...rest }) {
  const home = useStore()?.db?.profile?.address;
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [i, setI] = useState(-1);
  const typed = useRef(false);
  const box = useRef(null);

  useEffect(() => {
    const q = String(value || '').replace(/\s*\n\s*/g, ', ').trim();
    if (!typed.current || q.length < 3) { setList([]); setBusy(false); return undefined; }
    // Earlier results stay up while the new ones load (the map service can take a moment).
    const ctl = new AbortController();
    setBusy(true);
    const t = setTimeout(() => lookup(q, ctl.signal).then((l) => { setList(l); setI(-1); setOpen(true); setBusy(false); }).catch(() => {}), cache.has(q.toLowerCase()) ? 0 : 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [open]);

  const pick = (x) => {
    typed.current = false;
    const line1 = [x.name, x.street].filter(Boolean).join(multiline ? '\n' : ', ');
    onChange(multiline ? `${line1}\n${x.place}` : `${line1}, ${x.place}`);
    setOpen(false);
  };
  const props = {
    ...rest, className: 'input', value: value || '', placeholder, autoComplete: 'off',
    onFocus: () => { if (home) setBiasFrom(home); },
    onChange: (e) => { typed.current = true; onChange(e.target.value); },
    onKeyDown: (e) => {
      if (!open || !list.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
      else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); pick(list[i]); }
      else if (e.key === 'Escape') setOpen(false);
    },
  };
  return (
    <div className="addr" ref={box}>
      {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
      {busy && <span className="addr-busy spinner" aria-label="Looking up addresses" />}
      {open && list.length > 0 && (
        <div className="addr-list" role="listbox">
          {list.map((x, k) => (
            <button key={k} type="button" role="option" aria-selected={k === i} className={`item-opt ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => pick(x)}>
              <Icon name="pin" size={16} />
              <span className="col" style={{ gap: 0, minWidth: 0, flex: 1 }}><b className="ellip">{x.name || x.street}</b><span className="small muted ellip">{x.name && x.street ? `${x.street}, ` : ''}{x.place}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
