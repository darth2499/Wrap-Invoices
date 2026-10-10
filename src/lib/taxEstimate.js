// Rough US tax estimate for a sole proprietor (Schedule C), used for "what would this purchase save?".
// Federal income tax (2026 brackets, standard deduction, 20% QBI deduction), self-employment tax (Social Security
// up to the wage base + Medicare + 0.9% additional Medicare), and a flat state rate. A planning estimate only:
// it ignores credits, QBI limits at high incomes, AMT and state-specific rules.

const Y2026 = {
  single: { std: 16100, brackets: [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [Infinity, 0.37]], addlMedicare: 200000 },
  married: { std: 32200, brackets: [[24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [Infinity, 0.37]], addlMedicare: 250000 },
  ssWageBase: 184500,
};

function bracketTax(income, brackets) {
  let tax = 0;
  let prev = 0;
  for (const [top, rate] of brackets) {
    if (income <= prev) break;
    tax += (Math.min(income, top) - prev) * rate;
    prev = top;
  }
  return tax;
}

/** Taxes for a year's business profit: { federal, se, state, total }. other = other income (W-2, spouse's pay). */
export function taxFor(profit, { status = 'single', other = 0, stateRate = 0 } = {}) {
  const t = Y2026[status] || Y2026.single;
  const p = Math.max(0, profit);
  const seBase = p * 0.9235;
  const ss = 0.124 * Math.max(0, Math.min(seBase, Y2026.ssWageBase - Math.max(0, other)));
  const medicare = 0.029 * seBase;
  const addl = 0.009 * Math.max(0, seBase + Math.max(0, other) - t.addlMedicare);
  const se = ss + medicare + addl;
  const halfSe = (ss + medicare) / 2;
  const agi = p - halfSe + Math.max(0, other);
  const beforeQbi = Math.max(0, agi - t.std);
  const qbi = Math.min(0.2 * Math.max(0, p - halfSe), 0.2 * beforeQbi);
  const federal = bracketTax(beforeQbi - qbi, t.brackets);
  const state = Math.max(0, stateRate / 100) * Math.max(0, p - halfSe);
  return { federal, se, state, total: federal + se + state };
}

/** What deducting `amount` saves: { federal, se, state, total, rate } (rate = share of the amount you get back). */
export function savingsFor(amount, profit, opts) {
  const a = Math.max(0, amount);
  const before = taxFor(profit, opts);
  const after = taxFor(profit - a, opts);
  const out = { federal: before.federal - after.federal, se: before.se - after.se, state: before.state - after.state };
  out.total = out.federal + out.se + out.state;
  out.rate = a ? out.total / a : 0;
  return out;
}

/** A starting guess for the state rate from the business address (top common bracket; editable). */
export function guessStateRate(address) {
  const a = String(address || '');
  if (/\b(DC|D\.C\.)\b/.test(a)) return 8.5;
  if (/\b(CA|California)\b/.test(a)) return 9.3;
  if (/\b(NY|New York)\b/.test(a)) return 6.25;
  if (/\b(TX|Texas|FL|Florida|WA|Washington|NV|Nevada|TN|Tennessee|SD|WY|AK|NH)\b/.test(a)) return 0;
  return 5;
}
