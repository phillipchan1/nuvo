// Manual calendar pull — authenticated users can refresh on demand instead of
// waiting for webhooks or the 5-minute poll.
import { admin, handleOptions, json, requireUser } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const reqBody = await req.json().catch(() => ({}));
    const fullSync = reqBody?.fullSync === true;

    const { data: accounts, error } = await admin
      .from("calendar_accounts")
      .select("id, provider")
      .eq("user_id", user.id)
      .eq("needs_reconnect", false);
    if (error) throw error;

    const base = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };

    const errors: string[] = [];
    for (const account of accounts ?? []) {
      const fn = account.provider === "google" ? "google-sync" : "m365-sync";
      const body = account.provider === "google"
        ? { mode: fullSync ? "full" : "incremental", accountId: account.id }
        : { accountId: account.id };
      const res = await fetch(`${base}/functions/v1/${fn}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) errors.push(`${account.provider}: ${await res.text()}`);
    }

    if (errors.length === (accounts ?? []).length && errors.length > 0) {
      return json({ error: errors.join("; ") }, 500);
    }
    return json({ ok: true, synced: (accounts ?? []).length, errors: errors.length ? errors : undefined });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
