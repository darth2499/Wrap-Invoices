// Receipts that learn from corrections. When you fix what the scanner read (the total, the date, the
// category), Wrap works out a simple rule about how that store prints its receipts, for example:
//   total_label: "amount charged"  (the total is on the "Amount charged" line, not "Total")
//   tip:         "add"             (a tip written after the printed total belongs in the total)
//   date_order:  "dmy"             (this store prints day/month)
//   category:    "Meals"
// Your own rules apply to your next receipt from that store right away. A rule is shared with everyone only once
// 3 different people taught Wrap the same thing (only the store name and the rule are shared: never amounts,
// dates, pictures or who). Plain JS (also used on the server, copied by scripts/sync-shared.mjs).
import { findDates } from './dateText.js';

const STORE_WORDS = /\b(store|location|branch|inc|llc|ltd|co|corp|the|no)\b/g;

/** One name per store, however the receipt writes it ("RANCHO MARKET #0123", "Rancho Market - Store 123"). */
export function vendorKey(v) {
  return String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/&/g, ' and ').replace(/[#№]\s*\d+/g, ' ').replace(/\b(store|location|unit|branch)\s*\d+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(STORE_WORDS, ' ').replace(/\b\d{2,}\b/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
export const labelKey = (l) => String(l || '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
const near = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.015;
const r2 = (n) => Math.round(Number(n) * 100) / 100;

/** What a correction teaches: compares what was read with what you saved. Returns [{ rule, value }]. */
export function deriveRules(read, final) {
  const out = [];
  if (!read || !final) return out;
  const total = final.total ?? final.total_paid;
  if (final.category && final.category !== 'Other') out.push({ rule: 'category', value: String(final.category) });
  if (total != null) {
    const amounts = Array.isArray(read.amounts) ? read.amounts : [];
    // Only a fix teaches which line the total is on (a reading that was already right needs no rule).
    if (!near(total, read.total_paid)) {
      const hit = amounts.find((a) => near(a.amount, total) && labelKey(a.label));
      if (hit) out.push({ rule: 'total_label', value: labelKey(hit.label) });
      else if (read.tip > 0 && near(total, r2(read.total_paid + read.tip))) out.push({ rule: 'tip', value: 'add' });
      else if (read.tip > 0 && near(total, r2(read.total_paid - read.tip))) out.push({ rule: 'tip', value: 'included' });
    }
  }
  const date = final.receipt_date ?? final.date;
  if (read.date_printed && date && read.date && read.date !== date) {
    for (const order of ['dmy', 'mdy']) {
      const f = findDates(String(read.date_printed), date, order);
      if (f?.dates?.[0] === date) { out.push({ rule: 'date_order', value: order }); break; }
    }
  }
  return out;
}

/** True when what you saved differs from what was read (counts toward the accuracy numbers). */
export function wasFixed(read, final) {
  if (!read || read.error) return false;
  const total = final.total ?? final.total_paid;
  return !near(total, read.total_paid) || (final.receipt_date ?? final.date) !== read.date || (!!read.category && final.category !== read.category);
}

/**
 * Applies learned rules ({ total_label, tip, date_order, category }) to what the scanner read.
 * Returns a copy with the fixes and `learned: [what changed]`. Never invents a number that isn't on the receipt.
 */
export function applyRules(read, rules, today = new Date().toISOString().slice(0, 10)) {
  if (!read || read.error || !rules || !Object.keys(rules).length) return read;
  const out = { ...read };
  const learned = [];
  const amounts = Array.isArray(read.amounts) ? read.amounts : [];
  if (rules.total_label) {
    const hit = amounts.find((a) => labelKey(a.label) === rules.total_label && a.amount > 0);
    if (hit && !near(hit.amount, out.total_paid)) {
      // The old total stays in the list, so it can still be picked.
      if (out.total_paid != null && !amounts.some((a) => near(a.amount, out.total_paid))) out.amounts = [...amounts, { label: read.total_label || 'Total', amount: out.total_paid }];
      out.total_paid = r2(hit.amount);
      out.total_label = hit.label;
      learned.push(`total from “${hit.label}”`);
    }
  }
  if (rules.tip === 'add' && out.tip > 0 && out.total_paid != null) {
    const bill = out.subtotal != null ? r2(out.subtotal + (out.tax ?? 0)) : null;
    if (bill != null ? near(bill, out.total_paid) : true) { out.total_paid = r2(out.total_paid + out.tip); learned.push('tip added'); }
  } else if (rules.tip === 'included' && out.tip > 0 && out.total_paid != null && out.subtotal != null && near(r2(out.subtotal + (out.tax ?? 0) + out.tip), r2(out.total_paid + out.tip))) {
    out.total_paid = r2(out.total_paid - out.tip);
    learned.push('tip already in the total');
  }
  if (rules.date_order && read.date_printed) {
    const f = findDates(String(read.date_printed), today, rules.date_order);
    const d = f?.dates?.[0];
    if (d && d <= today && d !== out.date) { out.date = d; learned.push(rules.date_order === 'dmy' ? 'day-first date' : 'month-first date'); }
  }
  if (rules.category && rules.category !== out.category) { out.category = rules.category; learned.push(`category ${rules.category}`); }
  if (!learned.length) return out;
  out.learned = [...(read.learned || []), ...learned];
  out.reasoning = `${read.reasoning ? `${read.reasoning} ` : ''}Adjusted from what Wrap learned about this store (${learned.join(', ')}).`.slice(0, 400);
  return out;
}

/** Your own rules for a store, from receipts you've already checked (the most recent one wins). */
export function personalRules(receipts, vendor) {
  const key = vendorKey(vendor);
  if (!key) return {};
  const rules = {};
  const mine = (receipts || [])
    .filter((r) => r.status !== 'review' && r.ai && !r.ai.error && !r.ai.manual && (vendorKey(r.vendor) === key || vendorKey(r.ai.vendor) === key))
    .sort((a, b) => String(a.updated_at || a.created_at || '').localeCompare(String(b.updated_at || b.created_at || '')));
  for (const r of mine) for (const { rule, value } of deriveRules(r.ai, r)) rules[rule] = value;
  return rules;
}
