// An address box that suggests real addresses as you type (OpenStreetMap data via Photon, free, no account).
// Only the text you type in this box is sent to look it up — nothing else from Wrap.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

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

async function lookup(q, signal) {
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en`, { signal });
  if (!r.ok) return [];
  const j = await r.json();
  const seen = new Set();
  const list = (j.features || []).map(shape).filter((x) => (x.street || x.name) && x.place)
    .sort((a, b) => b.us - a.us)
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
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(-1);
  const typed = useRef(false);
  const box = useRef(null);

  useEffect(() => {
    const q = String(value || '').replace(/\s*\n\s*/g, ', ').trim();
    if (!typed.current || q.length < 4) { setList([]); return undefined; }
    const ctl = new AbortController();
    const t = setTimeout(() => lookup(q, ctl.signal).then((l) => { setList(l); setI(-1); setOpen(true); }).catch(() => {}), 280);
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
