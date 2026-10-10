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
  pin: <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  tag: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.4" /></>,
  note: <><path d="M5 3h10l4 4v14H5z" /><path d="M9 12h6M9 16h4" /></>,
  deposit: <><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 3" /></>,
  zip: <><path d="M6 3h12v18H6z" /><path d="M11 3v2h2v2h-2v2h2v2h-2" /></>,
  file: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /></>,
  logout: <><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" /></>,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  convert: <><path d="M4 7h13l-3-3M20 17H7l3 3" /></>,
  rotate: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
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

/** An invoice's status pill; an eye (hover: "Seen by client") once the client has opened it. */
export function StatusPill({ st, extra = '' }) {
  return (
    <span className={`pill ${st.key}`}>
      {st.label}{extra}
      {st.seen && <span className="seen-eye" title="Seen by client" aria-label="Seen by client"><Icon name="eye" size={12} /></span>}
    </span>
  );
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

export function Switch({ checked, onChange, label, disabled }) {
  return <button type="button" role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => !disabled && onChange(!checked)} />;
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
    const list = !s || s === (selected?.label || '').toLowerCase() ? options : options.filter((o) => `${o.label} ${o.meta || ''}`.toLowerCase().includes(s));
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
  const [jump, setJump] = useState(false); // month/year grid instead of days
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
        <Button variant="ghost icon" icon="chevL" aria-label={jump ? 'Previous year' : 'Previous month'} onClick={() => shift(jump ? -12 : -1)} />
        <button type="button" className="cal-title" onClick={() => setJump((j) => !j)} aria-expanded={jump} aria-label="Pick month and year">
          {jump ? month.getFullYear() : month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          <Icon name="chevD" size={14} style={{ transform: jump ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </button>
        <Button variant="ghost icon" icon="chevR" aria-label={jump ? 'Next year' : 'Next month'} onClick={() => shift(jump ? 12 : 1)} />
      </div>
      {jump ? (
        <MonthGrid year={month.getFullYear()} month={month.getMonth()} onPick={(m) => { setMonth(new Date(month.getFullYear(), m, 1, 12)); setJump(false); }} />
      ) : (<>
      {!single && (
        <div className="row between">
          <Seg value={mode} onChange={(m) => { setMode(m); setStart(null); }} options={[{ value: 'days', label: 'Pick days' }, { value: 'range', label: 'Range' }]} label="Selection mode" />
          {value.length > 0 && <button type="button" className="btn link small" onClick={() => onChange([])}>Clear</button>}
        </div>
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
      </>)}
    </div>
  );
}

/** Twelve months to jump to (the current one marked). */
export function MonthGrid({ year, month, onPick }) {
  const now = new Date();
  return (
    <div className="month-grid">
      {Array.from({ length: 12 }, (_, m) => (
        <button key={m} type="button" className={`month-btn ${m === month ? 'on' : ''} ${year === now.getFullYear() && m === now.getMonth() ? 'today' : ''}`} onClick={() => onPick(m)}>
          {new Date(2000, m, 1).toLocaleDateString('en-US', { month: 'short' })}
        </button>
      ))}
    </div>
  );
}

/** A date field that opens the same calendar used everywhere else (tap the month to jump months/years). */
export function DateInput({ value, onChange, placeholder = 'Pick a date', clearable = false, align = 'left', 'aria-label': aria, defaultOpen = false, onDismiss }) {
  const [open, setOpenRaw] = useState(defaultOpen);
  const setOpen = (v) => setOpenRaw((o) => { const n = typeof v === 'function' ? v(o) : v; if (o && !n && onDismiss) setTimeout(onDismiss); return n; });
  const label = value ? parseISO(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return (
    <Popover open={open} setOpen={setOpen} align={align} width={310}
      trigger={
        <button type="button" className="input date-input" onClick={() => setOpen((o) => !o)} aria-label={aria || 'Date'} aria-expanded={open}>
          <span style={{ color: value ? 'var(--ink)' : 'var(--muted)' }}>{label || placeholder}</span>
          <Icon name="calendar" size={16} />
        </button>
      }>
      {/* Inside a <label>, a click on empty space would re-click the field and close this. */}
      <div onClick={(e) => e.preventDefault()}>
        <Calendar key={value || 'none'} single value={value ? [value] : []} onChange={([d]) => { onChange(d); setOpen(false); }} />
        <div className="row between" style={{ paddingTop: 8 }}>
          <button type="button" className="btn link small" onClick={() => { onChange(todayISO()); setOpen(false); }}>Today</button>
          {clearable && value && <button type="button" className="btn link small" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>}
        </div>
      </div>
    </Popover>
  );
}

/** A button that opens a floating panel (used for the calendar). */
export function Popover({ trigger, children, open, setOpen, width = 300, align = 'left' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useClickOutside(ref, () => setOpen(false), open);
  // Fixed to the screen (like menus) so scrolling boxes and tables can't cut it off; flips up near the bottom.
  useEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(width, window.innerWidth - 16);
      let left = align === 'right' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      const below = window.innerHeight - r.bottom;
      const up = below < 380 && r.top > below;
      setPos({ left, width: w, top: up ? 'auto' : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : 'auto', maxHeight: (up ? r.top : below) - 12 });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, width, align]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {trigger}
      {open && pos && (
        <div className="pop" style={{ position: 'fixed', ...pos, right: 'auto', padding: 12, overflowY: 'auto', zIndex: 60 }}>
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

/**
 * Table columns you can drag to reorder and click to sort (order and sort remembered on this device).
 * cols: { key: { label, sort?: (row) => value, right? } }; returns { order, headers, sorted(rows) }.
 */
export function useTableColumns(storageKey, cols, defaults) {
  const [order, setOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(saved)) {
        const out = saved.filter((k) => cols[k]);
        defaults.forEach((k, i) => { if (!out.includes(k)) out.splice(Math.min(i, out.length), 0, k); });
        return out;
      }
    } catch { /* default */ }
    return defaults;
  });
  const [sort, setSort] = useState(null);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const move = (from, to) => {
    if (!from || from === to) return;
    const next = order.filter((k) => k !== from);
    next.splice(next.indexOf(to), 0, from);
    setOrder(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* not saved */ }
  };
  const headers = order.map((k) => (
    <th key={k} className={`drag-th ${cols[k].right ? 'right' : ''} ${over === k ? 'drop' : ''}`} draggable
      onDragStart={(e) => { setDrag(k); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={(e) => { e.preventDefault(); setOver(k); }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => { e.preventDefault(); move(drag, k); setDrag(null); setOver(null); }}
      onDragEnd={() => { setDrag(null); setOver(null); }}
      onClick={() => cols[k].sort && setSort((o) => (o?.key === k ? { key: k, dir: -o.dir } : { key: k, dir: 1 }))}
      aria-sort={sort?.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      {cols[k].label}
      {cols[k].sort && <span className={`sort-arrow ${sort?.key === k ? 'on' : ''}`} aria-hidden="true">{sort?.key === k && sort.dir < 0 ? '↓' : '↑'}</span>}
    </th>
  ));
  const sorted = (rows) => {
    if (!sort) return rows;
    const get = cols[sort.key].sort;
    return [...rows].sort((a, b) => { const x = get(a); const y = get(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
  };
  return { order, headers, sorted };
}
