// Sample data for demo mode, shaped like a freelance video person's real year.
import { uid, toISO, addDays, round2, datesCode } from '../lib/format.js';

// Bump this whenever the sample data changes, so browsers drop their old copy.
export const SEED_VERSION = 'v6';

const addDaysDate = (d, n) => new Date(d.getTime() + n * 86400000);

export function seedDemo(owner, token) {
  const now = new Date();
  const Y = now.getFullYear();
  const at = (y, m, d) => toISO(new Date(y, m, d, 12));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ts = (iso) => new Date(iso + 'T18:00:00').toISOString();
  const base = { owner_id: owner };

  const profile = {
    id: owner, email: 'demo@wrap.app', is_admin: true, business_name: 'Alex Rivera', business_email: 'you@example.com',
    address: '1600 Pennsylvania Avenue NW\nWashington, DC 20500', phone: '(555) 010-0199', website: '', logo_key: null,
    template: 'classic', accent: '#16161A', payment_instructions: 'Zelle: you@example.com\nOr check payable to Alex Rivera',
    footer_note: 'Thank you!', next_invoice_number: 1, next_quote_number: 1, default_terms_days: 30,
    ot_base_hours: 10, ot_mult1: 1.5, ot_mult1_hours: 2, ot_mult2: 2, reminder_days: [3, 7, 14], auto_remind_default: false,
    mileage_rate: 0.7, tax_set_aside_pct: 25, gmail_email: null,
  };

  const c = (name, email, extra = {}) => ({ ...base, id: uid(), name, email, cc_emails: null, address: null, phone: null, notes: null, ot_base_hours: null, expects_1099: true, statement_token: token(), archived: false, created_at: ts(at(Y - 1, 0, 2)), ...extra });
  const vuong = c('Warner Bros. Pictures', 'ap@warnerbros.example', { address: '4000 Warner Blvd\nBurbank, CA 91522' });
  const ben = c('Universal Pictures', 'invoices@universal.example', { expects_1099: false, address: '100 Universal City Plaza\nUniversal City, CA 91608' });
  const chad = c('Paramount Pictures', 'payables@paramount.example', { ot_base_hours: 12, address: '5555 Melrose Ave\nLos Angeles, CA 90038' });
  const simz = c('Sony Pictures', 'vendors@sonypictures.example', { address: '10202 W Washington Blvd\nCulver City, CA 90232' });
  const disney = c('Walt Disney Studios', 'ap@disneystudios.example', { address: '500 S Buena Vista St\nBurbank, CA 91521' });
  const lionsgate = c('Lionsgate', 'billing@lionsgate.example', { address: '2700 Colorado Ave\nSanta Monica, CA 90404' });
  const clients = [vuong, ben, chad, simz, disney, lionsgate];

  const item = (name, kind, unit, rate, pos, extra = {}) => ({ ...base, id: uid(), name, description: null, kind, unit, rate, week_rate: null, ot_eligible: kind === 'labor' && unit === 'day', archived: false, position: pos, created_at: ts(at(Y - 1, 0, 1)), ...extra });
  const catalog_items = [
    item('Camera Operator', 'labor', 'day', 750, 0),
    item('Sound Mixer', 'labor', 'day', 850, 1),
    item('Editing', 'labor', 'hour', 85, 2),
    item('Sound Gear', 'gear', 'day', 450, 3, { week_rate: 1800 }),
    item('Camera Package (FX6)', 'gear', 'day', 400, 4, { week_rate: 1600 }),
    item('Wireless Lav Kit', 'gear', 'day', 75, 5),
    item('Parking', 'expense', 'flat', 0, 6),
    item('Meal', 'expense', 'flat', 0, 7),
  ];
  const day_types = [
    ['Full day', 1], ['Half day', 0.6], ['Travel day', 0.5], ['Prep / wrap day', 0.5], ['Weather hold', 0.5],
    ['Cancellation (under 48 h)', 0.5], ['Cancellation (under 24 h)', 1],
  ].map(([name, multiplier], i) => ({ ...base, id: uid(), name, multiplier, position: i }));

  const companies = ['Press junket', 'BTS featurette', 'Premiere red carpet', 'Trailer pickups', 'EPK interviews', 'Studio tour promo', 'Cast Q&A', 'Set visit', 'Award campaign'];
  const invoices = [];
  const invoice_lines = [];
  const payments = [];
  const invoice_events = [];
  let n = 101;

  // Monthly invoices to the main client: last year and this year, growing over time.
  const lastMonth = now.getMonth() - (now.getDate() < 3 ? 2 : 1);
  for (let y = Y - 1; y <= Y; y++) {
    for (let m = 0; m < 12; m++) {
      if (y === Y && m > lastMonth) break;
      const issue = toISO(new Date(y, m + 1, 0, 12));
      const growth = y === Y ? 1.32 : 1;
      const season = [0.8, 0.85, 1, 1.05, 0.95, 0.9, 1.1, 1.15, 1.25, 1.3, 1.1, 1.35][m];
      const days = Math.max(4, Math.round(8 * growth * season + rnd() * 3));
      const id = uid();
      const lines = [];
      let d = 2;
      for (let k = 0; k < days; ) {
        const len = rnd() < 0.25 ? 2 : 1;
        const co = companies[Math.floor(rnd() * companies.length)];
        const dates = [];
        for (let j = 0; j < len && k < days; j++, k++) dates.push(at(y, m, Math.min(d++, 28)));
        d += Math.floor(rnd() * 2);
        const ot = rnd() < 0.15 ? 1 : 0;
        const amt = dates.length * 750 + ot * 112.5;
        lines.push(ot
          ? { kind: 'labor', item: 'Camera Operator', dates, description: `${co} (${datesCode(dates)})`, qty: 1, rate: amt, amount: amt, note: `${dates.map(() => '$750').join(' + ')} (plus 1 hour OT)` }
          : { kind: 'labor', item: 'Camera Operator', dates, description: `${co} (${datesCode(dates)})`, qty: dates.length, rate: 750, amount: amt, note: null });
        if (rnd() < 0.5) {
          const p = round2(15 + rnd() * 50);
          lines.push({ kind: 'expense', item: 'Parking', dates: [dates[0]], description: `${co} (${datesCode([dates[0]])})`, qty: 1, rate: p, amount: p, note: null });
        }
      }
      const total = round2(lines.reduce((s, l) => s + l.amount, 0));
      const due = addDays(issue, 30);
      const monthsAgo = (Y - y) * 12 + (now.getMonth() - m);
      const status = monthsAgo >= 6 ? 'paid' : 'sent';
      invoices.push({
        ...base, id, kind: 'invoice', number: String(n++), client_id: vuong.id, project_id: null, status, issue_date: issue, due_date: due,
        terms: 'Net 30', notes: `Month of ${new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long' })}`, mode: 'basic', jobs: null,
        discount_type: 'amount', discount_value: 0, deposit_percent: null, subtotal: total, discount_total: 0, tax_total: 0, total,
        share_token: token(), sent_at: ts(issue), first_viewed_at: ts(addDays(issue, 1)), last_viewed_at: ts(addDays(issue, 3)), view_count: 2,
        auto_remind: false, last_reminder_at: null, reminders_sent: 0, version: 1, quote_id: null, converted_invoice_id: null, voided_at: null,
        created_at: ts(issue), updated_at: ts(issue),
      });
      lines.forEach((l, i) => invoice_lines.push({ ...base, id: uid(), invoice_id: id, position: i, tax_rate: 0, day_type: null, receipt_id: null, ...l }));
      invoice_events.push({ ...base, id: uid(), invoice_id: id, type: 'sent', detail: 'Emailed to ap@warnerbros.example', created_at: ts(issue) });
      if (status === 'paid') payments.push({ ...base, id: uid(), invoice_id: id, paid_on: addDays(due, Math.floor(rnd() * 40)), amount: total, method: 'Bank transfer', note: null, created_at: ts(due) });
      else if (monthsAgo === 5) {
        payments.push({ ...base, id: uid(), invoice_id: id, paid_on: addDays(due, 50), amount: round2(total * 0.22), method: 'Bank transfer', note: null, created_at: ts(due) });
      }
    }
  }

  // A few one-off jobs for other clients.
  const oneOff = (client, issueISO, lines, status = 'sent', extra = {}) => {
    const id = uid();
    const total = round2(lines.reduce((s, l) => s + l.amount, 0));
    invoices.push({
      ...base, id, kind: 'invoice', number: String(n++), client_id: client.id, project_id: null, status, issue_date: issueISO,
      due_date: addDays(issueISO, 30), terms: 'Net 30', notes: null, mode: 'basic', jobs: null, discount_type: 'amount', discount_value: 0,
      deposit_percent: null, subtotal: total, discount_total: 0, tax_total: 0, total, share_token: status === 'draft' ? null : token(), sent_at: status === 'draft' ? null : ts(issueISO),
      first_viewed_at: null, last_viewed_at: null, view_count: 0, auto_remind: true, last_reminder_at: null, reminders_sent: 0, version: 1,
      quote_id: null, converted_invoice_id: null, voided_at: null, created_at: ts(issueISO), updated_at: ts(issueISO), ...extra,
    });
    lines.forEach((l, i) => invoice_lines.push({ ...base, id: uid(), invoice_id: id, position: i, tax_rate: 0, day_type: null, receipt_id: null, note: null, ...l }));
    if (status === 'paid') payments.push({ ...base, id: uid(), invoice_id: id, paid_on: addDays(issueISO, 20), amount: total, method: 'Zelle', note: null, created_at: ts(issueISO) });
    return id;
  };
  const recent = addDays(toISO(now), -8);
  const benInv = oneOff(ben, recent, [
    { kind: 'labor', item: 'Sound Mixer', dates: [recent], description: `Universal press day (${datesCode([recent])})`, qty: 1, rate: 850, amount: 850 },
    { kind: 'gear', item: 'Sound Gear', dates: [recent], description: `Lav kit + recorder (${datesCode([recent])})`, qty: 1, rate: 450, amount: 450 },
  ]);
  oneOff(chad, addDays(recent, -3), [{ kind: 'labor', item: 'Camera Operator', dates: [addDays(recent, -6), addDays(recent, -5)], description: `Brand shoot (${datesCode([addDays(recent, -6), addDays(recent, -5)])})`, qty: 2, rate: 750, amount: 1500 }, { kind: 'gear', item: 'Camera Package (FX6)', description: '2 days', qty: 2, rate: 400, amount: 800 }, { kind: 'expense', item: 'Meal', description: 'Crew lunch', qty: 1, rate: 200, amount: 200 }]);
  oneOff(simz, addDays(recent, -1), [{ kind: 'labor', item: 'Editing', description: 'Social cutdowns', qty: 8, rate: 85, amount: 680 }, { kind: 'expense', item: 'Music license', description: '', qty: 1, rate: 70, amount: 70 }]);
  oneOff(simz, at(Y - 1, 5, 12), [{ kind: 'labor', item: 'Sound Mixer', description: 'Doc interview', qty: 2, rate: 850, amount: 1700 }], 'paid');

  // Regular smaller jobs for the other clients over the past two years.
  const others = [ben, chad, simz, disney, lionsgate];
  const jobs = [
    [{ kind: 'labor', item: 'Sound Mixer', description: 'Interview day', qty: 1, rate: 850 }, { kind: 'gear', item: 'Sound Gear', description: 'Lav kit + recorder', qty: 1, rate: 300 }],
    [{ kind: 'labor', item: 'Camera Operator', description: 'Event coverage', qty: 1, rate: 750 }, { kind: 'expense', item: 'Parking', description: 'Event garage', qty: 1, rate: 28 }],
    [{ kind: 'labor', item: 'Editing', description: 'Recap edit', qty: 10, rate: 85 }],
    [{ kind: 'labor', item: 'Camera Operator', description: 'Brand shoot', qty: 2, rate: 750 }, { kind: 'gear', item: 'Camera Package (FX6)', description: '2 days', qty: 2, rate: 400 }],
  ];
  for (let k = 0; k < 24; k++) {
    const when = new Date(Y - 1, 0, 6 + k * 27 + Math.floor(rnd() * 9), 12);
    if (when > addDaysDate(now, -20)) break;
    const iso = toISO(when);
    const ls = jobs[Math.floor(rnd() * jobs.length)].map((l) => ({ ...l, dates: [iso], description: `${l.description} (${datesCode([iso])})`, amount: round2(l.qty * l.rate) }));
    oneOff(others[k % others.length], iso, ls, 'paid');
  }

  // A quote waiting on approval.
  const qid = uid();
  invoices.push({
    ...base, id: qid, kind: 'quote', number: '1', client_id: chad.id, project_id: null, status: 'sent', issue_date: addDays(toISO(now), -2),
    due_date: addDays(toISO(now), 28), terms: 'Valid 30 days', notes: '50% deposit to book', mode: 'basic', jobs: null, discount_type: 'amount', discount_value: 0,
    deposit_percent: 50, subtotal: 3350, discount_total: 0, tax_total: 0, total: 3350, share_token: token(), sent_at: ts(addDays(toISO(now), -2)),
    first_viewed_at: null, last_viewed_at: null, view_count: 0, auto_remind: false, last_reminder_at: null, reminders_sent: 0, version: 1,
    quote_id: null, converted_invoice_id: null, voided_at: null, created_at: ts(addDays(toISO(now), -2)), updated_at: ts(addDays(toISO(now), -2)),
  });
  [
    { kind: 'labor', item: 'Camera Operator', description: 'Product launch (2 days)', qty: 2, rate: 750, amount: 1500 },
    { kind: 'labor', item: 'Camera Operator', description: 'Travel day (Half day)', qty: 1, rate: 375, amount: 375, day_type: 'Travel day' },
    { kind: 'gear', item: 'Camera Package (FX6)', description: '2 days', qty: 2, rate: 400, amount: 800 },
    { kind: 'gear', item: 'Sound Gear', description: '1.5 days', qty: 1.5, rate: 450, amount: 675 },
  ].forEach((l, i) => invoice_lines.push({ ...base, id: uid(), invoice_id: qid, position: i, tax_rate: 0, receipt_id: null, note: null, day_type: null, ...l }));

  const r = (vendor, dISO, total, category, invoice_id = null, billable = false) => ({ ...base, id: uid(), vendor, receipt_date: dISO, total, subtotal: null, tax: null, tip: null, category, notes: null, file_key: null, original_key: null, mime: null, file_hash: null, status: 'confirmed', invoice_id, billable, ai: null, created_at: ts(dISO) });
  const receipts = [
    r('Parking', recent, 58.25, 'Parking & tolls', benInv, false),
    r('Hotel', addDays(recent, -4), 192.9, 'Travel', benInv, false),
  ];
  // A random-ish mix of everyday freelance spending over the past two years.
  const pool = [
    ['Gas station', 'Car & truck', 35, 70], ['Coffee shop', 'Meals', 6, 18], ['Taco truck', 'Meals', 9, 24], ['Diner', 'Meals', 14, 45],
    ['Parking garage', 'Parking & tolls', 12, 48], ['Bridge toll', 'Parking & tolls', 7, 8], ['Airline', 'Travel', 180, 520], ['Rideshare', 'Travel', 14, 62],
    ['Hotel', 'Travel', 140, 320], ['Camera store', 'Equipment (depreciation / Sec. 179)', 300, 2400], ['Batteries & media', 'Supplies', 25, 160],
    ['Gaffer tape & gels', 'Supplies', 18, 75], ['Editing software', 'Software & subscriptions', 20, 60], ['Cloud storage', 'Software & subscriptions', 10, 30],
    ['Gear insurance', 'Insurance', 300, 520], ['Phone bill', 'Utilities', 60, 95], ['Rental house', 'Equipment rental', 90, 650], ['Office supply store', 'Office expense', 12, 80],
  ];
  const start = new Date(Y - 1, 0, 3, 12);
  for (let d = new Date(start); d < addDaysDate(now, -1); d = addDaysDate(d, 3 + Math.floor(rnd() * 9))) {
    const [vendor, cat, lo, hi] = pool[Math.floor(rnd() * pool.length)];
    receipts.push(r(vendor, toISO(d), round2(lo + rnd() * (hi - lo)), cat));
  }

  const tony = { ...base, id: uid(), name: 'Casey Morgan', email: 'casey@example.com', phone: null, role: '1st AC', notes: null, created_at: ts(at(Y, 0, 1)) };
  const crew_members = [tony];
  const crew_payouts = [
    { ...base, id: uid(), crew_id: tony.id, work_date: at(Y, 3, 8), client_id: vuong.id, invoice_id: null, description: 'Press junket — AC', amount: 450, paid_on: at(Y, 3, 15), method: 'Venmo', created_at: ts(at(Y, 3, 8)) },
    { ...base, id: uid(), crew_id: tony.id, work_date: addDays(recent, -10), client_id: chad.id, invoice_id: null, description: 'Brand shoot — AC (2 days)', amount: 900, paid_on: null, method: null, created_at: ts(recent) },
  ];
  const mileage_trips = [
    { ...base, id: uid(), trip_date: addDays(recent, -2), start_place: 'Washington, DC', end_place: 'Arlington, VA', miles: 31, round_trip: true, purpose: 'Warner Bros. junket', client_id: vuong.id, invoice_id: null, billable: false, rate: 0.7, created_at: ts(recent) },
    { ...base, id: uid(), trip_date: recent, start_place: 'Washington, DC', end_place: 'Baltimore, MD', miles: 45, round_trip: true, purpose: 'Universal press day', client_id: ben.id, invoice_id: null, billable: true, rate: 0.7, created_at: ts(recent) },
  ];

  profile.next_invoice_number = n;
  profile.next_quote_number = 2;

  return {
    profile, invites: [{ email: 'demo@wrap.app', is_admin: true, created_at: ts(at(Y, 0, 1)) }],
    clients, projects: [{ ...base, id: uid(), client_id: vuong.id, name: 'Summit Labs sizzle reel', archived: false, created_at: ts(at(Y, 6, 1)) }],
    catalog_items, day_types, tax_rates: [], invoices, receipts, invoice_lines, invoice_revisions: [], invoice_events, payments,
    mileage_trips, crew_members, crew_payouts, form1099: [],
  };
}
