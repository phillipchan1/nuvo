// Reminders — the rules that keep the app's one unprompted voice honest.
//
// Two things are being pinned here, and only one of them is arithmetic:
//
//   1. The math. Leads, fire instants, the grace window, the single next wake.
//   2. The BOUNDARY. N-07 allows time-critical *now* signals and refuses
//      planning nudges; Principle 9 refuses notification theater. That is a
//      product promise, and product promises rot unless something fails when
//      they break. So the shape of the kernel is asserted too: it cannot be
//      handed a count, a streak, or a "you haven't…" — the only inputs it has
//      are an anchor instant and a lead.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_PREFS,
  defaultLeadFor,
  describeLead,
  describeLeadShort,
  dueNow,
  nextFireAt,
  normalizeReminderPrefs,
  parseLead,
  planReminders,
  reminderKey,
  REMINDER_GRACE_MS,
  REMINDER_LEADS,
  resolveFireAt,
  type ReminderAnchor,
  type ReminderPrefs,
} from "../supabase/functions/_shared/reminderRules.ts";
import { buildReminderAnchors, keyOfOverride, localInstant } from "../src/lib/reminders";
import type { ExternalEvent, Slot, Task } from "../src/lib/types";

const ON: ReminderPrefs = { ...DEFAULT_REMINDER_PREFS, enabled: true };

const T0 = Date.UTC(2026, 7, 12, 17, 0, 0); // a fixed clock; nothing here reads the real one

function anchor(over: Partial<ReminderAnchor> = {}): ReminderAnchor {
  return {
    key: reminderKey("event", "acct:evt", "start"),
    targetKind: "event",
    targetId: "row-1",
    anchor: "start",
    atMs: T0 + 30 * 60_000,
    title: "Standup",
    detail: null,
    ...over,
  };
}

describe("the boundary N-07 allows", () => {
  it("takes an anchor and a lead, and nothing that could express a nudge", () => {
    // If someone later adds `overdueCount` or `lastOpenedAt` to what a reminder
    // carries, this fails and the conversation happens before it ships. Comments
    // are stripped first — the header talks about streaks precisely to refuse
    // them, and a check that can't tell prose from code is a check nobody keeps.
    const src = readFileSync(
      join(import.meta.dirname, "..", "supabase", "functions", "_shared", "reminderRules.ts"),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").toLowerCase();
    for (const banned of ["streak", "overdue", "unplanned", "engagement", "digest", "badge"]) {
      expect(code.includes(banned), `the kernel's code mentions "${banned}"`).toBe(false);
    }
  });

  it("a delivered reminder carries a fixed, minimal set of facts", () => {
    const [r] = planReminders([anchor()], ON);
    expect(Object.keys(r).sort()).toEqual([
      "anchor",
      "atMs",
      "body",
      "fireAtMs",
      "key",
      "leadMinutes",
      "targetId",
      "targetKind",
      "title",
    ]);
  });

  it("is silent until asked — a fresh account fires nothing", () => {
    expect(DEFAULT_REMINDER_PREFS.enabled).toBe(false);
    expect(planReminders([anchor()], DEFAULT_REMINDER_PREFS)).toEqual([]);
  });

  it("has exactly three anchors, all of them facts about a moment", () => {
    expect(defaultLeadFor({ targetKind: "event", anchor: "start" }, ON)).toBe(ON.event_lead);
    expect(defaultLeadFor({ targetKind: "task", anchor: "start" }, ON)).toBe(ON.block_lead);
    expect(defaultLeadFor({ targetKind: "slot", anchor: "start" }, ON)).toBe(ON.block_lead);
    expect(defaultLeadFor({ targetKind: "task", anchor: "deadline" }, ON)).toBe(ON.deadline_lead);
  });
});

describe("planning", () => {
  it("fires a meeting at its default lead", () => {
    const [r] = planReminders([anchor()], ON);
    expect(r.fireAtMs).toBe(anchor().atMs - 10 * 60_000);
    expect(r.body).toBe("Starts in 10 min");
  });

  it("an override replaces the default for that item only", () => {
    const a = anchor();
    const b = anchor({ key: reminderKey("event", "acct:other"), atMs: T0 + 60 * 60_000, title: "Review" });
    const plan = planReminders([a, b], ON, [{ key: a.key, lead_minutes: 30 }]);
    expect(plan.find((r) => r.key === a.key)!.leadMinutes).toBe(30);
    expect(plan.find((r) => r.key === b.key)!.leadMinutes).toBe(10);
  });

  it("silencing one item drops it without touching the rest", () => {
    const a = anchor();
    const b = anchor({ key: reminderKey("event", "acct:other"), title: "Review" });
    const plan = planReminders([a, b], ON, [{ key: a.key, lead_minutes: null }]);
    expect(plan.map((r) => r.key)).toEqual([b.key]);
  });

  it("a default of `never` silences the whole anchor kind", () => {
    const plan = planReminders([anchor()], { ...ON, event_lead: null });
    expect(plan).toEqual([]);
  });

  it("sorts soonest first, so the shell can arm one timer", () => {
    const late = anchor({ key: "a", atMs: T0 + 90 * 60_000 });
    const soon = anchor({ key: "b", atMs: T0 + 20 * 60_000 });
    expect(planReminders([late, soon], ON).map((r) => r.key)).toEqual(["b", "a"]);
  });

  it("a deadline reads as due, not as starting", () => {
    const [r] = planReminders(
      [anchor({ key: "d", targetKind: "task", anchor: "deadline", atMs: T0 + 60_000 })],
      { ...ON, deadline_lead: 0 },
    );
    expect(r.body).toBe("Due today");
  });

  it("carries a detail clause when there is one, and no filler when there isn't", () => {
    const [withDetail] = planReminders([anchor({ detail: "Room 2" })], ON);
    expect(withDetail.body).toBe("Starts in 10 min · Room 2");
    const [without] = planReminders([anchor()], ON);
    expect(without.body).toBe("Starts in 10 min");
  });
});

describe("delivery selection", () => {
  const plan = () => planReminders([anchor()], ON); // fires at T0 + 20m

  it("does not fire early", () => {
    expect(dueNow(plan(), T0, new Set())).toEqual([]);
  });

  it("fires once due", () => {
    expect(dueNow(plan(), T0 + 20 * 60_000, new Set())).toHaveLength(1);
  });

  it("never fires the same anchor twice", () => {
    const p = plan();
    expect(dueNow(p, T0 + 21 * 60_000, new Set([p[0].key]))).toEqual([]);
  });

  it("a laptop waking after hours asleep stays quiet", () => {
    // The whole point of the grace window: a stale reminder is not a *now*
    // signal, and delivering a backlog of them is the theater N-07 refused.
    const p = plan();
    const wayLate = p[0].fireAtMs + REMINDER_GRACE_MS + 60_000;
    expect(dueNow(p, wayLate, new Set())).toEqual([]);
  });

  it("names the single next instant worth waking for", () => {
    const p = planReminders(
      [anchor({ key: "a", atMs: T0 + 60 * 60_000 }), anchor({ key: "b", atMs: T0 + 30 * 60_000 })],
      ON,
    );
    expect(nextFireAt(p, T0, new Set())).toBe(T0 + 20 * 60_000);
    expect(nextFireAt(p, T0, new Set(["b"]))).toBe(T0 + 50 * 60_000);
    expect(nextFireAt(p, T0 + 3 * 60 * 60_000, new Set())).toBeNull();
  });

  it("resolveFireAt is anchor minus lead", () => {
    expect(resolveFireAt(T0, 15)).toBe(T0 - 15 * 60_000);
    expect(resolveFireAt(T0, 0)).toBe(T0);
  });
});

describe("the lead vocabulary", () => {
  it("reads back in human words", () => {
    expect(describeLead(null)).toBe("No reminder");
    expect(describeLead(0)).toBe("At the time");
    expect(describeLead(10)).toBe("10 minutes before");
    expect(describeLead(60)).toBe("1 hour before");
    expect(describeLead(120)).toBe("2 hours before");
    expect(describeLead(1440)).toBe("1 day before");
    expect(describeLeadShort(30)).toBe("30m before");
    expect(describeLeadShort(null)).toBe("Off");
  });

  it("refuses a lead outside the vocabulary rather than rounding it", () => {
    // The picker, the agent's enum and the parser must agree; silently snapping
    // "remind me 7 minutes before" to 5 would be the app lying about what it did.
    expect(parseLead(7)).toBeUndefined();
    expect(parseLead(-5)).toBeUndefined();
    expect(parseLead("banana")).toBeUndefined();
    expect(parseLead("off")).toBeNull();
    expect(parseLead(null)).toBeNull();
    for (const m of REMINDER_LEADS) expect(parseLead(String(m))).toBe(m);
  });

  it("fills a half-written prefs blob without inventing an 'on'", () => {
    const p = normalizeReminderPrefs({ event_lead: 30 });
    expect(p.enabled).toBe(false);
    expect(p.event_lead).toBe(30);
    expect(p.block_lead).toBe(DEFAULT_REMINDER_PREFS.block_lead);
    expect(normalizeReminderPrefs(undefined)).toEqual(DEFAULT_REMINDER_PREFS);
    // An explicit null is "never", not "unset" — it must survive the fill.
    expect(normalizeReminderPrefs({ event_lead: null }).event_lead).toBeNull();
  });
});

describe("anchors built from the day already on screen", () => {
  const task = (over: Partial<Task> = {}): Task =>
    ({
      id: "t1",
      title: "Draft the brief",
      status: "planned",
      start_time: new Date(T0 + 45 * 60_000).toISOString(),
      deadline: null,
      ...over,
    }) as Task;

  const event = (over: Partial<ExternalEvent> = {}): ExternalEvent =>
    ({
      id: "row-1",
      account_id: "acct",
      provider_event_id: "evt",
      calendar_id: "primary",
      title: "Standup",
      start_at: new Date(T0 + 20 * 60_000).toISOString(),
      end_at: new Date(T0 + 50 * 60_000).toISOString(),
      all_day: false,
      location: null,
      busy: true,
      ...over,
    }) as ExternalEvent;

  const base = {
    tasks: [] as Task[],
    slots: [] as Slot[],
    events: [] as ExternalEvent[],
    hiddenKeys: new Set<string>(),
    deadlineTimeMinutes: 540,
    nowMs: T0,
  };

  it("keys an event by its provider identity, not the mirror row id", () => {
    // external_events.id is renumbered by a resync; a reminder pinned to it
    // would silently detach. Same doctrine as hidden_events.
    const [a] = buildReminderAnchors({ ...base, events: [event()] });
    expect(a.key).toBe("event:acct:evt:start");
    expect(a.targetId).toBe("row-1"); // still what a click opens
  });

  it("skips all-day, declined and hidden events", () => {
    expect(buildReminderAnchors({ ...base, events: [event({ all_day: true })] })).toEqual([]);
    expect(buildReminderAnchors({ ...base, events: [event({ self_rsvp: "declined" })] })).toEqual([]);
    expect(
      buildReminderAnchors({ ...base, events: [event()], hiddenKeys: new Set(["acct:evt"]) }),
    ).toEqual([]);
  });

  it("skips a done or trashed task", () => {
    expect(buildReminderAnchors({ ...base, tasks: [task({ status: "done" })] })).toEqual([]);
    expect(buildReminderAnchors({ ...base, tasks: [task({ status: "trashed" })] })).toEqual([]);
  });

  it("gives a task with a block AND a deadline two independent anchors", () => {
    // Tomorrow, so the 9am fire instant is unambiguously ahead of T0 in any
    // zone the suite might run in.
    const d = new Date(T0);
    d.setDate(d.getDate() + 1);
    const deadlineISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const anchors = buildReminderAnchors({ ...base, tasks: [task({ deadline: deadlineISO })] });
    expect(anchors.map((a) => a.anchor).sort()).toEqual(["deadline", "start"]);
    // Independently silenceable — which is the reason the key carries the anchor.
    expect(new Set(anchors.map((a) => a.key)).size).toBe(2);
  });

  it("holds nothing outside the window", () => {
    const farOff = task({ start_time: new Date(T0 + 10 * 24 * 60 * 60_000).toISOString() });
    expect(buildReminderAnchors({ ...base, tasks: [farOff] })).toEqual([]);
  });

  it("resolves a deadline date to the local time of day the user chose", () => {
    const at9 = localInstant("2026-08-14", 540);
    const d = new Date(at9);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(14);
  });

  it("an override row and a live anchor agree on the key", () => {
    const [a] = buildReminderAnchors({ ...base, events: [event()] });
    const row = { target_kind: "event" as const, target_id: null, event_key: "acct:evt", anchor: "start" as const };
    expect(keyOfOverride(row)).toBe(a.key);
  });
});
