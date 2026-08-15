// Mirror a Time Slot onto the dedicated "Nuvo" calendar as a single busy
// block, so reserved time shows up on the user's phone. Like task-mirror, this
// is a reconciler (app → provider, the app's version wins): the client says
// "slot X changed" (or "slot X is being deleted") and the provider is made to
// match.
//
// The slot's child tasks are NOT individually mirrored — they're unblocked
// (start_time null), so only the slot's time is reflected.
//
// Google and iCloud both, through `_shared/mirrorTargets.ts`. Before that, this
// was Google-only for the same reason task-mirror was (audit rank 3).
import { admin, handleOptions, json, logSync, readSecret, requireUser } from "../_shared/admin.ts";
import { mirrorDescription, mirrorSpan, mirrorTitle } from "../_shared/mirror.ts";
import { deleteMirror, putMirror, resolveMirrorTarget } from "../_shared/mirrorTargets.ts";

/** A held block reads as a container, not as a task — the glyph is what tells
 *  them apart at a glance on a phone's calendar. */
const SLOT_GLYPH = "🗂";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const body_ = await req.json();
    const { slotId, deleted, googleEventId } = body_;
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

    const target = await resolveMirrorTarget(ownerId, readSecret);
    if (!target) return json({ ok: true, skipped: "no mirror calendar" });

    // ── Delete: tear down the mirror block ───────────────────────────────
    // CalDAV derives the resource from the slot id, so it can tear one down
    // without the caller having kept an id — which is also why a delete that
    // races the row's own deletion still lands.
    if (deleted) {
      if (target.provider === "icloud" || googleEventId) {
        await deleteMirror(target, "slot", slotId, googleEventId);
        await logSync(target.provider, "slot-mirror-delete", "ok", undefined, ownerId);
      }
      return json({ ok: true });
    }

    // ── Upsert: one busy block for the slot ──────────────────────────────
    const span = mirrorSpan(slot!, "slot");
    // The device's zone, per request — never a constant. This function used to
    // stamp `America/Los_Angeles` on every user's held block, which is one
    // operator's own zone treated as everyone's (Principle 16) and the exact
    // bug D-082 locked the device-zone-not-home-zone doctrine in for.
    // `task-mirror` was fixed for it; this one was missed.
    const tz = typeof body_.tz === "string" && body_.tz ? body_.tz : "UTC";
    const existingEventId = (slot!.google_event_id as string | null) ?? null;

    const eventId = await putMirror(
      target,
      {
        kind: "slot",
        rowId: slotId,
        title: `${SLOT_GLYPH} ${mirrorTitle(slot!, "Time slot")}`,
        startISO: span.startISO,
        endISO: span.endISO,
        description: mirrorDescription(null),
        tz,
      },
      existingEventId,
    );

    if (eventId && eventId !== existingEventId) {
      await admin.from("slots").update({ google_event_id: eventId }).eq("id", slotId);
    }
    await logSync(target.provider, existingEventId ? "slot-mirror-update" : "slot-mirror-create", "ok", undefined, ownerId);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("google", "slot-mirror", "error", msg);
    return json({ error: msg }, 500);
  }
});
