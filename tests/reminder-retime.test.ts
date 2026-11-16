/**
 * A reminder is one fire IN TIME — key plus the instant, the same pair the
 * server's `claim_reminder` is unique on. The local fired set was keyed by the
 * key alone, so once a block's reminder had spoken, dragging the block to a new
 * time silenced it for good: the new fire was "already fired".
 */
import { describe, expect, it } from "vitest";
import { buildReminderAnchors } from "../supabase/functions/_shared/reminderAnchors.ts";
import {
  DEFAULT_REMINDER_PREFS,
  dueNow,
  firedReminderKey,
  nextFireAt,
  planReminders,
} from "../supabase/functions/_shared/reminderRules.ts";

const prefs = { ...DEFAULT_REMINDER_PREFS, enabled: true };
const plan = (start: string, nowMs: number) =>
  planReminders(
    buildReminderAnchors({
      tasks: [{ id: "t1", title: "Write", status: "planned", start_time: start, deadline: null }],
      slots: [],
      events: [],
      hiddenKeys: new Set(),
      deadlineTimeMinutes: 540,
      timeZone: "UTC",
      nowMs,
    }),
    prefs,
  );

describe("a block re-timed after its reminder fired", () => {
  it("still reminds at the new time", () => {
    const t1 = Date.parse("2026-11-17T08:55:00Z");
    const first = plan("2026-11-17T09:00:00Z", t1);
    const spoken = dueNow(first, t1, new Set());
    expect(spoken).toHaveLength(1);
    const fired = new Set(spoken.map(firedReminderKey));

    // the user drags the block to 3pm
    const t2 = Date.parse("2026-11-17T14:55:00Z");
    const second = plan("2026-11-17T15:00:00Z", t2);
    expect(second[0].key).toBe(first[0].key); // same anchor, new instant
    expect(nextFireAt(second, Date.parse("2026-11-17T12:00:00Z"), fired)).toBe(second[0].fireAtMs);
    expect(dueNow(second, t2, fired)).toHaveLength(1);
  });

  it("still never speaks the same fire twice", () => {
    const t1 = Date.parse("2026-11-17T08:55:00Z");
    const first = plan("2026-11-17T09:00:00Z", t1);
    const fired = new Set(dueNow(first, t1, new Set()).map(firedReminderKey));
    expect(dueNow(first, t1 + 60_000, fired)).toEqual([]);
  });

  it("is keyed to the second, like the server's claim", () => {
    expect(firedReminderKey({ key: "task:x:start:10", fireAtMs: Date.parse("2026-10-29T16:00:00.400Z") })).toBe(
      firedReminderKey({ key: "task:x:start:10", fireAtMs: Date.parse("2026-10-29T16:00:00Z") }),
    );
  });
});
