// Google OAuth: consent → token exchange → Vault storage → mirror calendar
// setup → initial sync kick. Public endpoint (Google redirects land here);
// the start leg is authenticated by the user's JWT passed as ?token=.
import { admin, json, logSync, signState, storeSecret, verifyState } from "../_shared/admin.ts";
import { GOOGLE_TOKEN_URL, MIRROR_CALENDAR_NAME } from "../_shared/google.ts";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function selfUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  try {
    // ── Leg 1: start consent ───────────────────────────────────────────
    if (url.searchParams.get("action") === "start") {
      const token = url.searchParams.get("token") ?? "";
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return json({ error: "unauthorized" }, 401);
      const state = await signState({
        u: data.user.id,
        r: url.searchParams.get("redirect") ?? "",
      });
      const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      consent.searchParams.set("client_id", Deno.env.get("GOOGLE_CLIENT_ID")!);
      consent.searchParams.set("redirect_uri", selfUrl());
      consent.searchParams.set("response_type", "code");
      consent.searchParams.set("scope", SCOPES);
      consent.searchParams.set("access_type", "offline");
      consent.searchParams.set("prompt", "consent");
      consent.searchParams.set("state", state);
      return Response.redirect(consent.toString(), 302);
    }

    // ── Leg 2: callback from Google ────────────────────────────────────
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    if (!code || !stateParam) return json({ error: "missing code/state" }, 400);
    const state = await verifyState(stateParam);

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        grant_type: "authorization_code",
        code,
        redirect_uri: selfUrl(),
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed: ${await tokenRes.text()}`);
    const tok = await tokenRes.json();

    const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const me = await meRes.json();
    const email = me.email as string;

    // Refresh token → Vault. (On reconnect Google may omit it; keep the old one.)
    let secretId: string | null = null;
    if (tok.refresh_token) {
      secretId = await storeSecret(`google_refresh_${state.u}_${email}`, tok.refresh_token);
    }

    // Calendar list (writable + readable)
    const calRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const calList = await calRes.json();

    // Find or create the mirror calendar that scheduled tasks write to.
    // deno-lint-ignore no-explicit-any
    let mirror = (calList.items ?? []).find((c: any) => c.summary === MIRROR_CALENDAR_NAME);
    if (!mirror) {
      const createRes = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
        method: "POST",
        headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ summary: MIRROR_CALENDAR_NAME, timeZone: "America/Los_Angeles" }),
      });
      if (!createRes.ok) throw new Error(`mirror calendar create failed: ${await createRes.text()}`);
      mirror = await createRes.json();
    }

    const calendars = (calList.items ?? [])
      // deno-lint-ignore no-explicit-any
      .filter((c: any) => c.id !== mirror.id)
      // deno-lint-ignore no-explicit-any
      .map((c: any) => ({
        id: c.id,
        summary: c.summaryOverride ?? c.summary,
        color: c.backgroundColor ?? null,
        visible: Boolean(c.primary) || c.selected === true,
        sync_token: null,
      }));

    const accountRow = {
      user_id: state.u,
      provider: "google",
      email,
      access_token: tok.access_token,
      access_token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      sync_direction: "two_way",
      calendars,
      mirror_calendar_id: mirror.id,
      needs_reconnect: false,
      ...(secretId ? { refresh_token_secret_id: secretId } : {}),
    };
    const { data: account, error: upsertErr } = await admin
      .from("calendar_accounts")
      .upsert(accountRow, { onConflict: "user_id,provider,email" })
      .select("id")
      .single();
    if (upsertErr) throw upsertErr;

    await logSync("google", "oauth-connect", "ok", undefined, state.u);

    // Kick the initial full sync (also sets up watch channels); don't block
    // the user's redirect on it.
    const kick = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/google-sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "full", accountId: account.id }),
    }).catch(() => {});
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(kick);
    else await kick;

    return Response.redirect(state.r || Deno.env.get("APP_URL") || "/", 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("google", "oauth", "error", msg);
    return json({ error: msg }, 500);
  }
});
