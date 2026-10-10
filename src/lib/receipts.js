// The full "add a receipt" pipeline: duplicate check → scan → upload → read with AI → duplicate check again → save.
import { sha256, extFor } from './files.js';
import { scanReceipt, shrinkOriginal, compressPhoto, orientationChoices, turnedFile, textDirection } from './scan.js';
import { round2 } from './format.js';
import { pdfText, pdfFirstPageImage, pdfToJpeg, blobToBase64 } from './pdftext.js';
import { readOnDevice } from './localRead.js';
import { applyRules, personalRules } from './scanRules.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Degrees to turn a photo clockwise so its text is upright (0 when unsure).
 * Most photos are already upright, so first a free on-device check: if the printed lines run across, it's left
 * as is (no reader call). Only a sideways or unclear photo goes to the reader to pick which way is up.
 * force: skip the free check (used when reading came back empty, e.g. an upside-down photo).
 */
export async function uprightTurn(api, file, { force = false } = {}) {
  try {
    if (!force && (await textDirection(file)) === 'horizontal') return 0;
    const { options, picture } = await orientationChoices(file);
    const res = await api.readReceipt(null, 'image/jpeg', { mode: 'upright', image_b64: await blobToBase64(picture), image_mime: 'image/jpeg' });
    return options['ABCD'.indexOf(res?.upright)] || 0;
  } catch {
    return 0;
  }
}

/** True if two receipts look like the same purchase (same day, same total, similar vendor). */
export function looksSame(a, b) {
  if (!a.receipt_date || !b.receipt_date || a.receipt_date !== b.receipt_date) return false;
  if (a.total == null || b.total == null || Math.abs(Number(a.total) - Number(b.total)) > 0.009) return false;
  const va = norm(a.vendor);
  const vb = norm(b.vendor);
  if (!va || !vb) return true;
  return va.includes(vb) || vb.includes(va) || va.slice(0, 5) === vb.slice(0, 5);
}

/**
 * Adds one receipt file. Returns { status: 'added'|'duplicate'|'error', receipt?, message }.
 * ctx: { api, receipts (existing list), onStep(text) }
 */
export const BIG_PDF = 5 * 1024 * 1024;

export async function withLearning(api, ai, receipts) {
  if (!ai || ai.error || !ai.vendor) return ai;
  let out = ai;
  if (ai.reader === 'device' && api.scanRules) {
    try { out = applyRules(out, (await api.scanRules(ai.vendor))?.rules); } catch { /* offline: your own rules still apply */ }
  }
  return applyRules(out, personalRules(receipts, ai.vendor));
}
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** A PDF over 5 MB: offer to keep a JPEG of its pages instead. Returns the JPEG blob, or null to keep the PDF. */
async function maybeShrinkPdf(file, confirm) {
  if (file.size <= BIG_PDF || !confirm) return null;
  try {
    const { blob } = await pdfToJpeg(file);
    if (!blob || blob.size >= file.size * 0.7) return null;
    const ok = await confirm({
      title: 'Save a smaller copy?',
      body: `This PDF is ${mb(file.size)}. Saved as a picture it's ${mb(blob.size)}.`,
      ok: 'Save smaller copy', cancel: 'Keep PDF',
    });
    return ok ? blob : null;
  } catch {
    return null;
  }
}

// store=false (User plan): the photo/PDF is read for its details, then thrown away; only the details are saved.
export async function addReceiptFile(file, { api, receipts, onStep = () => {}, invoiceId = null, billable = false, mode = 'clean', confirm = null, store = true }) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
  if (!isPdf && !isImage) return { status: 'error', message: `${file.name}: only photos and PDFs can be added` };

  onStep('Checking for duplicates…');
  const hash = await sha256(file);
  const same = receipts.find((r) => r.file_hash === hash);
  if (same) return { status: 'duplicate', message: `${file.name} is already saved (${same.vendor || 'receipt'}${same.total != null ? `, $${Number(same.total).toFixed(2)}` : ''}) — skipped.`, existing: same };

  const uploaded = [];
  try {
    let fileKey;
    let originalKey = null;
    let mime;
    let cropped = false;
    let readWith = {};
    let scanned = null;
    let photo = file;
    let turn = 0;
    if (isPdf) {
      onStep('Reading the PDF…');
      try {
        const text = await pdfText(file, 3);
        if (text.replace(/\s/g, '').length > 30) readWith = { text };
        else readWith = { image_b64: await blobToBase64(await pdfFirstPageImage(file)), image_mime: 'image/jpeg' };
      } catch (e) {
        console.warn('PDF read failed', e);
      }
      if (store) {
        const jpg = await maybeShrinkPdf(file, confirm);
        onStep('Uploading…');
        mime = jpg ? 'image/jpeg' : 'application/pdf';
        fileKey = await api.files.upload(jpg || file, { folder: 'receipts', ext: jpg ? 'jpg' : 'pdf' });
        uploaded.push(fileKey);
      }
    } else {
      onStep('Turning it the right way up…');
      turn = await uprightTurn(api, file);
      photo = await turnedFile(file, turn).catch(() => file);
      onStep('Straightening and cleaning up…');
      let scan;
      try {
        scan = await scanReceipt(photo, { mode });
      } catch (e) {
        return { status: 'error', message: `${file.name}: this photo format can't be opened here. Try a JPEG or PNG. (${e.message})` };
      }
      cropped = scan.cropped;
      scanned = scan;
      mime = 'image/jpeg';
      readWith = { image_b64: await blobToBase64(scan.read), image_mime: 'image/jpeg' };
    }

    onStep('Reading the receipt…');
    let ai = null;
    try {
      ai = await api.readReceipt(fileKey, mime, readWith);
    } catch (e) {
      ai = { error: e.message, status: e.status };
    }
    // The online reader is used up for the day, or can't be reached: read it on this device instead.
    if (ai?.error && (!ai.status || ai.status === 429 || ai.status >= 500)) {
      onStep('Reading on this device…');
      try {
        const local = await readOnDevice(isPdf
          ? { pdfText: readWith.text, photo: readWith.text ? null : await pdfFirstPageImage(file) }
          : { photo: file });
        if (!isPdf && local.turn) { // it found the right way up: keep the photo that way too
          photo = await turnedFile(file, local.turn).catch(() => file);
          scanned = await scanReceipt(photo, { mode }).catch(() => scanned);
        }
        turn = -1; // (don't ask the online reader about rotation below)
        ai = local;
      } catch (e) {
        console.warn('On-device reading failed', e);
      }
    }
    // Nothing readable on a photo the free check called upright: it may be upside down. Ask which way is up
    // (only now, so most receipts cost one reader call), and if it should turn, read it again.
    if (!isPdf && !ai?.error && turn === 0 && ai?.reader !== 'device' && (ai?.total_paid == null || ai?.is_receipt === false)) {
      const again = await uprightTurn(api, file, { force: true });
      if (again) {
        onStep('Turning it the right way up…');
        photo = await turnedFile(file, again).catch(() => file);
        try {
          scanned = await scanReceipt(photo, { mode });
          cropped = scanned.cropped;
          onStep('Reading the receipt…');
          ai = await api.readReceipt(null, mime, { image_b64: await blobToBase64(scanned.read), image_mime: 'image/jpeg' });
        } catch (e) { ai = { error: e.message }; }
      }
    }
    // What Wrap has learned about this store: from everyone (already applied by the online reader; fetched here for
    // on-device reads), then your own corrections on top.
    ai = await withLearning(api, ai, receipts);
    if (!store) mime = null; // nothing kept
    if (!isPdf && store) {
      // Read first (from the sharp copy), then store the compressed copies.
      onStep('Uploading…');
      const original = await shrinkOriginal(photo);
      [fileKey, originalKey] = await Promise.all([
        api.files.upload(scanned.scan, { folder: 'receipts', ext: 'jpg' }),
        api.files.upload(original, { folder: 'originals', ext: extFor(original.type, 'jpg') }),
      ]);
      uploaded.push(fileKey, originalKey);
    }
    const row = {
      vendor: ai?.vendor || null,
      receipt_date: /^\d{4}-\d{2}-\d{2}$/.test(ai?.date || '') ? ai.date : null,
      total: ai?.total_paid != null ? round2(ai.total_paid) : null,
      subtotal: ai?.subtotal ?? null,
      tax: ai?.tax ?? null,
      tip: ai?.tip ?? null,
      category: ai?.category || null,
      file_key: fileKey,
      original_key: originalKey,
      mime,
      file_hash: hash,
      status: 'review',
      invoice_id: invoiceId,
      billable,
      ai: { ...(ai || {}), cropped, file_name: file.name, compressed: true },
    };

    const twin = receipts.find((r) => looksSame(r, row));
    if (twin) {
      // Same day + same amount + same place: almost certainly the same receipt (e.g. emailed copy + photo).
      // The caller can still keep it (two identical parking stubs happen) — otherwise discard() cleans up.
      return {
        status: 'duplicate', fuzzy: true, row,
        message: `${row.vendor || file.name} on ${row.receipt_date} for $${row.total?.toFixed(2)} looks like one you already saved — skipped.`,
        existing: twin,
        keep: () => api.insert('receipts', { ...row, ai: { ...row.ai, kept_possible_duplicate: true } }),
        discard: () => api.files.remove(uploaded).catch(() => {}),
      };
    }

    onStep('Saving…');
    try {
      const saved = await api.insert('receipts', row);
      // Not stored (User plan): hand back what was scanned, so it can be shown while checking the details.
      const preview = store ? null : isPdf ? file : scanned?.scan || null;
      return { status: 'added', receipt: saved, preview, message: ai?.error ? `Saved, but couldn't read it automatically: ${ai.error}` : null };
    } catch (e) {
      if (/file_hash/.test(e.message)) {
        await api.files.remove(uploaded);
        return { status: 'duplicate', message: `${file.name} is already saved — skipped.` };
      }
      throw e;
    }
  } catch (e) {
    await api.files.remove(uploaded).catch(() => {});
    return { status: 'error', message: `${file.name}: ${e.message}` };
  }
}

/**
 * Puts a file on an existing receipt (one imported without a file, or a swap). Photos are stored as taken
 * (no cleanup), turned upright and compressed. Old files are deleted after the new ones are saved.
 */
export async function attachToReceipt(s, r, file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
  if (!isPdf && !isImage) throw new Error('Only photos and PDFs can be added');
  const hash = await sha256(file);
  const up = (blob, folder, ext) => s.api.files.upload(blob, { folder, ext });
  let patch;
  const twin = s.db.receipts.find((x) => x.id !== r.id && x.file_hash === hash);
  if (twin) throw Object.assign(new Error('This file is already saved on another receipt.'), { twin });
  if (isPdf) {
    const jpg = await maybeShrinkPdf(file, s.confirm);
    patch = jpg
      ? { file_key: await up(jpg, 'receipts', 'jpg'), original_key: null, mime: 'image/jpeg', ai: { ...(r.ai || {}), compressed: true } }
      : { file_key: await up(file, 'receipts', 'pdf'), original_key: null, mime: 'application/pdf' };
  } else {
    // Kept as the photo (no cleanup), just turned upright and compressed.
    try {
      const blob = await compressPhoto(file, { turn: await uprightTurn(s.api, file) });
      patch = { file_key: await up(blob, 'receipts', 'jpg'), original_key: null, mime: 'image/jpeg', ai: { ...(r.ai || {}), compressed: true } };
    } catch {
      // A format this browser can't open (e.g. HEIC outside Safari): store as is.
      patch = { file_key: await up(file, 'receipts', extFor(file.type, 'jpg')), original_key: null, mime: file.type || 'image/jpeg' };
    }
  }
  const old = [r.file_key, r.original_key].filter(Boolean);
  await s.update('receipts', r.id, { ...patch, file_hash: hash });
  if (old.length) await s.api.files.remove(old).catch(() => {});
  return old.length ? 'replaced' : 'added';
}
