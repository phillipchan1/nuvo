/**
 * Internal Better Auth email lookup for edge functions that notify a
 * Neon-only user (referralNotify). Bearer is the existing service-role
 * key — same secret the billing proxy already uses.
 */
import type { Context } from "hono";
import { sameSecret } from "../../supabase/functions/_shared/actingUser.ts";
import { OPEN_CORS, json } from "./cors.ts";
import { isUuid } from "./http.ts";
import { requestIo } from "./session.ts";
import type { AppEnv } from "./session.ts";

export async function handleInternalUserEmail(c: Context<AppEnv>): Promise<Response> {
  const key = c.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const bearer = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!key || !sameSecret(bearer, key)) {
    return json({ error: "unauthorized" }, 401, OPEN_CORS);
  }
  const id = (c.req.query("id") ?? "").trim();
  if (!isUuid(id)) return json({ error: "bad request" }, 400, OPEN_CORS);

  const io = await requestIo(c);
  try {
    const rows = await io.sql<{ email: string }[]>`
      SELECT email FROM "user" WHERE id = ${id} LIMIT 1
    `;
    const email = typeof rows[0]?.email === "string" ? rows[0].email.trim() : "";
    if (!email) return json({ error: "not found" }, 404, OPEN_CORS);
    return json({ email }, 200, OPEN_CORS);
  } catch {
    return json({ error: "service unavailable" }, 503, OPEN_CORS);
  }
}
