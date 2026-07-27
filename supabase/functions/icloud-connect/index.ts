// Connect an iCloud (Apple Calendar) account via CalDAV.
//
// No OAuth: the credential is the user's Apple ID + an app-specific password
// (appleid.apple.com → Sign-In and Security → App-Specific Passwords). We verify
// the pair by discovering the calendars, stash the password in Vault, create the
// calendar_accounts row, then kick an immediate sync so events appear at once.
import { admin, handleOptions, json, logSync, requireUser, storeSecret } from "../_shared/admin.ts";
import { discoverCalendars } from "../_shared/caldav.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const { appleId, appPassword } = await req.json().catch(() => ({}));

    if (!appleId || typeof appleId !== "string" || !/^[^@\s]+@[^@\s]+$/.test(appleId.trim())) {
      return json({ error: "A valid Apple ID email is required" }, 400);
    }
    if (!appPassword || typeof appPassword !== "string" || appPassword.trim().length < 8) {
      return json({ error: "An app-specific password is required" }, 400);
    }
    const username = appleId.trim();
    // Apple prints app-specific passwords grouped as "abcd-efgh-ijkl-mnop"; the
    // dashes are display-only — accept them pasted either way.
    const password = appPassword.trim().replace(/\s+/g, "");

    // Verify credentials by listing calendars. Discovery throws on bad creds
    // *and* on an empty result, so there is no "connected successfully to
    // nothing" path — the message says which failure it was.
    let calendars;
    try {
      calendars = await discoverCalendars(username, password);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: msg }, 400);
    }

    const secretId = await storeSecret(`icloud_pw_${user.id}_${username}`, password);

    const { data: account, error } = await admin
      .from("calendar_accounts")
      .upsert(
        {
          user_id: user.id,
          provider: "icloud",
          email: username,
          refresh_token_secret_id: secretId,
          sync_direction: "two_way",
          calendars: calendars.map((c) => ({
            id: c.url,
            summary: c.displayName,
            color: c.color,
            visible: true,
          })),
          needs_reconnect: false,
        },
        { onConflict: "user_id,provider,email" },
      )
      .select("id")
      .single();
    if (error) throw error;

    await logSync("icloud", "connect", "ok", undefined, user.id);

    // Baseline sync right away so events show without waiting for the poll.
    const kick = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/icloud-sync`, {
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

    return json({ ok: true, id: account.id, calendars: calendars.length });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("icloud", "connect", "error", msg);
    return json({ error: msg }, 500);
  }
});
