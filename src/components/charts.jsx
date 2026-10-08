// Small, dependency-free charts.
import { useState } from 'react';
import { money, moneyK } from '../lib/format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Grouped monthly bars: series = [{ name, color, values[] }], labels = [] */
/**
 * Side-by-side monthly bars (e.g. invoiced vs expenses). Each month is one column with its label
 * right under it; hover or tap a month to see its numbers and the difference (net).
 * labels: ['Nov', …]; years (optional): [2025, …] shown under January and the first month.
 */
export function MonthBars({ labels, years, series, height = 200, currentIndex = null }) {
  // Shown until you hover a month: this month, or else the latest month with numbers.
  const latest = labels.map((_, i) => i).filter((i) => series.some((x) => x.values[i] > 0)).pop() ?? labels.length - 1;
  const [sel, setSel] = useState(null);
  const active = sel ?? currentIndex ?? latest;
  const rawTop = Math.max(1, ...series.flatMap((x) => x.values)) * 1.05;
  const mag = 10 ** Math.floor(Math.log10(rawTop / 4));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((st) => st * 4 >= rawTop) || mag * 10;
  const top = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);
  const net = series.length === 2 ? series[0].values[active] - series[1].values[active] : null;
  const name = `${labels[active]}${years ? ` ${years[active]}` : ''}`;
  return (
    <div className="col mb" style={{ gap: 12 }}>
      <div className="row between wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
        <div className="row wrap" style={{ gap: 18 }}>
          <span className="col" style={{ gap: 2 }}>
            <span className="small muted">{name}{sel == null && currentIndex != null ? ' (this month)' : ''}</span>
            <span className="row wrap" style={{ gap: 14 }}>
              {series.map((x) => (
                <span key={x.name} className="row" style={{ gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: x.color }} />
                  <span className="small" style={{ color: 'var(--ink-2)' }}>{x.name}</span>
                  <strong className="num">{money(x.values[active], { cents: false })}</strong>
                </span>
              ))}
              {net != null && <span className="row" style={{ gap: 6 }}><span className="small" style={{ color: 'var(--ink-2)' }}>Net</span><strong className="num" style={{ color: net < 0 ? 'var(--bad)' : 'var(--ink)' }}>{money(net, { cents: false })}</strong></span>}
            </span>
          </span>
        </div>
        <span className="small muted">Hover or tap a month</span>
      </div>
      <div className="mb-plot" style={{ height }} onMouseLeave={() => setSel(null)}>
        <div className="mb-axis">
          {ticks.map((t) => <span key={t} className="num" style={{ bottom: `${(t / top) * 100}%` }}>{moneyK(t)}</span>)}
        </div>
        <div className="mb-area">
          {ticks.map((t) => <div key={t} className="mb-grid" style={{ bottom: `${(t / top) * 100}%`, borderColor: t === 0 ? 'var(--field)' : undefined }} />)}
          <div className="mb-cols">
            {labels.map((l, i) => (
              <button type="button" key={`${l}${i}`} className={`mb-col ${i === active ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => setSel(i)}
                aria-label={`${l}${years ? ` ${years[i]}` : ''}: ${series.map((x) => `${x.name} ${money(x.values[i], { cents: false })}`).join(', ')}`}>
                <span className="mb-bars">
                  {series.map((x) => <span key={x.name} className="mb-bar" style={{ height: `${x.values[i] > 0 ? Math.max(1.5, (x.values[i] / top) * 100) : 0}%`, background: x.color }} />)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mb-labels">
        {labels.map((l, i) => (
          <span key={`${l}${i}`} className={i === active ? 'on' : ''}>
            {l}
            {years && (i === 0 || l === 'Jan') && <em>{years[i]}</em>}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Cumulative income: last year (gray), this year so far (solid), forecast (dashed) with a range band. */
export function ForecastChart({ f }) {
  const [hover, setHover] = useState(null);
  const cum = (arr) => arr.reduce((acc, v) => [...acc, (acc[acc.length - 1] || 0) + v], []);
  const prevCum = cum(f.prev);
  const curCum = cum(f.cur.slice(0, f.month)); // full months only
  // Round gridlines ($50k, $100k…) so the axis is easy to read.
  const rawTop = Math.max(1, ...prevCum, f.high, ...curCum) * 1.05;
  const mag = 10 ** Math.floor(Math.log10(rawTop / 4));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((st) => st * 4 >= rawTop) || mag * 10;
  const top = step * 4;
  const Wd = 600;
  const Ht = 240;
  const X = (i) => (i * Wd) / 11;
  const Y = (v) => Ht - (v / top) * (Ht - 10);
  const pts = (arr, off = 0) => arr.map((v, i) => `${X(i + off).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const startX = f.month - 1;
  const startV = curCum[curCum.length - 1] || 0;
  const anchor = startX >= 0 ? `${X(startX).toFixed(1)},${Y(startV).toFixed(1)} ` : '';
  const band = anchor + pts(f.cumHigh, f.month) + ' ' + f.cumLow.map((v, i) => `${X(f.month + i).toFixed(1)},${Y(v).toFixed(1)}`).reverse().join(' ') + (startX >= 0 ? ` ${X(startX).toFixed(1)},${Y(startV).toFixed(1)}` : '');
  const ticks = [1, 2, 3, 4].map((k) => k * step);
  const tip = (i) => {
    if (i == null) return null;
    const parts = [`${MONTHS[i]}`];
    if (prevCum[i] != null && f.prevTotal > 0) parts.push(`${f.year - 1}: ${moneyK(prevCum[i])}`);
    if (i < f.month) parts.push(`${f.year}: ${moneyK(curCum[i])}`);
    else parts.push(`Forecast: ${moneyK(f.cumMid[i - f.month])} (${moneyK(f.cumLow[i - f.month])}–${moneyK(f.cumHigh[i - f.month])})`);
    return parts.join(' · ');
  };
  return (
    <div className="col" style={{ gap: 6, minWidth: 0 }}>
      <div className="row between wrap" style={{ gap: 12, alignItems: 'baseline' }}>
        <span style={{ fontWeight: 600 }}>Income through the year</span>
        <div className="row wrap small" style={{ gap: 16, color: 'var(--ink-2)' }}>
          <span className="row" style={{ gap: 6 }}><span style={{ width: 16, height: 2.5, borderRadius: 2, background: 'var(--accent)' }} />{f.year} so far</span>
          <span className="row" style={{ gap: 6 }}><span style={{ width: 16, height: 10, borderRadius: 3, borderTop: '2px dashed var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }} />Forecast &amp; likely range</span>
          {f.prevTotal > 0 && <span className="row" style={{ gap: 6 }}><span style={{ width: 16, height: 2, background: '#a3a4aa' }} />{f.year - 1}</span>}
        </div>
      </div>
      <div className="small" style={{ minHeight: 18, color: hover == null ? 'var(--muted)' : 'var(--ink-2)' }}>{tip(hover) || 'Hover or tap a month for totals'}</div>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${Wd} ${Ht + 4}`} preserveAspectRatio="none" style={{ width: '100%', height: 240, display: 'block', overflow: 'visible' }} role="img" aria-label="Cumulative income this year and forecast to December" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => <line key={t} x1="0" x2={Wd} y1={Y(t)} y2={Y(t)} stroke="#efefec" vectorEffect="non-scaling-stroke" />)}
          <line x1="0" x2={Wd} y1={Ht} y2={Ht} stroke="#dadad5" vectorEffect="non-scaling-stroke" />
          <polygon points={band} fill="var(--accent)" fillOpacity="0.1" />
          {f.prevTotal > 0 && <polyline points={pts(prevCum)} fill="none" stroke="#a3a4aa" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
          <polyline points={anchor + pts(f.cumMid, f.month)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
          {curCum.length > 0 && <polyline points={pts(curCum)} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
          {hover != null && <line x1={X(hover)} x2={X(hover)} y1="0" y2={Ht} stroke="#16161a" strokeOpacity="0.25" vectorEffect="non-scaling-stroke" />}
          {MONTHS.map((m, i) => <rect key={m} x={Math.max(0, X(i) - Wd / 22)} y="0" width={Wd / 11} height={Ht} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />)}
        </svg>
        {ticks.map((t) => <span key={t} className="num" style={{ position: 'absolute', left: 0, top: `${(Y(t) / (Ht + 4)) * 100}%`, transform: 'translateY(-115%)', fontSize: 11, color: 'var(--faint)', background: 'var(--surface)', paddingRight: 4 }}>{moneyK(t)}</span>)}
      </div>
      <div style={{ position: 'relative', height: 16 }}>
        {MONTHS.map((m, i) => (
          <span key={m} className="small muted" style={{ position: 'absolute', left: `${(X(i) / Wd) * 100}%`, transform: i === 0 ? 'none' : i === 11 ? 'translateX(-100%)' : 'translateX(-50%)', fontSize: 11, fontWeight: hover === i ? 600 : 400, color: hover === i ? 'var(--ink)' : undefined }}>
            <span className="m-full">{m}</span><span className="m-short">{m[0]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export { MONTHS };
