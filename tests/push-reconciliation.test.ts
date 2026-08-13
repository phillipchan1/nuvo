// Background reminders — the part that decides who speaks.
//
// One person can now be reached from four places at once: a Mac app that's
// open, a phone that's asleep, a stray browser tab, and a cron dispatcher that
// knows about none of them. Told four times about one standup is not four times
// as useful — it is the notification theater Principle 9 refuses, arriving by
// accident rather than by design.
//
// The mechanism that prevents it is a CLAIM, and a claim is only as good as the
// key both sides compute. That is what this file pins: the app and the
// dispatcher must derive byte-identical keys and fire instants from the same
// inputs, or both "win" and the user hears it twice.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_PREFS,
  dueNow,
  planReminders,
  reminderKey,
  REMINDER_GRACE_MS,
  type ReminderPrefs,
} from "../supabase/functions/_shared/reminderRules.ts";
import {
  buildReminderAnchors as buildShared,
  eventKeyOf,
  instantForLocalTime,
} from "../supabase/functions/_shared/reminderAnchors.ts";
import { buildReminderAnchors as buildApp, keyOfOverride } from "../src/lib/reminders";
import type { ExternalEvent, Slot, Task } from "../src/lib/types";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const ON: ReminderPrefs = { ...DEFAULT_REMINDER_PREFS, enabled: true };
const T0 = Date.UTC(2026, 7, 13, 17, 0, 0);

const event = (over: Partial<ExternalEvent> = {}): ExternalEvent =>
  ({
    id: "row-1",
    account_id: "acct",
    provider_event_id: "evt",
    calendar_id: "primary",
    title: "Standup",
    start_at: new Date(T0 + 40 * 60_000).toISOString(),
    end_at: new Date(T0 + 70 * 60_000).toISOString(),
    all_day: false,
    location: null,
    busy: true,
    ...over,
  }) as ExternalEvent;

const base = {
  tasks: [] as Task[],
  slots: [] as Slot[],
  events: [event()],
  hiddenKeys: new Set<string>(),
  deadlineTimeMinutes: 540,
  nowMs: T0,
};

describe("the app and the dispatcher agree", () => {
  it("build the same anchor key for the same event", () => {
    // The SPA adapter and the raw kernel builder are two entry points into one
    // implementation. If they ever diverge, two channels claim under different
    // keys, neither collides, and the user is told twice.
    const [fromApp] = buildApp(base);
    const [fromServer] = buildShared({ ...base, timeZone: "America/Los_Angeles" } as never);
    expect(fromApp.key).toBe(fromServer.key);
    expect(fromApp.atMs).toBe(fromServer.atMs);
  });

  it("resolve the same fire instant, to the second", () => {
    // The claim key includes the fire instant truncated to the second, so a
    // sub-second disagreement is invisible — but a whole second is not.
    const planA = planReminders(buildApp(base), ON);
    const planB = planReminders(buildShared({ ...base, timeZone: "UTC" } as never), ON);
    expect(Math.floor(planA[0].fireAtMs / 1000)).toBe(Math.floor(planB[0].fireAtMs / 1000));
  });

  it("key an event by its provider identity, which survives a resync", () => {
    // `external_events.id` is renumbered by a sync sweep. If the claim key used
    // it, the dispatcher and a client that had resynced would disagree — and a
    // reminder already delivered would fire again under a new key.
    const [a] = buildApp(base);
    expect(a.key).toBe(reminderKey("event", eventKeyOf(event()), "start"));
    expect(a.key).not.toContain("row-1");
  });

  it("an override row and a live anchor produce one key", () => {
    const [a] = buildApp(base);
    expect(
      keyOfOverride({ target_kind: "event", target_id: null, event_key: "acct:evt", anchor: "start" }),
    ).toBe(a.key);
  });
});

describe("deadlines resolve in a named zone, not the server's", () => {
  it("9am in Los Angeles is not 9am in UTC", () => {
    const la = instantForLocalTime("2026-08-14", 540, "America/Los_Angeles");
    const utc = instantForLocalTime("2026-08-14", 540, "UTC");
    expect(la).not.toBe(utc);
    // PDT in August: UTC−7, so 9am local is 16:00Z.
    expect(new Date(la).toISOString()).toBe("2026-08-14T16:00:00.000Z");
  });

  it("reads the offset AT the instant, so DST is right on both sides of it", () => {
    // 2026: US DST ends Nov 1. Same wall-clock hour, different offsets.
    const before = new Date(instantForLocalTime("2026-10-15", 540, "America/Los_Angeles")).toISOString();
    const after = new Date(instantForLocalTime("2026-12-15", 540, "America/Los_Angeles")).toISOString();
    expect(before).toBe("2026-10-15T16:00:00.000Z"); // PDT, UTC−7
    expect(after).toBe("2026-12-15T17:00:00.000Z"); // PST, UTC−8
  });

  it("an unknown zone falls back to UTC, never to one operator's own", () => {
    // The bug this guards against by name: task-mirror hard-coding
    // America/Los_Angeles onto every user's block (Principle 16).
    const bogus = instantForLocalTime("2026-08-14", 540, "Mars/Olympus_Mons");
    expect(new Date(bogus).toISOString()).toBe("2026-08-14T09:00:00.000Z");
  });
});

describe("an open app wins the race", () => {
  it("the dispatcher ignores a reminder that has only just come due", () => {
    // It subtracts its lag before asking, giving a foreground client — which
    // fires within a second of the instant — time to claim first.
    const plan = planReminders(buildApp(base), ON); // fires at T0 + 30m
    const fireAt = plan[0].fireAtMs;
    const DISPATCH_LAG_MS = 30_000;

    // Foreground, right on time: fires.
    expect(dueNow(plan, fireAt, new Set())).toHaveLength(1);
    // Dispatcher at the same instant: sees nothing yet.
    expect(dueNow(plan, fireAt - DISPATCH_LAG_MS, new Set())).toHaveLength(0);
    // Dispatcher a minute later: now it's fair game.
    expect(dueNow(plan, fireAt + 60_000 - DISPATCH_LAG_MS, new Set())).toHaveLength(1);
  });

  it("both sides drop a reminder that is merely stale", () => {
    // The grace window is shared, so a dispatcher that was down for an hour
    // doesn't come back and announce a morning that already happened.
    const plan = planReminders(buildApp(base), ON);
    const wayLate = plan[0].fireAtMs + REMINDER_GRACE_MS + 60_000;
    expect(dueNow(plan, wayLate, new Set())).toEqual([]);
  });
});

describe("the dispatcher cannot nudge", () => {
  const src = read("supabase/functions/push-dispatch/index.ts");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").toLowerCase();

  it("reads only commitments with a time on them", () => {
    // If this ever queries the inbox, the backlog, or how long since someone
    // last opened the app, it has stopped being a reminder service.
    for (const banned of ['"inbox"', "roll_count", "overdue", "streak", "last_opened", "digest"]) {
      expect(code.includes(banned), `push-dispatch reads ${banned}`).toBe(false);
    }
  });

  it("says nothing of its own — every word comes from the kernel", () => {
    // No literal notification copy in the dispatcher: title and body are
    // `r.title` / `r.body`, produced by reminderRules.
    expect(code).toMatch(/title:\s*r\.title/);
    expect(code).toMatch(/body:\s*r\.body/);
  });

  it("claims before it sends", () => {
    const order = src.indexOf("await claim(");
    const send = src.indexOf("await push(");
    expect(order).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(order);
  });
});

describe("the service worker is a courier, not an author", () => {
  const sw = read("src/sw.ts");

  it("shows what it was handed and composes nothing", () => {
    expect(sw).toMatch(/payload\.title/);
    expect(sw).toMatch(/body: payload\.body/);
    // A tag per anchor, so a retried send can never stack a second copy.
    expect(sw).toMatch(/tag: payload\.key/);
  });

  it("still precaches, so an installed app opens offline", () => {
    // injectManifest means we own the whole worker now; losing these is how a
    // plane launch turns into a blank screen.
    expect(sw).toMatch(/precacheAndRoute\(self\.__WB_MANIFEST\)/);
    expect(sw).toMatch(/NavigationRoute/);
    expect(sw).toMatch(/cleanupOutdatedCaches\(\)/);
  });
});
