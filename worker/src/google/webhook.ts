import type { Env } from "../env.ts";
import type { Sql } from "../db.ts";
import { logSync } from "./owned.ts";
import { runGoogleSync } from "./sync.ts";
import type { CalendarEntry } from "./types.ts";

export async function handleGoogleWebhook(
  sql: Sql,
  env: Env,
  req: Request,
): Promise<Response> {
  const channelId = req.headers.get("X-Goog-Channel-ID");
  const resourceState = req.headers.get("X-Goog-Resource-State");
  const channelToken = req.headers.get("X-Goog-Channel-Token") ?? "";
  if (!channelId || resourceState === "sync") return new Response("ok");

  const [accountId, calendarId] = channelToken.split(":");
  if (!accountId || !calendarId) {
    return new Response(JSON.stringify({ error: "bad token" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = await sql`
    SELECT id, user_id, calendars
    FROM calendar_accounts
    WHERE id = ${accountId}
      AND provider = 'google'
    LIMIT 1
  `;
  const account = rows[0] as { id?: string; user_id?: string; calendars?: unknown } | undefined;
  let calendarsRaw = account?.calendars;
  if (typeof calendarsRaw === "string") {
    try {
      calendarsRaw = JSON.parse(calendarsRaw) as unknown;
    } catch {
      calendarsRaw = [];
    }
  }
  const calendars = Array.isArray(calendarsRaw) ? (calendarsRaw as CalendarEntry[]) : [];
  const cal = calendars.find((c) => c.id === calendarId && c.channel_id === channelId);
  if (!account || !cal) {
    return new Response(JSON.stringify({ error: "unknown channel" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const res = await runGoogleSync(sql, env, {
    mode: "incremental",
    accountId,
    calendarId,
    userId: String(account.user_id),
    reqUrl: req.url,
  });
  if (!res.ok) {
    await logSync(sql, "google", "webhook", "error", "incremental sync failed", String(account.user_id));
  }
  return new Response("ok");
}
