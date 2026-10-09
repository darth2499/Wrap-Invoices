// IRS standard business mileage rates ($ per mile), by year. Add the new rate each December when the IRS announces it.
// 2026: IR-2025-128 (72.5¢). 2022 changed mid-year (58.5¢ → 62.5¢ from July 1).
import { num, todayISO } from './format.js';

export const IRS_RATES = { 2021: 0.56, 2022: 0.585, 2023: 0.655, 2024: 0.67, 2025: 0.7, 2026: 0.725 };
const YEARS = Object.keys(IRS_RATES).map(Number).sort((a, b) => a - b);

/** IRS rate for a date (YYYY-MM-DD). Years after the table use the newest known rate. */
export function irsRate(date = todayISO()) {
  const y = Number(String(date).slice(0, 4)) || YEARS[YEARS.length - 1];
  if (y === 2022 && String(date).slice(5) >= '07-01') return 0.625;
  const yr = YEARS.filter((x) => x <= y).pop() ?? YEARS[0];
  return IRS_RATES[yr];
}

/** True when the saved rate is one of the IRS rates, i.e. you haven't set your own. */
export const followsIrs = (rate) => rate == null || Object.values(IRS_RATES).concat(0.625).some((r) => Math.abs(r - num(rate)) < 0.0005);

/** The rate to use for a trip on this date: the IRS rate for that year, unless you set your own in Settings. */
export const rateFor = (profile, date) => (followsIrs(profile?.mileage_rate) ? irsRate(date) : num(profile.mileage_rate));
