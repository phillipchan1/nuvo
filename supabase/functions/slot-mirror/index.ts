// Mirror a Time Slot onto the dedicated "Nuvo" Google calendar as a single
// busy block, so reserved time shows up on the phone. Like task-mirror, this
// is a reconciler (app → Google, the app's version wins): the client says
// "slot X changed" (or "slot X is being deleted") and Google is made to match.
//
// The slot's child tasks are NOT individually mirrored — they're unblocked
// (start_time null), so only the slot's time is reflected on Google.
import { admin, handleOptions, json, logSync, requireUser } from "../_shared/admin.ts";
import { type GoogleAccount, gFetch } from "../_shared/google.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const { slotId, deleted, googleEventId } = await req.json();
    if (!slotId) return json({ error: "slotId required" }, 400);

    // On delete the row is (about to be) gone, so the caller passes the slot's
    // user via auth and the mirror event id directly. Otherwise read the row.
    const user = await requireUser(req).catch(() => null);

    let slot: Record<string, unknown> | null = null;
    if (!deleted) {
      const { data, error } = await admin.from("slots").select("*").eq("id", slotId).single();
      if (error || !data) return json({ error: "slot not found" }, 404);
      slot = data;
      if (user && slot.user_id !== user.id) return json({ error: "forbidden" }, 403);
    }

    const ownerId = (slot?.user_id as string | undefined) ?? user?.id;
    if (!ownerId) return json({ error: "no owner" }, 400);

    const { data: accounts } = await admin
      .from("calendar_accounts")
      .select("*")
      .eq("user_id", ownerId)
      .eq("provider", "google")
      .not("mirror_calendar_id", "is", null)
      .limit(1);
    const account = accounts?.[0] as GoogleAccount | undefined;
    if (!account) return json({ ok: true, skipped: "no mirror calendar" });
    const calId = encodeURIComponent(account.mirror_calendar_id!);

    // ── Delete: tear down the mirror block ───────────────────────────────
    if (deleted) {
      if (googleEventId) {
        const res = await gFetch(
          account,
          `/calendars/${calId}/events/${encodeURIComponent(googleEventId)}`,
          { method: "DELETE" },
        );
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          throw new Error(`slot mirror delete failed: ${res.status}`);
        }
        await logSync("google", "slot-mirror-delete", "ok", undefined, ownerId);
      }
      return json({ ok: true });
    }

    // ── Upsert: one busy block for the slot ──────────────────────────────
    const start = new Date(slot!.start_time as string);
    const end = new Date(start.getTime() + (slot!.duration_minutes as number) * 60_000);
    const title = (slot!.title as string)?.trim() || "Time slot";
    const body = JSON.stringify({
      summary: `🗂 ${title}`,
      start: { dateTime: start.toISOString(), timeZone: "America/Los_Angeles" },
      end: { dateTime: end.toISOString(), timeZone: "America/Los_Angeles" },
      transparency: "opaque",
    });

    const existingEventId = slot!.google_event_id as string | null;
    if (existingEventId) {
      const res = await gFetch(
        account,
        `/calendars/${calId}/events/${encodeURIComponent(existingEventId)}`,
        { method: "PATCH", body },
      );
      if (res.ok) {
        await logSync("google", "slot-mirror-update", "ok", undefined, ownerId);
        return json({ ok: true });
      }
      if (res.status !== 404 && res.status !== 410) {
        throw new Error(`slot mirror update failed: ${res.status} ${await res.text()}`);
      }
      // fall through: event vanished on Google's side — recreate
    }

    const createRes = await gFetch(account, `/calendars/${calId}/events`, { method: "POST", body });
    if (!createRes.ok) {
      throw new Error(`slot mirror create failed: ${createRes.status} ${await createRes.text()}`);
    }
    const created = await createRes.json();
    await admin.from("slots").update({ google_event_id: created.id }).eq("id", slotId);
    await logSync("google", "slot-mirror-create", "ok", undefined, ownerId);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("google", "slot-mirror", "error", msg);
    return json({ error: msg }, 500);
  }
});
