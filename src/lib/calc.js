// Invoice math: totals, overtime, advanced "jobs" → invoice lines, and status.
import { round2, money, datesCode, mmdd, todayISO, daysBetween, num } from './format.js';

export function lineAmount(qty, rate) {
  return round2(num(qty) * num(rate));
}

/** Subtotal, discount, tax and total for a list of lines. Discount is applied before tax. */
export function totals(lines, discountType = 'amount', discountValue = 0) {
  const subtotal = round2(lines.reduce((s, l) => s + num(l.amount), 0));
  let discount = discountType === 'percent' ? round2((subtotal * num(discountValue)) / 100) : round2(num(discountValue));
  discount = Math.min(Math.max(discount, 0), Math.max(subtotal, 0));
  const factor = subtotal > 0 ? (subtotal - discount) / subtotal : 1;
  const tax = round2(lines.reduce((s, l) => s + num(l.amount) * factor * (num(l.tax_rate) / 100), 0));
  return { subtotal, discount_total: discount, tax_total: tax, total: round2(subtotal - discount + tax) };
}

/** Overtime rules from the profile (optionally overridden per client). */
export function otRule(profile, client) {
  return {
    base: num(client?.ot_base_hours) || num(profile?.ot_base_hours) || 10,
    m1: num(profile?.ot_mult1) || 1.5,
    m1h: profile?.ot_mult1_hours != null ? num(profile.ot_mult1_hours) : 2,
    m2: num(profile?.ot_mult2) || 2,
  };
}

/** Pay for one day: day rate plus overtime (1.5× for the first hours past base, then 2×). */
export function dayPay(rate, hours, rule) {
  const hourly = rate / rule.base;
  const ot = Math.max(0, num(hours) - rule.base);
  const t1 = Math.min(ot, rule.m1h);
  const t2 = Math.max(0, ot - rule.m1h);
  return { pay: round2(rate + t1 * hourly * rule.m1 + t2 * hourly * rule.m2), ot, otPay: round2(t1 * hourly * rule.m1 + t2 * hourly * rule.m2) };
}

const money0 = (n) => (Number.isInteger(round2(n)) ? '$' + round2(n).toLocaleString('en-US') : money(n));

/** Pay for every day of a job, honoring day types (half day, travel...). OT only on full-rate days. */
export function jobLabor(job, rule, dayTypes) {
  const rate = num(job.rate);
  const days = [...(job.days || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const per = days.map((d) => {
    const dt = dayTypes?.find((t) => t.name === d.dayType);
    const mult = dt ? num(dt.multiplier) : 1;
    const base = round2(rate * mult);
    if (mult < 1) return { ...d, mult, base, pay: base, ot: 0, label: dt.name };
    const p = dayPay(base, d.hours ?? rule.base, rule);
    return { ...d, mult, base, pay: p.pay, ot: p.ot, label: mult === 1 ? null : dt?.name };
  });
  const total = round2(per.reduce((s, d) => s + d.pay, 0));
  const otHours = per.reduce((s, d) => s + d.ot, 0);
  return { per, total, otHours };
}

/** Turns the advanced editor's jobs into plain invoice lines (what the PDF shows). */
export function compileJobs(data, rule, dayTypes) {
  const lines = [];
  for (const job of data?.jobs || []) {
    const dates = (job.days || []).map((d) => d.date);
    if (!dates.length && !(job.expenses || []).length) continue;
    const code = datesCode(dates);
    const where = job.company ? `${job.company}${code ? ` (${code})` : ''}` : code;
    if (dates.length) {
      const { per, total, otHours } = jobLabor(job, rule, dayTypes);
      const simple = per.every((d) => d.mult === 1 && d.ot === 0);
      if (simple) {
        lines.push({ kind: 'labor', item: job.role || 'Labor', description: where, qty: per.length, rate: num(job.rate), amount: lineAmount(per.length, job.rate), note: '' });
      } else {
        const parts = per.map((d) => money0(d.base) + (d.label ? ` ${d.label.toLowerCase()}` : ''));
        const ot = otHours ? ` (plus ${otHours} hour${otHours === 1 ? '' : 's'} OT)` : '';
        lines.push({ kind: 'labor', item: job.role || 'Labor', description: where, qty: 1, rate: total, amount: total, note: parts.join(' + ') + ot });
      }
    }
    for (const g of job.gear || []) {
      if (!g.name) continue;
      lines.push({ kind: 'gear', item: g.name, description: where, qty: num(g.qty) || dates.length || 1, rate: num(g.rate), amount: lineAmount(num(g.qty) || dates.length || 1, g.rate), note: '' });
    }
    for (const e of job.expenses || []) {
      lines.push({
        kind: 'expense', item: e.type || 'Expense',
        description: e.note || `${job.company || ''}${e.date ? ` (${mmdd(e.date)})` : ''}`.trim(),
        qty: 1, rate: num(e.amount), amount: round2(num(e.amount)), receipt_id: e.receipt_id || null, note: '',
      });
    }
  }
  for (const o of data?.other || []) {
    if (!o.item && !num(o.amount)) continue;
    lines.push({ kind: o.kind || 'expense', item: o.item || 'Other', description: o.note || '', qty: 1, rate: num(o.amount), amount: round2(num(o.amount)), receipt_id: o.receipt_id || null, note: '' });
  }
  return lines;
}

export function paidFor(invoiceId, payments) {
  return round2(payments.filter((p) => p.invoice_id === invoiceId).reduce((s, p) => s + num(p.amount), 0));
}

/** What to show for an invoice right now: draft, sent, partial, overdue, paid, void (+ quote states). */
export function statusOf(inv, paid = 0, today = todayISO()) {
  if (inv.kind === 'quote') {
    const map = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', converted: 'Invoiced', void: 'Void' };
    return { key: inv.status === 'converted' ? 'converted' : inv.status, label: map[inv.status] || inv.status };
  }
  if (inv.status === 'void') return { key: 'void', label: 'Void' };
  if (inv.status === 'paid') return { key: 'paid', label: 'Paid' };
  if (inv.status === 'draft') return { key: 'draft', label: 'Draft' };
  if (inv.kind === 'invoice' && !inv.sent_at && paid <= 0) return { key: 'ready', label: 'Not sent' };
  const seen = Number(inv.view_count) > 0; // the client opened the link
  const overdue = inv.due_date && inv.due_date < today;
  if (overdue) {
    const d = daysBetween(inv.due_date, today);
    return { key: 'overdue', label: paid > 0 ? 'Partial · overdue' : 'Overdue', days: d, seen };
  }
  if (paid > 0) return { key: 'partial', label: 'Partially paid', seen };
  if (seen) return { key: 'seen', label: 'Seen', seen };
  return { key: 'sent', label: 'Sent', seen };
}

export function dueText(inv, today = todayISO()) {
  if (!inv.due_date) return '';
  const d = daysBetween(today, inv.due_date);
  if (d === 0) return 'Due today';
  if (d > 0) return `Due in ${d} day${d === 1 ? '' : 's'}`;
  return `${-d} day${d === -1 ? '' : 's'} overdue`;
}

export function depositAmount(inv) {
  return inv.deposit_percent ? round2((num(inv.total) * num(inv.deposit_percent)) / 100) : 0;
}

/** Next number after the highest numeric invoice number in use. */
export function suggestNextNumber(invoices, kind) {
  const nums = invoices.filter((i) => i.kind === kind).map((i) => parseInt(String(i.number).replace(/\D/g, ''), 10)).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) + 1 : 1;
}
