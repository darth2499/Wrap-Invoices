// Shared receipt learning (see src/lib/scanRules.js). Each person's correction is one "vote" for a rule about a
// store. A rule is used for everyone only when 3+ different people agree and most votes for that rule say the same.
// What's stored: the store name (normalized), the rule, and a scrambled tag per person (an HMAC with a server
// secret, so the same person counts once; it can't be turned back into who they are without that secret).
// No amounts, dates, pictures or receipt text are ever stored here.
import { env } from "./util.ts";

const MIN_PEOPLE = 3;
const RULES = new Set(["total_label", "tip", "date_order", "category"]);

export async function voterTag(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("SUPABASE_SERVICE_ROLE_KEY")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`scan-vote:${userId}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

/** The rules everyone shares for one store: { total_label?, tip?, date_order?, category? }. */
// deno-lint-ignore no-explicit-any
export async function sharedRules(db: any, vendorKey: string): Promise<Record<string, string>> {
  if (!vendorKey) return {};
  const { data, error } = await db.from("scan_votes").select("rule, value, voter").eq("vendor_key", vendorKey).limit(2000);
  if (error || !data?.length) return {};
  const out: Record<string, string> = {};
  const byRule: Record<string, Record<string, Set<string>>> = {};
  for (const v of data) ((byRule[v.rule] ||= {})[v.value] ||= new Set()).add(v.voter);
  for (const [rule, values] of Object.entries(byRule)) {
    const total = new Set(Object.values(values).flatMap((s) => [...s])).size;
    const [best, people] = Object.entries(values).map(([val, s]) => [val, s.size] as [string, number]).sort((a, b) => b[1] - a[1])[0];
    if (people >= MIN_PEOPLE && people > total / 2) out[rule] = best;
  }
  return out;
}

/** Records what one person's correction taught (their earlier vote for the same store and rule is replaced). */
// deno-lint-ignore no-explicit-any
export async function vote(db: any, userId: string, vendorKey: string, rules: { rule: string; value: string }[]) {
  const voter = await voterTag(userId);
  const rows = rules
    .filter((r) => RULES.has(r.rule) && typeof r.value === "string" && r.value.length > 0 && r.value.length <= 60)
    .map((r) => ({ vendor_key: vendorKey, rule: r.rule, value: r.value, voter, updated_at: new Date().toISOString() }));
  if (!vendorKey || vendorKey.length > 60 || !rows.length) return;
  await db.from("scan_votes").upsert(rows, { onConflict: "vendor_key,rule,voter" });
}

/** Removes everything one person contributed (when their account is removed). */
// deno-lint-ignore no-explicit-any
export async function forgetVoter(db: any, userId: string) {
  await db.from("scan_votes").delete().eq("voter", await voterTag(userId));
}
