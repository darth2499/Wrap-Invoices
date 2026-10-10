// "Possible duplicates": clients (or crew payees) that look like the same person. Shows both side by side,
// lets you pick which details to keep where they differ, and merges them (with Undo). Shown only when there are any.
import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { Button, Icon, Modal } from './ui.jsx';
import { findDuplicates, pairKey } from '../lib/match.js';
import { CLIENT_FIELDS, CREW_FIELDS, mergeRecords, usage } from '../lib/merge.js';
import { plural } from '../lib/format.js';

const SKIP_KEY = 'wrap_not_dupes';
const loadSkip = () => { try { return new Set(JSON.parse(localStorage.getItem(SKIP_KEY)) || []); } catch { return new Set(); } };

export function useDuplicates(kind) {
  const { db } = useStore();
  const [skip, setSkip] = useState(loadSkip);
  const list = kind === 'crew' ? db.crew_members : db.clients.filter((c) => !c.archived);
  const pairs = useMemo(() => findDuplicates(list, { skip }), [list, skip]);
  const notSame = (p) => {
    const next = new Set([...skip, pairKey(p.a, p.b)]);
    setSkip(next);
    try { localStorage.setItem(SKIP_KEY, JSON.stringify([...next].slice(-500))); } catch { /* not saved */ }
  };
  return { pairs, notSame };
}

/** A small pill in the page header, only when there's something to look at. */
export function DuplicatesButton({ kind }) {
  const { pairs, notSame } = useDuplicates(kind);
  const [open, setOpen] = useState(false);
  if (!pairs.length) return null;
  return (
    <>
      <Button icon="user" onClick={() => setOpen(true)}>{plural(pairs.length, 'possible duplicate')}</Button>
      {open && <DuplicatesModal kind={kind} pairs={pairs} notSame={notSame} onClose={() => setOpen(false)} />}
    </>
  );
}

function DuplicatesModal({ kind, pairs, notSame, onClose }) {
  const p = pairs[0];
  if (!p) return null;
  return (
    <Modal title={kind === 'crew' ? 'Same person?' : 'Same client?'} onClose={onClose}>
      {pairs.length > 1 && <span className="small muted">{pairs.length} to look at</span>}
      <MergeCard key={pairKey(p.a, p.b)} kind={kind} a={p.a} b={p.b} why={p.why} onNotSame={() => notSame(p)} onMerged={() => pairs.length <= 1 && onClose()} />
    </Modal>
  );
}

/** Both records side by side; where they differ you tap the value to keep. */
export function MergeCard({ kind, a, b, why = [], onNotSame, onMerged, mergeLabel = 'Merge' }) {
  const s = useStore();
  // Keep the one with more invoices/payouts; the other is merged into it.
  const [keep, drop] = usage(s, kind, b) > usage(s, kind, a) ? [b, a] : [a, b];
  const fields = (kind === 'crew' ? CREW_FIELDS : CLIENT_FIELDS).filter(([f]) => keep[f] || drop[f]);
  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState(false);
  const merge = async () => {
    setBusy(true);
    try {
      const undo = await mergeRecords(s, kind, keep, drop, picks);
      s.toast(`Merged into ${picks.name === 'drop' ? drop.name : keep.name}`, { action: { label: 'Undo', run: () => undo().catch((e) => s.toast(e.message, { error: true })) }, ms: 8000 });
      onMerged?.();
    } catch (e) { s.toast(e.message, { error: true }); }
    setBusy(false);
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      {why.length > 0 && <span className="small muted">{why.join(' · ')}</span>}
      <div className="merge-grid">
        {fields.map(([f, label]) => {
          const x = keep[f] || '';
          const y = drop[f] || '';
          const differ = x && y && String(x).trim().toLowerCase() !== String(y).trim().toLowerCase();
          const pick = picks[f] || 'keep';
          return (
            <div key={f} className="merge-row">
              <span className="small muted">{label}</span>
              {differ ? (
                <div className="merge-opts">
                  {[['keep', x], ['drop', y]].map(([k, v]) => (
                    <button key={k} type="button" className={`merge-opt ${pick === k ? 'on' : ''}`} onClick={() => setPicks({ ...picks, [f]: k })} aria-pressed={pick === k}>
                      <span className="merge-dot">{pick === k && <Icon name="check" size={12} />}</span><span style={{ whiteSpace: 'pre-line' }}>{v}</span>
                    </button>
                  ))}
                </div>
              ) : <span className="merge-same" style={{ whiteSpace: 'pre-line' }}>{x || y}</span>}
            </div>
          );
        })}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onNotSame}>Not the same</Button>
        <Button variant="primary" busy={busy} onClick={merge}>{mergeLabel}</Button>
      </div>
    </div>
  );
}
