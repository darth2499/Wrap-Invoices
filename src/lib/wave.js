// Reads Wave's "Accounting transactions" export (Settings → Data export → Export accounting CSV).
// It's a double-entry ledger, so invoices, payments and expenses are rebuilt from their rows:
//   Sales rows            → invoice line items (credit = positive amount)
//   Sales Discounts rows  → invoice discount (negative amounts)
//   Accounts Receivable   → positive = invoice total, negative = a payment on that invoice
//   Expense-group rows    → expenses (become receipts without an image)
// jszip loads only when a zip is made or opened.
const loadZip = () => import('jszip').then((m) => m.default);
import { round2, addDays } from './format.js';
import { parseCSV } from './files.js';
import { guessColumn } from './importer.js';

export function isWaveAccounting(headers) {
  const h = new Set(headers.map((x) => x.trim().toLowerCase()));
  return h.has('transaction id') && h.has('account name') && h.has('invoice number') && h.has('account group');
}

// Wave account → Wrap expense category (Schedule C). Anything unknown becomes "Other".
const CATEGORY = {
  'travel expense': 'Travel',
  'meals and entertainment': 'Meals',
  'equipment lease or rental': 'Equipment rental',
  'computer – hardware': 'Equipment (depreciation / Sec. 179)',
  'computer - hardware': 'Equipment (depreciation / Sec. 179)',
  'computer – software': 'Software & subscriptions',
  'computer - software': 'Software & subscriptions',
  'dues & subscriptions': 'Software & subscriptions',
  'vehicle – fuel': 'Car & truck',
  'vehicle - fuel': 'Car & truck',
  'vehicle – repairs & maintenance': 'Car & truck',
  'parking': 'Parking & tolls',
  'office supplies': 'Office expense',
  'subcontracted services': 'Contract labor',
  'advertising & promotion': 'Advertising',
  'insurance – vehicles': 'Insurance',
  'insurance': 'Insurance',
  'professional fees': 'Legal & professional',
  'accounting fees': 'Legal & professional',
  'bank service charges': 'Commissions & fees',
  'merchant account fees': 'Commissions & fees',
  'payment processing fees': 'Commissions & fees',
  'repairs & maintenance': 'Repairs & maintenance',
  'utilities': 'Utilities',
  'telephone – wireless': 'Utilities',
  'rent expense': 'Rent – other',
  'education & training': 'Education',
  'supplies': 'Supplies',
};

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * @returns {{ invoices: Array, expenses: Array, unpaidCount: number, unpaidTotal: number, from: string, to: string }}
 * invoices: [{ number, client, date, due, lines, discount, total, payments:[{date,amount,method}], amountDue }]
 */
export function parseWaveAccounting(rows, { termsDays = 30 } = {}) {
  const get = (r, k) => r[k] ?? r[Object.keys(r).find((x) => x.trim().toLowerCase() === k.toLowerCase())] ?? '';
  const inv = new Map();
  const expenses = [];
  let from = '9999';
  let to = '0000';

  for (const r of rows) {
    const date = get(r, 'Transaction Date');
    if (date) { if (date < from) from = date; if (date > to) to = date; }
    const account = get(r, 'Account Name');
    const group = get(r, 'Account Group');
    const amount = num(get(r, 'Amount (One column)'));
    const number = String(get(r, 'Invoice Number')).trim();

    if (number && ['Sales', 'Sales Discounts', 'Accounts Receivable'].includes(account)) {
      if (!inv.has(number)) inv.set(number, { number, client: '', date: '', notes: null, lines: [], discount: 0, total: 0, payments: [] });
      const it = inv.get(number);
      if (get(r, 'Customer')) it.client = get(r, 'Customer');
      if (account === 'Sales') {
        it.date = it.date || date;
        const desc = get(r, 'Transaction Description');
        let item = get(r, 'Transaction Line Description');
        if (desc && item.startsWith(`${desc} - `)) item = item.slice(desc.length + 3);
        // The memo is the invoice's notes (e.g. "Month of April"), repeated on every line.
        const memo = get(r, 'Notes / Memo');
        if (memo) it.notes = memo;
        it.lines.push({ kind: 'labor', item: item || 'Item', description: '', qty: 1, rate: round2(amount), amount: round2(amount) });
      } else if (account === 'Sales Discounts') {
        it.discount += -amount;
      } else if (amount > 0) {
        it.total += amount;
        it.date = it.date || date;
      } else if (amount < 0) {
        const other = get(r, 'Other Accounts for this Transaction');
        it.payments.push({ date, amount: round2(-amount), method: /payroll clearing|wave/i.test(other) ? 'Wave Payments' : null });
      }
      continue;
    }

    if (group === 'Expense' && amount !== 0) {
      const memo = get(r, 'Notes / Memo');
      const description = get(r, 'Transaction Description') || get(r, 'Transaction Line Description');
      expenses.push({
        date,
        vendor: memo || get(r, 'Vendor') || description.slice(0, 60) || account,
        notes: description && description !== memo ? description : null,
        category: CATEGORY[account.toLowerCase()] || 'Other',
        waveAccount: account,
        amount: round2(amount),
        waveId: get(r, 'Transaction ID'),
      });
    }
  }

  const invoices = [...inv.values()]
    .filter((i) => i.total > 0 || i.lines.length)
    .map((i) => {
      const linesTotal = round2(i.lines.reduce((s, l) => s + l.amount, 0));
      const total = round2(i.total || linesTotal - i.discount);
      const paid = round2(i.payments.reduce((s, p) => s + p.amount, 0));
      const date = i.date || i.payments[0]?.date || from;
      return {
        number: i.number,
        client: i.client,
        date,
        due: addDays(date, termsDays),
        lines: i.lines.length ? i.lines : [{ kind: 'labor', item: 'Imported invoice', description: 'From Wave', qty: 1, rate: total, amount: total }],
        discount: round2(i.discount),
        total,
        payments: i.payments,
        amountDue: round2(Math.max(0, total - paid)),
        notes: i.notes,
        source: 'wave',
      };
    })
    .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));

  const unpaid = invoices.filter((i) => i.amountDue > 0.009);
  return {
    invoices,
    expenses,
    unpaidCount: unpaid.length,
    unpaidTotal: round2(unpaid.reduce((s, i) => s + i.amountDue, 0)),
    from,
    to,
  };
}

/** A customer list: has a name column plus some way to reach them, and isn't the accounting ledger. */
export function isCustomerList(headers) {
  const name = guessColumn(headers, ['customer name', 'customer_name', 'company name', 'name']);
  const reach = guessColumn(headers, ['email', 'phone', 'address line 1', 'address_line_1', 'city']);
  return !!name && !!reach && !isWaveAccounting(headers);
}

/**
 * Takes what the person picked (Wave's .zip, or the CSVs themselves) and sorts out which file is which
 * by looking at the columns, not the file names.
 * @returns {{ accounting: {headers, rows}|null, customers: {headers, rows}|null, names: {accounting: string[], customers: string[]}, ignored: string[] }}
 */
export async function readWaveFiles(files) {
  const csvs = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name) || /zip/.test(f.type)) {
      const zip = await (await loadZip()).loadAsync(f);
      for (const e of Object.values(zip.files)) {
        if (e.dir || e.name.includes('__MACOSX') || !/\.csv$/i.test(e.name)) continue;
        csvs.push({ name: e.name.split('/').pop(), text: await e.async('string') });
      }
    } else if (/\.csv$/i.test(f.name)) {
      csvs.push({ name: f.name, text: await f.text() });
    }
  }
  const out = { accounting: null, customers: null, names: { accounting: [], customers: [] }, ignored: [] };
  const add = (kind, name, csv) => {
    out.names[kind].push(name);
    if (!out[kind]) out[kind] = { headers: csv.headers, rows: [...csv.rows] };
    else out[kind].rows.push(...csv.rows); // e.g. one accounting export per year
  };
  for (const c of csvs) {
    const csv = parseCSV(c.text);
    if (isWaveAccounting(csv.headers)) add('accounting', c.name, csv);
    else if (isCustomerList(csv.headers)) add('customers', c.name, csv);
    else out.ignored.push(c.name);
  }
  return out;
}
