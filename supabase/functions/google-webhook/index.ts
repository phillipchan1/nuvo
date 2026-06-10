// Google Calendar push notification receiver. Google POSTs here when a
// watched calendar changes; we validate the channel against our records and
// trigger an incremental sync for just that calendar.
import { admin, json, logSync } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const channelId = req.headers.get("X-Goog-Channel-ID");
  const resourceState = req.headers.get("X-Goog-Resource-State");
  const channelToken = req.headers.get("X-Goog-Channel-Token") ?? "";

  // "sync" is the channel-created handshake; ack and ignore.
  if (!channelId || resourceState === "sync") return new Response("ok");

  const [accountId, calendarId] = channelToken.split(":");
  if (!accountId || !calendarId) return json({ error: "bad token" }, 400);

  // Validate the channel belongs to this account/calendar before acting.
  const { data: account } = await admin
    .from("calendar_accounts")
    .select("id, user_id, calendars")
    .eq("id", accountId)
    .single();
  // deno-lint-ignore no-explicit-any
  const cal = (account?.calendars as any[] | undefined)?.find(
    (c) => c.id === calendarId && c.channel_id === channelId,
  );
  if (!account || !cal) return json({ error: "unknown channel" }, 404);

  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/google-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode: "incremental", accountId, calendarId }),
  });
  if (!res.ok) {
    await logSync("google", "webhook", "error", await res.text(), account.user_id);
  }
  return new Response("ok");
});
