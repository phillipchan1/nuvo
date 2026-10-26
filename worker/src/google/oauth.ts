import type { Env } from "../env.ts";
import type { Sql } from "../db.ts";
import { jsonParam } from "../db.ts";
import { outboundFetch } from "../lib/outboundFetch.ts";
import { signState, verifyState } from "../lib/oauthState.ts";
import { sealToken } from "../lib/secrets.ts";
import {
  MIRROR_CALENDAR_DESCRIPTION,
  MIRROR_CALENDAR_NAME,
} from "../../../supabase/functions/_shared/mirror.ts";
import { GOOGLE_SCOPES, GOOGLE_TOKEN_URL } from "./types.ts";
import { logSync } from "./owned.ts";
import { gFetch } from "./tokens.ts";
import { oauthSelfUrl } from "./sync.ts";
import { runGoogleSync } from "./sync.ts";
import { runGoogleContacts } from "./contacts.ts";

export async function startGoogleOauth(
  env: Env,
  userId: string,
  redirect: string,
  reqUrl: string,
): Promise<Response> {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || !env.GOOGLE_CLIENT_ID) {
    return jsonError("google oauth is not configured", 500);
  }
  const state = await signState(secret, { u: userId, r: redirect });
  const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  consent.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  consent.searchParams.set("redirect_uri", oauthSelfUrl(env, reqUrl));
  consent.searchParams.set("response_type", "code");
  consent.searchParams.set("scope", GOOGLE_SCOPES);
  consent.searchParams.set("access_type", "offline");
  consent.searchParams.set("prompt", "consent");
  consent.searchParams.set("state", state);
  return Response.redirect(consent.toString(), 302);
}

export async function handleGoogleOauthCallback(
  sql: Sql,
  env: Env,
  reqUrl: string,
): Promise<Response> {
  const url = new URL(reqUrl);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (!code || !stateParam) return jsonError("missing code/state", 400);
  const state = await verifyState(secret, stateParam);
  const userId = state.u;
  if (!userId) return jsonError("bad oauth state", 400);

  const tokenRes = await outboundFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: oauthSelfUrl(env, reqUrl),
    }),
  });
  if (!tokenRes.ok) throw new Error("token exchange failed");
  const tok = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tok.access_token) throw new Error("token exchange failed");

  const meRes = await outboundFetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  const me = (await meRes.json()) as { email?: string };
  const email = me.email;
  if (!email) throw new Error("google userinfo missing email");

  const existing = await sql`
    SELECT id FROM calendar_accounts
    WHERE user_id = ${userId}
      AND provider = 'google'
      AND email = ${email}
    LIMIT 1
  `;
  const accountId = (existing[0] as { id?: string } | undefined)?.id ?? crypto.randomUUID();

  let enc: Uint8Array | null = null;
  let iv: Uint8Array | null = null;
  let keyVersion: number | null = null;
  if (tok.refresh_token) {
    const key = env.TOKEN_ENC_KEY_V1;
    if (!key) throw new Error("TOKEN_ENC_KEY_V1 is not set");
    const sealed = await sealToken(key, tok.refresh_token, {
      table: "calendar_accounts",
      rowId: accountId,
      userId,
    });
    enc = sealed.enc;
    iv = sealed.iv;
    keyVersion = sealed.keyVersion;
  }

  const calRes = await outboundFetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  const calList = (await calRes.json()) as {
    items?: Array<{
      id?: string;
      summary?: string;
      summaryOverride?: string;
      backgroundColor?: string;
      primary?: boolean;
      selected?: boolean;
    }>;
  };

  let mirror = (calList.items ?? []).find((c) => c.summary === MIRROR_CALENDAR_NAME);
  if (!mirror) {
    const stub = {
      id: accountId,
      user_id: userId,
      email,
      refresh_token_enc: enc,
      refresh_token_iv: iv,
      key_version: keyVersion,
      access_token: tok.access_token,
      access_token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      calendars: [],
      mirror_calendar_id: null,
      webhook_expires_at: null,
      needs_reconnect: false,
    };
    const createRes = await gFetch(sql, env, stub, "/calendars", {
      method: "POST",
      body: JSON.stringify({
        summary: MIRROR_CALENDAR_NAME,
        description: MIRROR_CALENDAR_DESCRIPTION,
        timeZone: "America/Los_Angeles",
      }),
    });
    if (!createRes.ok) throw new Error("mirror calendar create failed");
    mirror = (await createRes.json()) as { id?: string; summary?: string };
  }

  const calendars = (calList.items ?? [])
    .filter((c) => c.id && c.id !== mirror?.id)
    .map((c) => ({
      id: c.id,
      summary: c.summaryOverride ?? c.summary,
      color: c.backgroundColor ?? null,
      visible: Boolean(c.primary) || c.selected === true,
      sync_token: null,
    }));

  const expires = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString();
  if (enc && iv) {
    await sql`
      INSERT INTO calendar_accounts (
        id, user_id, provider, email, access_token, access_token_expires_at,
        sync_direction, calendars, mirror_calendar_id, needs_reconnect,
        refresh_token_enc, refresh_token_iv, key_version
      ) VALUES (
        ${accountId}, ${userId}, 'google', ${email}, ${tok.access_token}, ${expires},
        'two_way', ${jsonParam(sql, calendars)}, ${mirror?.id ?? null}, false,
        ${enc}, ${iv}, ${keyVersion}
      )
      ON CONFLICT (user_id, provider, email) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        calendars = EXCLUDED.calendars,
        mirror_calendar_id = EXCLUDED.mirror_calendar_id,
        needs_reconnect = false,
        refresh_token_enc = EXCLUDED.refresh_token_enc,
        refresh_token_iv = EXCLUDED.refresh_token_iv,
        key_version = EXCLUDED.key_version,
        updated_at = now()
    `;
  } else {
    await sql`
      INSERT INTO calendar_accounts (
        id, user_id, provider, email, access_token, access_token_expires_at,
        sync_direction, calendars, mirror_calendar_id, needs_reconnect
      ) VALUES (
        ${accountId}, ${userId}, 'google', ${email}, ${tok.access_token}, ${expires},
        'two_way', ${jsonParam(sql, calendars)}, ${mirror?.id ?? null}, false
      )
      ON CONFLICT (user_id, provider, email) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        calendars = EXCLUDED.calendars,
        mirror_calendar_id = EXCLUDED.mirror_calendar_id,
        needs_reconnect = false,
        updated_at = now()
    `;
  }

  await logSync(sql, "google", "oauth-connect", "ok", undefined, userId);
  await runGoogleSync(sql, env, { mode: "full", accountId, userId, reqUrl }).catch(() => undefined);
  await runGoogleContacts(sql, env, { accountId, userId }).catch(() => undefined);

  return Response.redirect(state.r || env.APP_URL || "/", 302);
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
