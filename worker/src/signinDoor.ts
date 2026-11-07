/**
 * The sign-in door: Google and Apple through Better Auth, for every shell
 * (blockers 2 / 2b, docs/cloudflare-cutover.md).
 *
 * Why a door and not `authClient.signIn.social()` from the SPA: Better Auth
 * keeps the OAuth state in a signed cookie on the API origin and refuses a
 * callback without it (`state_security_mismatch`). Set from a cross-origin
 * fetch, that cookie is third-party — WKWebView (Mac + iOS, tauri://localhost)
 * drops it — so the SPA's own call could never complete in the native shells.
 * The door is a top-level navigation instead, so every cookie in the flow is
 * first-party on the API origin:
 *
 *   shell ── GET /api/signin/:provider?return=<origin> ──▶ 302 provider
 *         (state cookie set first-party)
 *   provider ── /api/auth/callback/:provider ──▶ Better Auth: account, session
 *         ──▶ 302 /api/signin/return?to=<origin>
 *   /api/signin/return ── mint a one-time token for that session ──▶
 *         302 <origin>/#nuvo_ott=<token>
 *   shell ── POST /api/auth/one-time-token/verify ──▶ signed bearer
 *
 * The token rides in the fragment (never sent to a server, never in an access
 * log), is single-use, hashed at rest and dead after three minutes. `return`
 * must be a trusted shell origin (cors.ts), so the door is never an open
 * redirect. Existing users land in their own account because the copy maps
 * every Supabase identity to an `account` row with the same provider subject
 * and user id; a provider-verified email with no account row links by email
 * (Better Auth's default implicit linking).
 *
 * Linking (Settings → Link Google / Apple) goes through the same door with
 * `link=<one-time token>` minted by the signed-in shell: the door redeems it
 * server-side for the session, so no bearer ever appears in a URL.
 */
import type { Context } from "hono";
import { primeAppleClientSecret, signBearerToken } from "./auth.ts";
import { resolveAuthBaseURL } from "./authUrl.ts";
import { API_SECURITY, originMatches, trustedAuthOrigins } from "./cors.ts";
import type { Env } from "./env.ts";
import { requestIo, type AppEnv } from "./session.ts";

export const SIGNIN_PROVIDERS = ["google", "apple"] as const;
export type SigninProvider = (typeof SIGNIN_PROVIDERS)[number];

/** The fragment keys the SPA reads (src/lib/authReturn.ts). */
export const OTT_FRAGMENT = "nuvo_ott";
export const ERROR_FRAGMENT = "nuvo_auth_error";
export const LINKED_FRAGMENT = "nuvo_linked";

const NO_STORE = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  ...API_SECURITY,
};

function isProvider(value: string): value is SigninProvider {
  return (SIGNIN_PROVIDERS as readonly string[]).includes(value);
}

/**
 * A shell origin we may send a session to. Exact origins only — a path,
 * query or fragment on `return` is refused, never trimmed.
 */
export function trustedReturnOrigin(raw: string | null | undefined, env: Env): string | null {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return null;
  if (/[?#\s]/.test(value)) return null;
  const schemeEnd = value.indexOf("://");
  if (schemeEnd < 0) return null;
  if (value.slice(schemeEnd + 3).includes("/")) return null;
  return trustedAuthOrigins(env).some((p) => originMatches(value, p)) ? value : null;
}

function redirect(location: string, setCookies: string[] = []): Response {
  const headers = new Headers({ Location: location, ...NO_STORE });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function backToShell(origin: string, fragment: Record<string, string>): Response {
  const hash = new URLSearchParams(fragment).toString();
  return redirect(`${origin}/#${hash}`);
}

function setCookiesOf(headers: Headers | undefined): string[] {
  if (!headers) return [];
  const get = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof get === "function") return get.call(headers);
  const one = headers.get("set-cookie");
  return one ? [one] : [];
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const row = err as { body?: { code?: unknown }; status?: unknown };
    if (typeof row.body?.code === "string") return row.body.code.toLowerCase();
    if (typeof row.status === "string") return row.status.toLowerCase();
  }
  return "signin_failed";
}

async function providerConfigured(c: Context<AppEnv>, provider: SigninProvider): Promise<boolean> {
  const io = await requestIo(c);
  const ctx = await io.auth.$context;
  return ctx.socialProviders.some((p) => p.id === provider);
}

/** GET /api/signin/:provider?return=<origin>[&link=<one-time token>] */
export async function handleSigninStart(c: Context<AppEnv>): Promise<Response> {
  const env = c.env;
  const to = trustedReturnOrigin(c.req.query("return"), env);
  if (!to) {
    return new Response(JSON.stringify({ error: "untrusted return origin" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...NO_STORE },
    });
  }
  const provider = c.req.param("provider") ?? "";
  if (!isProvider(provider)) return backToShell(to, { [ERROR_FRAGMENT]: "unknown_provider" });

  await primeAppleClientSecret(env);
  if (!(await providerConfigured(c, provider))) {
    return backToShell(to, { [ERROR_FRAGMENT]: "provider_not_configured" });
  }

  const base = resolveAuthBaseURL(env);
  const linkOtt = c.req.query("link")?.trim();
  const returnUrl = new URL(`${base}/api/signin/return`);
  returnUrl.searchParams.set("to", to);
  if (linkOtt) returnUrl.searchParams.set("mode", "link");
  returnUrl.searchParams.set("provider", provider);
  const errorUrl = new URL(returnUrl);
  errorUrl.searchParams.set("failed", "1");
  const body = {
    provider,
    callbackURL: returnUrl.toString(),
    errorCallbackURL: errorUrl.toString(),
    disableRedirect: true,
  };

  const io = await requestIo(c);
  try {
    if (linkOtt) {
      // Redeem the shell's one-time token for its session, server-side.
      const verified = await io.auth.api.verifyOneTimeToken({ body: { token: linkOtt } });
      const sessionToken = verified?.session?.token;
      if (!sessionToken) return backToShell(to, { [ERROR_FRAGMENT]: "link_session_missing" });
      // Present it exactly as a browser would: the signed session cookie.
      const signed = await signBearerToken(env.BETTER_AUTH_SECRET ?? "", sessionToken);
      const cookieName = (await io.auth.$context).authCookies.sessionToken.name;
      const res = await io.auth.api.linkSocialAccount({
        body,
        headers: new Headers({ Cookie: `${cookieName}=${signed}` }),
        returnHeaders: true,
      });
      const url = (res.response as { url?: string })?.url;
      if (!url) return backToShell(to, { [ERROR_FRAGMENT]: "link_failed" });
      return redirect(url, setCookiesOf(res.headers));
    }
    const res = await io.auth.api.signInSocial({ body, returnHeaders: true });
    const url = (res.response as { url?: string })?.url;
    if (!url) return backToShell(to, { [ERROR_FRAGMENT]: "signin_failed" });
    return redirect(url, setCookiesOf(res.headers));
  } catch (err) {
    return backToShell(to, { [ERROR_FRAGMENT]: errorCode(err) });
  }
}

/** GET /api/signin/return?to=<origin>&provider=…[&mode=link][&failed=1&error=…] */
export async function handleSigninReturn(c: Context<AppEnv>): Promise<Response> {
  const env = c.env;
  const to = trustedReturnOrigin(c.req.query("to"), env);
  if (!to) {
    return new Response(JSON.stringify({ error: "untrusted return origin" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...NO_STORE },
    });
  }
  if (c.req.query("failed") || c.req.query("error")) {
    const code = (c.req.query("error") ?? "signin_failed").replace(/[^a-z0-9_]/gi, "").slice(0, 64);
    return backToShell(to, { [ERROR_FRAGMENT]: code || "signin_failed" });
  }
  if (c.req.query("mode") === "link") {
    const provider = c.req.query("provider") ?? "";
    return backToShell(to, { [LINKED_FRAGMENT]: isProvider(provider) ? provider : "1" });
  }
  const io = await requestIo(c);
  try {
    // The session cookie Better Auth just set on this (first-party) origin.
    const res = await io.auth.api.generateOneTimeToken({ headers: c.req.raw.headers });
    const token = (res as { token?: string })?.token;
    if (!token) return backToShell(to, { [ERROR_FRAGMENT]: "session_missing" });
    return backToShell(to, { [OTT_FRAGMENT]: token });
  } catch (err) {
    return backToShell(to, { [ERROR_FRAGMENT]: errorCode(err) === "unauthorized" ? "session_missing" : errorCode(err) });
  }
}
