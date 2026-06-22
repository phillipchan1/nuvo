// Subscribe to a published iCalendar (.ics) feed — read-only, no OAuth.
// Validates the URL points at a real calendar, stores it in Vault, creates the
// calendar_accounts row, then kicks an immediate sync so events appear at once.
import { admin, handleOptions, json, logSync, requireUser, storeSecret } from "../_shared/admin.ts";

function isBlockedHost(host: string): boolean {
  // Lightweight SSRF guard: only public https feeds, never internal targets.
  return (
    host === "localhost" ||
    host.endsWith(".local") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const { url, label } = await req.json().catch(() => ({}));

    if (!url || typeof url !== "string") {
      return json({ error: "A valid https calendar URL is required" }, 400);
    }
    const feedUrl = url.trim().replace(/^webcal:\/\//i, "https://");
    if (!/^https:\/\//i.test(feedUrl)) {
      return json({ error: "A valid https calendar URL is required" }, 400);
    }
    let host: string;
    try {
      host = new URL(feedUrl).hostname;
    } catch {
      return json({ error: "Malformed URL" }, 400);
    }
    if (isBlockedHost(host)) return json({ error: "That host isn't allowed" }, 400);

    // Confirm the feed actually returns a calendar before we persist anything.
    const res = await fetch(feedUrl, { headers: { Accept: "text/calendar" } });
    if (!res.ok) return json({ error: `Feed returned HTTP ${res.status}` }, 400);
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) {
      return json({ error: "That URL doesn't return an iCalendar feed" }, 400);
    }

    const calName = (text.match(/X-WR-CALNAME:(.+)/)?.[1] ?? "").trim();
    const email = (typeof label === "string" && label.trim()) || calName || "Subscribed calendar";

    const secretId = await storeSecret(`ics_url_${user.id}_${email}`, feedUrl);

    const { data: account, error } = await admin
      .from("calendar_accounts")
      .upsert(
        {
          user_id: user.id,
          provider: "ics",
          email,
          refresh_token_secret_id: secretId,
          sync_direction: "read_only",
          calendars: [{ id: "primary", summary: calName || email, color: "#0EA5E9", visible: true }],
          needs_reconnect: false,
        },
        { onConflict: "user_id,provider,email" },
      )
      .select("id")
      .single();
    if (error) throw error;

    await logSync("ics", "subscribe", "ok", undefined, user.id);

    // Baseline sync right away so events show without waiting for the poll.
    const kick = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ics-sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accountId: account.id }),
    }).catch(() => {});
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(kick);
    else await kick;

    return json({ ok: true, id: account.id });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("ics", "subscribe", "error", msg);
    return json({ error: msg }, 500);
  }
});
