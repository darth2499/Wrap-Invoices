// Merging two clients (or two crew payees) that turned out to be the same: everything that pointed at the
// duplicate moves to the one you keep, the details you picked are saved on it, and the duplicate is removed.
// Returns an undo() that puts it all back.

const CLIENT_LINKS = ['invoices', 'projects', 'mileage_trips', 'crew_payouts'];
export const CLIENT_FIELDS = [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['address', 'Address'], ['cc_emails', 'CC emails'], ['contact_first', 'Contact first name'], ['contact_last', 'Contact last name'], ['notes', 'Notes']];
export const CREW_FIELDS = [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['role', 'Role'], ['address', 'Address'], ['notes', 'Notes']];

/** How many things point at each one (the busier one is kept by default). */
export function usage(s, kind, rec) {
  if (kind === 'crew') return s.db.crew_payouts.filter((p) => p.crew_id === rec.id).length;
  return CLIENT_LINKS.reduce((t, k) => t + (s.db[k] || []).filter((r) => r.client_id === rec.id).length, 0);
}

/** The merged details: your picks where both had something different, otherwise whichever one has it. */
export function mergedFields(kind, keep, drop, picks = {}) {
  const out = {};
  for (const [f] of kind === 'crew' ? CREW_FIELDS : CLIENT_FIELDS) {
    const a = keep[f];
    const b = drop[f];
    const v = picks[f] === 'drop' ? b : picks[f] === 'keep' ? a : (a == null || a === '') ? b : a;
    if (v !== a && v !== undefined) out[f] = v;
  }
  if (kind === 'client' && (keep.expects_1099 || drop.expects_1099) && !keep.expects_1099) out.expects_1099 = true;
  return out;
}

export async function mergeRecords(s, kind, keep, drop, picks = {}) {
  const table = kind === 'crew' ? 'crew_members' : 'clients';
  const before = { ...keep };
  const dropRow = { ...drop };
  const moved = []; // [table, id, field]
  const removed1099 = [];
  const links = kind === 'crew' ? [['crew_payouts', 'crew_id']] : CLIENT_LINKS.map((t) => [t, 'client_id']);
  for (const [t, f] of links) {
    for (const r of (s.db[t] || []).filter((x) => x[f] === drop.id)) {
      await s.update(t, r.id, { [f]: keep.id });
      moved.push([t, r.id, f]);
    }
  }
  if (kind === 'client') {
    // 1099 notes: one per client per year. Keep yours where both have one for the same year.
    for (const r of (s.db.form1099 || []).filter((x) => x.client_id === drop.id)) {
      const clash = s.db.form1099.some((x) => x.client_id === keep.id && x.tax_year === r.tax_year);
      if (clash) { await s.remove('form1099', r.id); removed1099.push(r); } else { await s.update('form1099', r.id, { client_id: keep.id }); moved.push(['form1099', r.id, 'client_id']); }
    }
  }
  const patch = mergedFields(kind, keep, drop, picks);
  if (Object.keys(patch).length) await s.update(table, keep.id, patch);
  await s.remove(table, drop.id);

  return async function undo() {
    const restored = { ...dropRow };
    delete restored.owner_id;
    await s.insert(table, restored);
    for (const [t, id, f] of moved) await s.update(t, id, { [f]: drop.id }).catch(() => {});
    for (const r of removed1099) { const x = { ...r }; delete x.owner_id; await s.insert('form1099', x).catch(() => {}); }
    const back = {};
    for (const k of Object.keys(patch)) back[k] = before[k] ?? null;
    if (Object.keys(back).length) await s.update(table, keep.id, back);
  };
}
