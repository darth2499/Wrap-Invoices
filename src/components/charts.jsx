// Small, dependency-free charts.
import { useState } from 'react';
import { money, moneyK } from '../lib/format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Grouped monthly bars: series = [{ name, color, values[] }], labels = [] */
export function MonthBars({ labels, series, height = 180 }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row wrap small" style={{ gap: 16, color: 'var(--ink-2)', minHeight: 20 }}>
        {series.map((s) => (
          <span key={s.name} className="row" style={{ gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />{s.name}
            {hover != null && <strong className="num" style={{ marginLeft: 4 }}>{money(s.values[hover], { cents: false })}</strong>}
          </span>
        ))}
        {hover != null && <span className="muted">{labels[hover]}</span>}
      </div>
      <div className="table-wrap">
        <div style={{ minWidth: 480 }}>
          <div className="bar-chart" style={{ height }} onMouseLeave={() => setHover(null)}>
            {labels.map((l, i) => (
              <div key={l + i} className="bar-col" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${l}: ${series.map((s) => `${s.name} ${money(s.values[i], { cents: false })}`).join(', ')}`} style={{ opacity: hover == null || hover === i ? 1 : 0.55 }}>
                {series.map((s) => (
                  <div key={s.name} className="bar" style={{ height: `${Math.max(1, (s.values[i] / max) * 100)}%`, background: s.color }} />
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))`, gap: 8, paddingTop: 6 }}>
            {labels.map((l, i) => <span key={i} className="small muted" style={{ textAlign: 'center' }}>{l}</span>)}
          </div>
        </div>
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
  const top = Math.max(1, ...prevCum, f.high, ...curCum) * 1.08;
  const Wd = 600;
  const Ht = 210;
  const X = (i) => (i * Wd) / 11;
  const Y = (v) => Ht - (v / top) * (Ht - 10);
  const pts = (arr, off = 0) => arr.map((v, i) => `${X(i + off).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const startX = f.month - 1;
  const startV = curCum[curCum.length - 1] || 0;
  const anchor = startX >= 0 ? `${X(startX).toFixed(1)},${Y(startV).toFixed(1)} ` : '';
  const band = anchor + pts(f.cumHigh, f.month) + ' ' + f.cumLow.map((v, i) => `${X(f.month + i).toFixed(1)},${Y(v).toFixed(1)}`).reverse().join(' ') + (startX >= 0 ? ` ${X(startX).toFixed(1)},${Y(startV).toFixed(1)}` : '');
  const ticks = [0.25, 0.5, 0.75, 1].map((t) => top * t);
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
      <div className="row wrap small" style={{ gap: 16, color: 'var(--ink-2)' }}>
        <span className="row" style={{ gap: 6 }}><span style={{ width: 16, height: 2, background: 'var(--accent)' }} />{f.year} so far</span>
        <span className="row" style={{ gap: 6 }}><span style={{ width: 16, borderTop: '2px dashed var(--accent)' }} />Forecast + likely range</span>
        {f.prevTotal > 0 && <span className="row" style={{ gap: 6 }}><span style={{ width: 16, height: 2, background: '#a3a4aa' }} />{f.year - 1}</span>}
      </div>
      <div className="small muted" style={{ minHeight: 18 }}>{tip(hover) || 'Hover the chart for month-by-month totals'}</div>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${Wd} ${Ht + 4}`} preserveAspectRatio="none" style={{ width: '100%', height: 210, display: 'block', overflow: 'visible' }} role="img" aria-label="Cumulative income this year and forecast to December" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => <line key={t} x1="0" x2={Wd} y1={Y(t)} y2={Y(t)} stroke="#efefec" vectorEffect="non-scaling-stroke" />)}
          <line x1="0" x2={Wd} y1={Ht} y2={Ht} stroke="#dadad5" vectorEffect="non-scaling-stroke" />
          <polygon points={band} fill="var(--accent)" fillOpacity="0.1" />
          {f.prevTotal > 0 && <polyline points={pts(prevCum)} fill="none" stroke="#a3a4aa" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
          <polyline points={anchor + pts(f.cumMid, f.month)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
          {curCum.length > 0 && <polyline points={pts(curCum)} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
          {hover != null && <line x1={X(hover)} x2={X(hover)} y1="0" y2={Ht} stroke="#16161a" strokeOpacity="0.25" vectorEffect="non-scaling-stroke" />}
          {MONTHS.map((m, i) => <rect key={m} x={Math.max(0, X(i) - Wd / 22)} y="0" width={Wd / 11} height={Ht} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        </svg>
        {ticks.slice(1).map((t) => <span key={t} className="small muted" style={{ position: 'absolute', right: 0, top: `${(Y(t) / (Ht + 4)) * 100}%`, transform: 'translateY(-100%)', fontSize: 11 }}>{moneyK(t)}</span>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' }}>
        {MONTHS.map((m) => <span key={m} className="small muted" style={{ fontSize: 11 }}>{m}</span>)}
      </div>
    </div>
  );
}

export { MONTHS };
