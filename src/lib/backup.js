import { DEMO } from '../config.js';
// Full backup (all data + every receipt file in one .zip) and restore from that zip.
// jszip loads only when a zip is made or opened.
const loadZip = () => import('jszip').then((m) => m.default);
import { TABLES } from '../api/tables.js';
import { todayISO } from './format.js';

const PROFILE_FIELDS = [
  'business_name', 'business_email', 'address', 'phone', 'website', 'logo_key', 'template', 'accent', 'payment_instructions',
  'footer_note', 'next_invoice_number', 'next_quote_number', 'default_terms_days', 'ot_base_hours', 'ot_mult1', 'ot_mult1_hours',
  'ot_mult2', 'reminder_days', 'auto_remind_default', 'mileage_rate', 'tax_set_aside_pct',
];

function fileKeys(db) {
  const keys = [];
  for (const r of db.receipts) keys.push(r.file_key, r.original_key);
  keys.push(db.profile.logo_key);
  return [...new Set(keys.filter(Boolean))];
}

export async function exportBackup(api, db, onStep = () => {}) {
  if (DEMO) throw new Error('Not available in the demo');
  const zip = new (await loadZip())();
  const data = { app: 'wrap', format: 1, exported_at: new Date().toISOString(), owner_id: db.profile.id, profile: db.profile, tables: {} };
  for (const t of TABLES) data.tables[t] = db[t];
  zip.file('data.json', JSON.stringify(data, null, 1));
  zip.file('README.txt', 'Wrap backup. Restore it from Settings → Data → Restore from backup.\nfiles/ holds every receipt scan, original photo and your logo.\n');

  const keys = fileKeys(db);
  const urls = await api.files.urls(keys);
  let done = 0;
  const missing = [];
  const queue = [...keys];
  const worker = async () => {
    while (queue.length) {
      const k = queue.shift();
      try {
        if (!urls[k]) throw new Error('no url');
        const res = await fetch(urls[k]);
        if (!res.ok) throw new Error(String(res.status));
        zip.file(`files/${k}`, await res.blob());
      } catch {
        missing.push(k);
      }
      onStep(`Downloading files ${++done} / ${keys.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  onStep('Compressing…');
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, name: `wrap-backup-${todayISO()}.zip`, missing };
}

export async function readBackup(file) {
  const zip = await (await loadZip()).loadAsync(file);
  const json = zip.file('data.json');
  if (!json) throw new Error("This doesn't look like a Wrap backup (no data.json inside).");
  const data = JSON.parse(await json.async('string'));
  if (data.app !== 'wrap') throw new Error('This backup is from a different app.');
  const counts = Object.fromEntries(Object.entries(data.tables).map(([t, rows]) => [t, rows.length]));
  const files = Object.keys(zip.files).filter((n) => n.startsWith('files/') && !zip.files[n].dir);
  return { zip, data, counts, files };
}

/**
 * Restores a backup into the signed-in account.
 * mode 'replace': wipes current data first (exact copy of the backup).
 * mode 'merge':   keeps current data, adds/updates rows from the backup.
 */
export async function restoreBackup(api, { zip, data }, uid, mode, onStep = () => {}, current = null) {
  if (DEMO) throw new Error('Not available in the demo');
  const oldPrefix = `${data.owner_id}/`;
  const newPrefix = `${uid}/`;
  const remap = (k) => (k && k.startsWith(oldPrefix) ? newPrefix + k.slice(oldPrefix.length) : k);
  const merge = mode === 'merge' && current;
  const problems = [];

  if (mode === 'replace') {
    onStep('Clearing current data…');
    await api.rpc('wipe_my_data', {});
  }

  // Decide which rows to bring in. "Merge" only adds what's missing and never touches what you have.
  const has = (t) => new Set((current?.[t] || []).map((r) => r.id));
  const tables = {};
  for (const t of TABLES) tables[t] = (data.tables[t] || []).map(({ owner_id, ...rest }) => rest);
  if (merge) {
    for (const t of TABLES) {
      const ids = has(t);
      tables[t] = tables[t].filter((r) => !ids.has(r.id));
    }
    const numbers = new Set(current.invoices.map((i) => `${i.kind}:${i.number}`));
    tables.invoices = tables.invoices.filter((i) => !numbers.has(`${i.kind}:${i.number}`));
    const hashes = new Set(current.receipts.map((r) => r.file_hash).filter(Boolean));
    tables.receipts = tables.receipts.filter((r) => !r.file_hash || !hashes.has(r.file_hash));
    const dayNames = new Set(current.day_types.map((d) => d.name.toLowerCase()));
    tables.day_types = tables.day_types.filter((d) => !dayNames.has(d.name.toLowerCase()));
    const forms = new Set(current.form1099.map((f) => `${f.client_id}:${f.tax_year}`));
    tables.form1099 = tables.form1099.filter((f) => !forms.has(`${f.client_id}:${f.tax_year}`));
    // Children only for invoices we're actually adding (never duplicate lines of an invoice you already have).
    const newInv = new Set(tables.invoices.map((i) => i.id));
    for (const t of ['invoice_lines', 'invoice_revisions', 'invoice_events', 'payments']) tables[t] = tables[t].filter((r) => newInv.has(r.invoice_id));
    const allInv = new Set([...newInv, ...current.invoices.map((i) => i.id)]);
    const allClients = new Set([...tables.clients.map((c) => c.id), ...current.clients.map((c) => c.id)]);
    tables.invoices = tables.invoices.map((i) => ({ ...i, client_id: allClients.has(i.client_id) ? i.client_id : null }));
    tables.receipts = tables.receipts.map((r) => ({ ...r, invoice_id: allInv.has(r.invoice_id) ? r.invoice_id : null }));
  }

  // Files first, so restored receipts can show their images.
  const wanted = new Set();
  for (const r of tables.receipts) [r.file_key, r.original_key].forEach((k) => k && wanted.add(k));
  if (data.profile?.logo_key && !(merge && current.profile.logo_key)) wanted.add(data.profile.logo_key);
  const names = Object.keys(zip.files).filter((n) => n.startsWith('files/') && !zip.files[n].dir && wanted.has(n.slice('files/'.length)));
  let done = 0;
  const queue = [...names];
  const failed = [];
  const worker = async () => {
    while (queue.length) {
      const n = queue.shift();
      const key = remap(n.slice('files/'.length));
      try {
        if (!key.startsWith(newPrefix)) throw new Error('outside your folder');
        const blob = await zip.file(n).async('blob');
        const ext = key.split('.').pop();
        const typed = new Blob([blob], { type: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', webp: 'image/webp' }[ext] || 'application/octet-stream' });
        await api.files.upload(typed, { key });
      } catch {
        failed.push(key);
      }
      onStep(`Uploading files ${++done} / ${names.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  // Profile settings (in merge mode, only fill in what's empty).
  const p = {};
  for (const f of PROFILE_FIELDS) {
    if (!(f in (data.profile || {}))) continue;
    const v = f === 'logo_key' ? remap(data.profile[f]) : data.profile[f];
    if (merge && current.profile[f] != null && current.profile[f] !== '') continue;
    p[f] = v;
  }
  if (Object.keys(p).length) await api.updateProfile(p);

  // Tables, parents first. Cross-links between invoices and receipt→invoice links go in a second pass.
  const later = [];
  for (const t of TABLES) {
    let rows = tables[t];
    if (t === 'receipts') rows = rows.map((r) => ({ ...r, file_key: remap(r.file_key), original_key: remap(r.original_key), invoice_id: null }));
    if (t === 'invoices') {
      rows.forEach((r) => (r.quote_id || r.converted_invoice_id) && later.push({ id: r.id, quote_id: r.quote_id, converted_invoice_id: r.converted_invoice_id }));
      rows = rows.map((r) => ({ ...r, quote_id: null, converted_invoice_id: null }));
    }
    for (let i = 0; i < rows.length; i += 400) {
      onStep(`Restoring ${t.replace(/_/g, ' ')} (${Math.min(i + 400, rows.length)} / ${rows.length})`);
      try {
        await api.upsert(t, rows.slice(i, i + 400));
      } catch (e) {
        // Fall back to one row at a time so one bad row doesn't stop the rest.
        for (const row of rows.slice(i, i + 400)) {
          try { await api.upsert(t, [row]); } catch (err) { problems.push(`${t}: ${err.message}`); }
        }
      }
    }
  }
  onStep('Linking receipts to invoices…');
  for (const r of tables.receipts.filter((x) => x.invoice_id)) {
    try { await api.update('receipts', r.id, { invoice_id: r.invoice_id, billable: !!r.billable }); } catch (e) { problems.push(`receipt link: ${e.message}`); }
  }
  for (const l of later) {
    try { await api.update('invoices', l.id, { quote_id: l.quote_id, converted_invoice_id: l.converted_invoice_id }); } catch { /* the linked quote/invoice wasn't restored */ }
  }
  return { failed, problems, added: Object.fromEntries(TABLES.map((t) => [t, tables[t].length])) };
}
