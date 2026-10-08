// Shared helpers for all Wrap edge functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { AwsClient } from "npm:aws4fetch@1.0.20";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing secret: ${name}`);
  return v;
}

/** Service-role client: bypasses Row Level Security. Only use after checking permissions yourself. */
export function admin(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Returns the signed-in user for this request, or throws. */
export async function requireUser(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in");
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Not signed in");
  return data.user;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Wraps a handler with CORS + error handling. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      return await handler(req);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, status);
    }
  });
}

// ---------------- Cloudflare R2 (private file storage) ----------------
let _r2: AwsClient | null = null;
function r2(): AwsClient {
  if (!_r2) {
    _r2 = new AwsClient({
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    });
  }
  return _r2;
}

function objectUrl(key: string): string {
  const safe = key.split("/").map(encodeURIComponent).join("/");
  return `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_BUCKET")}/${safe}`;
}

/** A temporary link that lets the browser upload (PUT) or download (GET) one file. */
export async function presign(key: string, method: "GET" | "PUT", seconds = 900, downloadName?: string): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(seconds));
  if (downloadName && method === "GET") {
    url.searchParams.set("response-content-disposition", `inline; filename="${downloadName.replace(/"/g, "")}"`);
  }
  const signed = await r2().sign(url.toString(), { method, aws: { signQuery: true } });
  return signed.url;
}

export async function r2Get(key: string): Promise<Response> {
  const res = await r2().fetch(objectUrl(key), { method: "GET" });
  if (!res.ok) throw new HttpError(404, `File not found (${res.status})`);
  return res;
}

export async function r2Delete(key: string): Promise<void> {
  await r2().fetch(objectUrl(key), { method: "DELETE" });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Base address of the web app, used to build client links in emails. */
export function appUrl(): string {
  return env("APP_URL").replace(/\/+$/, "");
}
