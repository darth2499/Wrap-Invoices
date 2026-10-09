// files — hands out short-lived upload/download links for the signed-in person's own files in R2.
// Every file lives under "<user id>/..." so one account can never touch another's files.
import { admin, HttpError, json, presign, r2Delete, r2List, requireUser, serve } from "../_shared/util.ts";

// Cloudflare R2 is free up to 10 GB. Uploads stop at this limit so you never get billed.
// Change it with the R2_LIMIT_GB secret (e.g. 9.5). Covers every account in this Wrap, since they share one bucket.
const GB = 1024 ** 3;
const limitBytes = () => Math.round((Number(Deno.env.get("R2_LIMIT_GB")) || 9.5) * GB);
const MAX_FILE = 50 * 1024 * 1024;

/** Re-counts what's really in R2 (at most once a day, or when the owner asks). Fixes any drift. */
async function recount(db: ReturnType<typeof admin>, force = false) {
  const { data: meta } = await db.from("storage_meta").select("counted_at").eq("id", 1).maybeSingle();
  const age = meta?.counted_at ? Date.now() - new Date(meta.counted_at).getTime() : Infinity;
  if (!force && age < 24 * 3600_000) return;
  const files = await r2List();
  const { error } = await db.from("stored_files").delete().neq("key", "");
  if (error) throw new Error(error.message);
  for (let i = 0; i < files.length; i += 500) {
    const rows = files.slice(i, i + 500).map((f) => ({ key: f.key, bytes: f.size, owner_id: /^[0-9a-f-]{36}\//.test(f.key) ? f.key.slice(0, 36) : null }));
    const { error: e } = await db.from("stored_files").upsert(rows);
    if (e) throw new Error(e.message);
  }
  await db.from("storage_meta").upsert({ id: 1, counted_at: new Date().toISOString() });
}

async function used(db: ReturnType<typeof admin>): Promise<number> {
  const { data, error } = await db.rpc("storage_used");
  if (error) throw new Error(`Storage limit isn't set up yet: run 005_storage_limit.sql in Supabase (${error.message})`);
  return Number(data ?? 0);
}

const gb = (n: number) => (n / GB).toFixed(n < 10 * GB ? 2 : 1);

const ALLOWED_FOLDERS = ["receipts", "originals", "logo", "restore", "imports"];

serve(async (req) => {
  const user = await requireUser(req);
  const db = admin();
  const body = await req.json().catch(() => ({}));
  const prefix = `${user.id}/`;
  const own = (key: unknown): string => {
    if (typeof key !== "string" || !key.startsWith(prefix) || key.includes("..")) {
      throw new HttpError(403, "That file doesn't belong to you");
    }
    return key;
  };

  switch (body.action) {
    case "upload": {
      // Either a brand-new key in a folder, or (for restoring a backup) an exact key under your own prefix.
      let key: string;
      if (body.key) {
        key = own(body.key);
      } else {
        const folder = String(body.folder ?? "receipts");
        if (!ALLOWED_FOLDERS.includes(folder)) throw new HttpError(400, "Unknown folder");
        const ext = String(body.ext ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
        key = `${prefix}${folder}/${crypto.randomUUID()}.${ext}`;
      }
      // Size of the file about to be uploaded (the browser always sends it).
      const size = Math.max(0, Math.round(Number(body.size) || 0));
      if (size > MAX_FILE) throw new HttpError(413, "That file is over 50 MB. Try a smaller photo or PDF.");
      await recount(db);
      const { data: prev } = await db.from("stored_files").select("bytes").eq("key", key).maybeSingle();
      const total = await used(db) - Number(prev?.bytes ?? 0);
      if (total + size > limitBytes()) {
        throw new HttpError(507, `Storage is full (${gb(total)} of ${gb(limitBytes())} GB used), so this wasn't uploaded and nothing will be charged. Delete old receipt images or download a backup and reset, or raise R2_LIMIT_GB.`);
      }
      await db.from("stored_files").upsert({ key, owner_id: user.id, bytes: size });
      return json({ key, url: await presign(key, "PUT", 900) });
    }
    case "download": {
      const keys: unknown[] = Array.isArray(body.keys) ? body.keys.slice(0, 500) : [];
      const urls: Record<string, string> = {};
      for (const k of keys) urls[own(k)] = await presign(own(k), "GET", 3600);
      return json({ urls });
    }
    case "delete": {
      const keys: unknown[] = Array.isArray(body.keys) ? body.keys.slice(0, 200) : [];
      const mine = keys.map(own);
      for (const k of mine) await r2Delete(k);
      if (mine.length) await db.from("stored_files").delete().in("key", mine);
      return json({ ok: true });
    }
    case "usage": {
      const { data: prof } = await db.from("profiles").select("is_admin").eq("id", user.id).single();
      await recount(db, !!body.recount && !!prof?.is_admin);
      const { data: meta } = await db.from("storage_meta").select("counted_at").eq("id", 1).maybeSingle();
      const { data: mine } = await db.rpc("storage_used", { p_owner: user.id });
      return json({
        used: await used(db),
        limit: limitBytes(),
        mine: Number(mine ?? 0),
        counted_at: meta?.counted_at ?? null,
      });
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
});
