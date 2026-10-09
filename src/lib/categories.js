// Expense categories, mapped to IRS Schedule C lines. Keep in sync with supabase/functions/receipt-read.
export const CATEGORIES = [
  { name: 'Advertising', line: '8' },
  { name: 'Car & truck', line: '9' },
  { name: 'Parking & tolls', line: '9' },
  { name: 'Commissions & fees', line: '10' },
  { name: 'Contract labor', line: '11' },
  { name: 'Equipment (depreciation / Sec. 179)', line: '13' },
  { name: 'Insurance', line: '15' },
  { name: 'Legal & professional', line: '17' },
  { name: 'Office expense', line: '18' },
  { name: 'Equipment rental', line: '20a' },
  { name: 'Rent – other', line: '20b' },
  { name: 'Repairs & maintenance', line: '21' },
  { name: 'Supplies', line: '22' },
  { name: 'Taxes & licenses', line: '23' },
  { name: 'Travel', line: '24a' },
  { name: 'Meals', line: '24b' },
  { name: 'Utilities', line: '25' },
  { name: 'Software & subscriptions', line: '27a' },
  { name: 'Education', line: '27a' },
  { name: 'Other', line: '27a' },
];
export const categoryLabel = (name) => name || 'Uncategorized';

/** The categories you use: the built-in ones you haven't removed, plus your own (Settings → Expense categories). */
export function categoryList(profile = {}) {
  const hidden = new Set(profile.hidden_categories || []);
  const own = (profile.custom_categories || []).filter(Boolean).map((name) => ({ name, line: '27a', custom: true }));
  return [...CATEGORIES.filter((c) => !hidden.has(c.name)), ...own.filter((c) => !CATEGORIES.some((d) => d.name === c.name))];
}
export const lineFor = (name) => CATEGORIES.find((x) => x.name === name)?.line || '27a';
