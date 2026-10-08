// Shared building blocks: icons, buttons, fields, modal, search box, calendar, menus.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { parseISO, toISO, todayISO } from '../lib/format.js';

const PATHS = {
  overview: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  invoice: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 12h7M9 16h5" /></>,
  quote: <><path d="M6 3h12v18H6z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  clients: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></>,
  reports: <><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>,
  settings: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  'chev-left': <path d="m15 6-6 6 6 6" />,
  'chev-right': <path d="m9 6 6 6-6 6" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  camera: <><path d="M4 7h3l2-3h6l2 3h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  link: <><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  check: <path d="M5 12l5 5 9-10" />,
  chevL: <path d="M15 6l-6 6 6 6" />,
  chevR: <path d="M9 6l6 6-6 6" />,
  chevD: <path d="M6 9l6 6 6-6" />,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  car: <><path d="M5 16l1.5-5a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5L19 16" /><rect x="3" y="16" width="18" height="4" rx="1" /><circle cx="7" cy="20" r="1" /><circle cx="17" cy="20" r="1" /></>,
  crew: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  cash: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 3" /></>,
  zip: <><path d="M6 3h12v18H6z" /><path d="M11 3v2h2v2h-2v2h2v2h-2" /></>,
  file: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /></>,
  logout: <><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" /></>,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  convert: <><path d="M4 7h13l-3-3M20 17H7l3 3" /></>,
  database: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
};

export function Icon({ name, size = 18, stroke = 1.8, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', ...style }}>
      {PATHS[name] || null}
    </svg>
  );
}

export function Button({ variant = '', size = '', icon, children, busy, className = '', ...rest }) {
  return (
    <button type="button" className={`btn ${variant} ${size} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spinner" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, style, className = '' }) {
  return (
    <label className={`field ${className}`} style={style}>
      <span>{label}{hint && <span className="hint"> {hint}</span>}</span>
      {children}
    </label>
  );
}

export function Pill({ kind, children }) {
  return <span className={`pill ${kind}`}>{children}</span>;
}

export function Seg({ value, options, onChange, label }) {
  // On phones the tabs scroll sideways; fades on the edges show there's more to swipe to.
  const ref = useRef(null);
  const [edges, setEdges] = useState('');
  const check = () => {
    const el = ref.current;
    if (!el) return;
    const l = el.scrollLeft > 2;
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges(`${l ? ' more-left' : ''}${r ? ' more-right' : ''}`);
  };
  useEffect(() => {
    check();
    const el = ref.current;
    el?.querySelector('.tab.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [value, options.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} onScroll={check} className={`seg${edges}`} role="tablist" aria-label={label}>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        return (
          <button key={v} type="button" role="tab" aria-selected={value === v} className={`tab ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>
            {typeof o === 'string' ? o : o.label}
            {o.count != null && <span className="num" style={{ opacity: 0.6, marginLeft: 6 }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label }) {
  return <button type="button" role="switch" aria-checked={!!checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} />;
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && <Button variant="ghost icon" icon="x" aria-label="Close" onClick={onClose} />}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon = 'file', title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} stroke={1.5} />
      {title && <strong style={{ color: 'var(--ink)' }}>{title}</strong>}
      {children}
    </div>
  );
}

function useClickOutside(ref, onOut, active) {
  useEffect(() => {
    if (!active) return;
    const on = (e) => ref.current && !ref.current.contains(e.target) && onOut();
    document.addEventListener('mousedown', on);
    document.addEventListener('touchstart', on);
    return () => {
      document.removeEventListener('mousedown', on);
      document.removeEventListener('touchstart', on);
    };
  }, [ref, onOut, active]);
}

/**
 * Search box that narrows a list as you type, with an optional "+ Add …" row.
 * options: [{ value, label, meta }]
 */
export function Combobox({ value, options, onChange, onCreate, placeholder, label, createLabel = (q) => `+ Add “${q}”`, ariaLabel }) {
  const selected = options.find((o) => o.value === value);
  const [q, setQ] = useState(selected?.label || '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const id = useId();
  useEffect(() => setQ(selected?.label || ''), [selected?.label]);
  useClickOutside(ref, () => { setOpen(false); setQ(selected?.label || ''); }, open);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = !s || s === (selected?.label || '').toLowerCase() ? options : options.filter((o) => o.label.toLowerCase().includes(s));
    return list.slice(0, 50);
  }, [q, options, selected]);
  const exact = options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase());
  const canCreate = onCreate && q.trim() && !exact;
  const rows = [...matches.map((m) => ({ ...m, type: 'opt' })), ...(canCreate ? [{ type: 'create' }] : [])];

  const pick = (row) => {
    if (row.type === 'create') onCreate(q.trim());
    else { onChange(row.value); setQ(row.label); }
    setOpen(false);
  };

  return (
    <div className="field" ref={ref} style={{ position: 'relative' }}>
      {label && <label htmlFor={id}>{label}</label>}
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted)' }}><Icon name="search" size={16} /></span>
        <input
          id={id} className="input" style={{ paddingLeft: 36 }} placeholder={placeholder} autoComplete="off" value={q}
          role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-label={ariaLabel || label}
          onFocus={(e) => { setOpen(true); e.target.select(); }}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); if (!e.target.value) onChange(null); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, rows.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && open && rows[active]) { e.preventDefault(); pick(rows[active]); }
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
      </div>
      {open && rows.length > 0 && (
        <div className="pop" role="listbox" id={`${id}-list`}>
          {rows.map((r, i) =>
            r.type === 'create' ? (
              <button key="create" type="button" className={`opt ${i === active ? 'active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                <b style={{ color: 'var(--accent)' }}>{createLabel(q.trim())}</b>
              </button>
            ) : (
              <button key={r.value} type="button" role="option" aria-selected={r.value === value} className={`opt ${i === active ? 'active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                <b>{r.label}</b><span>{r.meta}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Dropdown menu: <Menu label="More" items={[{label, icon, onClick, danger}]} /> */
export function Menu({ label = 'More', icon = 'more', items, align = 'right', variant = '' }) {
  const [pos, setPos] = useState(null); // where the open menu sits on screen (null = closed)
  const ref = useRef(null);
  const close = () => setPos(null);
  useClickOutside(ref, close, !!pos);
  // Fixed to the screen so tables and scrolling boxes can never cut it off; opens upward near the bottom.
  const place = () => {
    const r = ref.current.getBoundingClientRect();
    const list = items.filter(Boolean).length;
    const h = list * 42 + 12;
    const up = r.bottom + h > window.innerHeight - 8 && r.top > h;
    setPos({
      top: up ? 'auto' : r.bottom + 4,
      bottom: up ? window.innerHeight - r.top + 4 : 'auto',
      left: align === 'right' ? 'auto' : Math.max(8, r.left),
      right: align === 'right' ? Math.max(8, window.innerWidth - r.right) : 'auto',
      maxHeight: Math.max(160, (up ? r.top : window.innerHeight - r.bottom) - 16),
    });
  };
  const toggle = () => (pos ? close() : place());
  useEffect(() => {
    if (!pos) return undefined;
    // Follow the button if the page scrolls; close if it scrolls out of view.
    const follow = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) close();
      else place();
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => { window.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); };
  }, [pos]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Button variant={variant} icon={icon} aria-haspopup="menu" aria-expanded={!!pos} onClick={toggle}>{label}</Button>
      {pos && (
        <div className="pop" role="menu" style={{ minWidth: 220, position: 'fixed', ...pos, zIndex: 60 }}>
          {items.filter(Boolean).map((it) => (
            <button key={it.label} type="button" role="menuitem" className="opt" disabled={it.disabled} style={{ justifyContent: 'flex-start', gap: 10, color: it.danger ? 'var(--bad)' : 'var(--ink)', opacity: it.disabled ? 0.45 : 1 }} onClick={() => { close(); it.onClick(); }}>
              {it.icon && <Icon name={it.icon} size={16} />}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Calendar for picking shoot days. mode 'days' toggles single days; 'range' picks first then last.
 * value: ['YYYY-MM-DD', ...]; busy: { 'YYYY-MM-DD': 'Other job' }
 */
export function Calendar({ value, onChange, busy = {}, single = false }) {
  const first = value[0] ? parseISO([...value].sort()[0]) : new Date();
  const [month, setMonth] = useState(new Date(first.getFullYear(), first.getMonth(), 1, 12));
  const [mode, setMode] = useState('days');
  const [start, setStart] = useState(null);
  const today = todayISO();
  const cells = [];
  const lead = month.getDay();
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(toISO(new Date(month.getFullYear(), month.getMonth(), d, 12)));

  const click = (iso) => {
    if (single) return onChange([iso]);
    if (mode === 'days') return onChange(value.includes(iso) ? value.filter((x) => x !== iso) : [...value, iso].sort());
    if (!start) return setStart(iso);
    const [a, b] = start < iso ? [start, iso] : [iso, start];
    const add = [];
    for (let d = parseISO(a); toISO(d) <= b; d.setDate(d.getDate() + 1)) add.push(toISO(d));
    onChange([...new Set([...value, ...add])].sort());
    setStart(null);
  };
  const shift = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1, 12));

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between">
        <Button variant="ghost icon" icon="chevL" aria-label="Previous month" onClick={() => shift(-1)} />
        <strong style={{ fontSize: 14 }}>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong>
        <Button variant="ghost icon" icon="chevR" aria-label="Next month" onClick={() => shift(1)} />
      </div>
      {!single && (
        <div className="row between">
          <Seg value={mode} onChange={(m) => { setMode(m); setStart(null); }} options={[{ value: 'days', label: 'Pick days' }, { value: 'range', label: 'Range' }]} label="Selection mode" />
          {value.length > 0 && <button type="button" className="btn link small" onClick={() => onChange([])}>Clear</button>}
        </div>
      )}
      {!single && (
        <span className="small muted">
          {mode === 'days' ? 'Tap days to add or remove them.' : start ? 'Now tap the last day.' : 'Tap the first day of the range.'}
        </span>
      )}
      <div className="cal-grid">
        {DOW.map((d, i) => <span key={i} className="cal-dow">{d}</span>)}
        {cells.map((iso, i) =>
          iso ? (
            <button
              key={iso} type="button" onClick={() => click(iso)}
              className={`cal-day ${value.includes(iso) ? 'on' : ''} ${start === iso ? 'start' : ''} ${iso === today ? 'today' : ''} ${busy[iso] && !value.includes(iso) ? 'busy' : ''}`}
              aria-pressed={value.includes(iso)} aria-label={`${parseISO(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${busy[iso] ? `, booked: ${busy[iso]}` : ''}`}
              title={busy[iso] ? `Booked: ${busy[iso]}` : undefined}
            >
              {parseISO(iso).getDate()}
            </button>
          ) : <span key={`b${i}`} />,
        )}
      </div>
    </div>
  );
}

/** A button that opens a floating panel (used for the calendar). */
export function Popover({ trigger, children, open, setOpen, width = 300, align = 'left' }) {
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {trigger}
      {open && (
        <div className="pop" style={{ width, maxHeight: 'none', padding: 12, left: align === 'left' ? 0 : 'auto', right: align === 'right' ? 0 : 'auto', zIndex: 60 }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function Spinner({ label }) {
  return <span className="row muted"><span className="spinner" />{label}</span>;
}

/** Number input that keeps what you type (e.g. "12.") and reports a clean value. */
export function MoneyInput({ value, onChange, className = '', ...rest }) {
  const [text, setText] = useState(value === '' || value == null ? '' : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(value === '' || value == null ? '' : String(value));
      last.current = value;
    }
  }, [value]);
  return (
    <input
      className={`input num ${className}`} inputMode="decimal" value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value.replace(/[$,\s]/g, ''));
        const v = Number.isFinite(n) ? n : 0;
        last.current = v;
        onChange(v);
      }}
      {...rest}
    />
  );
}
