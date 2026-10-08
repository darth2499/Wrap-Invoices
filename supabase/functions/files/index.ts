// files — hands out short-lived upload/download links for the signed-in person's own files in R2.
// Every file lives under "<user id>/..." so one account can never touch another's files.
import { HttpError, json, presign, r2Delete, requireUser, serve } from "../_shared/util.ts";

const ALLOWED_FOLDERS = ["receipts", "originals", "logo", "restore", "imports"];

serve(async (req) => {
  const user = await requireUser(req);
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
      for (const k of keys) await r2Delete(own(k));
      return json({ ok: true });
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
});
