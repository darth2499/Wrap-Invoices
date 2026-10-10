// Sends what a checked receipt teaches the scanner (see scanRules.js) once you've confirmed or fixed it.
// Waits a moment so a few quick edits count once; each receipt is only sent again if what it teaches changes.
import { deriveRules, wasFixed } from './scanRules.js';

const timers = new Map();
const sent = new Map();

export function learnFromReceipt(api, r, markSent) {
  if (!api?.scanLearn || !r?.id || !r.ai || r.ai.error || r.ai.manual || r.status === 'review') return;
  const vendor = r.vendor || r.ai.vendor;
  if (!vendor) return;
  const rules = deriveRules(r.ai, r);
  const sig = JSON.stringify([vendor, rules]);
  if (r.ai.learned_sig === sig || sent.get(r.id) === sig) return;
  clearTimeout(timers.get(r.id));
  timers.set(r.id, setTimeout(async () => {
    sent.set(r.id, sig);
    try {
      await api.scanLearn({ vendor, rules, first: !r.ai.learned_sig, fixed: wasFixed(r.ai, r) });
      markSent?.(r, sig);
    } catch { sent.delete(r.id); /* tried again next time it's saved */ }
  }, 2500));
}
