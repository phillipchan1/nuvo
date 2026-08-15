// Mirroring — the rules that decide what lands on the user's own calendar.
//
// The CalDAV/Google round trips cannot be tested from here, which is exactly
// why every decision that does NOT need a network lives in `_shared/mirror.ts`
// and is pinned below: what gets a mirror event, what it's called, where it
// lives, and — the one with teeth — that Nuvo can never re-import its own
// mirrored blocks as if they were the user's events.

import { describe, expect, it } from "vitest";
import {
  MIRROR_NOTE,
  MIRROR_UID_PREFIX,
  isMirrorUid,
  mirrorDescription,
  mirrorHref,
  mirrorSpan,
  mirrorTitle,
  mirrorUid,
  shouldMirror,
  withoutMirrorCalendar,
} from "../supabase/functions/_shared/mirror.ts";

const AT = "2026-08-15T16:00:00.000Z";

describe("what gets mirrored", () => {
  it("mirrors a scheduled task", () => {
    expect(shouldMirror({ status: "planned", start_time: AT }, "task")).toBe(true);
  });

  it("keeps a done task on the calendar — it happened", () => {
    expect(shouldMirror({ status: "done", start_time: AT }, "task")).toBe(true);
  });

  it("tears the mirror down when the block goes away", () => {
    expect(shouldMirror({ status: "planned", start_time: null }, "task")).toBe(false);
  });

  it("tears the mirror down when the task is trashed", () => {
    expect(shouldMirror({ status: "trashed", start_time: AT }, "task")).toBe(false);
  });

  it("mirrors a slot regardless of status — a slot IS the block", () => {
    expect(shouldMirror({ start_time: AT }, "slot")).toBe(true);
    expect(shouldMirror({ start_time: null }, "slot")).toBe(false);
  });
});

describe("what it's called", () => {
  it("marks a completed block so a glance at a phone can tell", () => {
    expect(mirrorTitle({ title: "Draft the brief", status: "done" })).toBe("✓ Draft the brief");
  });

  it("leaves an open block alone", () => {
    expect(mirrorTitle({ title: "Draft the brief", status: "planned" })).toBe("Draft the brief");
  });

  it("never writes an empty title onto someone's calendar", () => {
    expect(mirrorTitle({ title: "   ", status: "planned" }, "Task")).toBe("Task");
  });
});

describe("where it lives", () => {
  it("derives the resource from the row id — no stored id to lose", () => {
    // This is the property that lets the CalDAV mirror carry no state at all:
    // PUT is an upsert, DELETE-404 is already-gone, and a half-written mirror
    // self-heals on the next reconcile instead of orphaning an event.
    expect(mirrorUid("task", "abc-123")).toBe(`${MIRROR_UID_PREFIX}task-abc-123`);
    expect(mirrorUid("task", "abc-123")).toBe(mirrorUid("task", "abc-123"));
  });

  it("keeps tasks and slots apart even on a shared id", () => {
    expect(mirrorUid("task", "x")).not.toBe(mirrorUid("slot", "x"));
  });

  it("builds one href whether or not the collection URL has a trailing slash", () => {
    const uid = mirrorUid("task", "x");
    expect(mirrorHref("https://p1.icloud.com/123/calendars/nuvo-blocks/", uid)).toBe(
      mirrorHref("https://p1.icloud.com/123/calendars/nuvo-blocks", uid),
    );
  });

  it("defaults a duration rather than writing a zero-length block", () => {
    expect(mirrorSpan({ start_time: AT, duration_minutes: null }, "task").endISO).toBe(
      "2026-08-15T16:30:00.000Z",
    );
    expect(mirrorSpan({ start_time: AT, duration_minutes: null }, "slot").endISO).toBe(
      "2026-08-15T17:00:00.000Z",
    );
  });
});

// The one that matters most. If Nuvo's mirror calendar syncs back in, every
// mirrored task exists twice on every surface AND counts as busy twice — which
// is the double-count that credited four projects' hours to the wrong domains
// (D-085). Two independent nets, because losing one of them is survivable and
// losing both is not.
describe("Nuvo never re-imports its own writing", () => {
  it("drops the mirror collection from a discovered list", () => {
    const cals = [
      { url: "https://p1.icloud.com/1/calendars/home/" },
      { url: "https://p1.icloud.com/1/calendars/nuvo-blocks/" },
    ];
    const kept = withoutMirrorCalendar(cals, "https://p1.icloud.com/1/calendars/nuvo-blocks/");
    expect(kept.map((c) => c.url)).toEqual(["https://p1.icloud.com/1/calendars/home/"]);
  });

  it("matches the collection with or without its trailing slash", () => {
    const cals = [{ url: "https://p1.icloud.com/1/calendars/nuvo-blocks/" }];
    expect(withoutMirrorCalendar(cals, "https://p1.icloud.com/1/calendars/nuvo-blocks")).toEqual([]);
  });

  it("never drops a calendar the USER named Nuvo", () => {
    // Matched by URL, never by display name. A user is entitled to their own
    // calendar called Nuvo, and shadowing it because of a name collision is not
    // a mistake we get to make.
    const cals = [{ url: "https://p1.icloud.com/1/calendars/nuvo/", displayName: "Nuvo" }];
    expect(withoutMirrorCalendar(cals, "https://p1.icloud.com/1/calendars/nuvo-blocks/")).toEqual(cals);
  });

  it("leaves the list untouched when no mirror is on file", () => {
    const cals = [{ url: "https://p1.icloud.com/1/calendars/home/" }];
    expect(withoutMirrorCalendar(cals, null)).toEqual(cals);
  });

  it("recognises its own resource by UID — the net for a lost mirror URL", () => {
    expect(isMirrorUid(mirrorUid("task", "abc"))).toBe(true);
    expect(isMirrorUid(mirrorUid("slot", "abc"))).toBe(true);
    // A real Apple/Google event, and the UID shape icloud-events writes for a
    // user-created event, must both come through.
    expect(isMirrorUid("nuvo-3f2a-4c1b-9e8d")).toBe(false);
    expect(isMirrorUid("040000008200E00074C5B7101A82E008")).toBe(false);
    expect(isMirrorUid(null)).toBe(false);
    expect(isMirrorUid(undefined)).toBe(false);
  });
});

// Mirroring is one-directional by decision: the app's version wins, so an edit
// made inside Google or Apple is replaced on the next reconcile. Phil chose that
// model on 2026-08-15 *with the condition that it stop being silent* — it is the
// only place in Nuvo that actively discards something the user did. These pin
// the warning, because the surface it has to reach is not one Nuvo controls: the
// person is standing in Apple Calendar on a phone when they drag the block.
describe("the mirror says what it is", () => {
  it("puts the warning on a block that has no notes", () => {
    expect(mirrorDescription(null)).toBe(MIRROR_NOTE);
    expect(mirrorDescription("")).toBe(MIRROR_NOTE);
    expect(mirrorDescription("   ")).toBe(MIRROR_NOTE);
  });

  it("keeps the user's own notes first, and never drops them", () => {
    const out = mirrorDescription("Bring the Q3 numbers");
    expect(out.startsWith("Bring the Q3 numbers")).toBe(true);
    expect(out).toContain(MIRROR_NOTE);
  });

  it("says the edit won't stick, not merely that Nuvo wrote it", () => {
    // "Written by Nuvo" alone is a label. What the user needs at the moment of
    // dragging is the consequence.
    expect(MIRROR_NOTE).toMatch(/won't stick|replaces it/i);
    expect(MIRROR_NOTE).toMatch(/in Nuvo/i);
  });
});
