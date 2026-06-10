// Microsoft 365 OAuth (read-only calendar access via Microsoft Graph).
import { admin, json, logSync, signState, storeSecret, verifyState } from "../_shared/admin.ts";
import { GRAPH, MS_AUTH_URL, MS_SCOPES, MS_TOKEN_URL } from "../_shared/ms.ts";

function selfUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/m365-oauth`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  try {
    if (url.searchParams.get("action") === "start") {
      const token = url.searchParams.get("token") ?? "";
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return json({ error: "unauthorized" }, 401);
      const state = await signState({
        u: data.user.id,
        r: url.searchParams.get("redirect") ?? "",
      });
      const consent = new URL(MS_AUTH_URL);
      consent.searchParams.set("client_id", Deno.env.get("MS_CLIENT_ID")!);
      consent.searchParams.set("redirect_uri", selfUrl());
      consent.searchParams.set("response_type", "code");
      consent.searchParams.set("scope", MS_SCOPES);
      consent.searchParams.set("response_mode", "query");
      consent.searchParams.set("state", state);
      return Response.redirect(consent.toString(), 302);
    }

    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    if (!code || !stateParam) return json({ error: "missing code/state" }, 400);
    const state = await verifyState(stateParam);

    const tokenRes = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("MS_CLIENT_ID")!,
        client_secret: Deno.env.get("MS_CLIENT_SECRET")!,
        grant_type: "authorization_code",
        code,
        redirect_uri: selfUrl(),
        scope: MS_SCOPES,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed: ${await tokenRes.text()}`);
    const tok = await tokenRes.json();

    const meRes = await fetch(`${GRAPH}/me`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const me = await meRes.json();
    const email = (me.mail ?? me.userPrincipalName) as string;

    let secretId: string | null = null;
    if (tok.refresh_token) {
      secretId = await storeSecret(`m365_refresh_${state.u}_${email}`, tok.refresh_token);
    }

    const { data: account, error: upsertErr } = await admin
      .from("calendar_accounts")
      .upsert(
        {
          user_id: state.u,
          provider: "m365",
          email,
          access_token: tok.access_token,
          access_token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
          sync_direction: "read_only",
          calendars: [{ id: "primary", summary: `Outlook (${email})`, color: null, visible: true }],
          delta_link: null, // forces a fresh delta baseline on next sync
          needs_reconnect: false,
          ...(secretId ? { refresh_token_secret_id: secretId } : {}),
        },
        { onConflict: "user_id,provider,email" },
      )
      .select("id")
      .single();
    if (upsertErr) throw upsertErr;

    await logSync("m365", "oauth-connect", "ok", undefined, state.u);

    // Baseline delta sync right away so events appear without waiting 5 min.
    const kick = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/m365-sync`, {
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

    return Response.redirect(state.r || Deno.env.get("APP_URL") || "/", 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("m365", "oauth", "error", msg);
    return json({ error: msg }, 500);
  }
});
