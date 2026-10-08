// Every table the app loads, in an order that respects references (parents first).
export const TABLES = [
  'clients',
  'projects',
  'catalog_items',
  'day_types',
  'tax_rates',
  'invoices',
  'receipts',
  'invoice_lines',
  'invoice_revisions',
  'invoice_events',
  'payments',
  'mileage_trips',
  'crew_members',
  'crew_payouts',
  'form1099',
];

// Columns each table's rows may carry when restoring a backup (everything except owner_id).
export const ORDER_FOR_RESTORE = TABLES;
