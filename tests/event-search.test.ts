// Calendar search — the parts that are decidable without a database.
//
// The audit's rank-2 gap was that `SearchHitData.kind` had four values and
// events were not one of them, on any surface or in the agent. What is pinned
// here is the contract that keeps the fix honest across all three:
//
//   · a query can't smuggle PostgREST filter syntax into an `or()` clause
//   · a hit resolves to the LOCAL day the calendar has to travel to
//   · the serialized nav intent carries that day, because the grid must move
//     before the row is even loaded
//   · the ⌘K / ⌥Space / phone surfaces all speak the same intent

import { describe, expect, it } from "vitest";
import { eventHitDateISO, eventHitSubtitle, sanitizeEventQuery, type EventHit } from "../src/lib/eventSearch";
import { applySpotlightNav, type SpotlightNav } from "../src/lib/spotlightNav";
import { clearCalendarReveal, onCalendarReveal, pendingCalendarReveal, revealOnCalendar } from "../src/lib/calendarReveal";

const hit = (over: Partial<EventHit> = {}): EventHit => ({
  id: "row-1",
  title: "1:1 with Sam",
  start_at: new Date(2026, 7, 12, 14, 30).toISOString(),
  end_at: new Date(2026, 7, 12, 15, 0).toISOString(),
  all_day: false,
  location: null,
  account_id: "acct",
  provider_event_id: "evt",
  when: "past",
  ...over,
});

describe("query sanitizing", () => {
  it("strips the characters PostgREST would read as filter syntax", () => {
    // `or()` takes a comma-separated filter list — an unescaped comma or paren
    // is parsed as syntax, not as text, and the search fails rather than
    // returning nothing.
    expect(sanitizeEventQuery("lunch, with (Sam)")).toBe("lunch with Sam");
    expect(sanitizeEventQuery("100% review")).toBe("100 review");
    expect(sanitizeEventQuery("a*b")).toBe("a b");
    expect(sanitizeEventQuery("  spaced   out  ")).toBe("spaced out");
  });
});

describe("a hit's landing", () => {
  it("resolves to the LOCAL calendar day, not the UTC one", () => {
    // A 9pm meeting is on today's grid, not tomorrow's — the same class of bug
    // as the agent's hardcoded server zone (D-082).
    const late = hit({ start_at: new Date(2026, 7, 12, 21, 30).toISOString() });
    expect(eventHitDateISO(late)).toBe("2026-08-12");
  });

  it("says when it was, and where when we know", () => {
    expect(eventHitSubtitle(hit())).toMatch(/Aug 12/);
    expect(eventHitSubtitle(hit({ location: "Room 2" }))).toMatch(/Room 2$/);
    expect(eventHitSubtitle(hit({ all_day: true }))).toMatch(/all day/);
  });
});

describe("the nav intent", () => {
  it("carries the date, because the grid has to travel before the row loads", () => {
    const nav: SpotlightNav = { kind: "event", eventId: "row-1", dateISO: "2026-08-12" };
    const calls: Record<string, unknown>[] = [];
    let revealed: { dateISO: string; eventId?: string } | null = null;
    const off = onCalendarReveal((r) => (revealed = r));

    applySpotlightNav(nav, {
      openOverlay: () => {},
      openProject: () => {},
      openInitiative: () => {},
      navigate: (patch) => calls.push(patch),
    });
    off();

    expect(revealed).toMatchObject({ dateISO: "2026-08-12", eventId: "row-1" });
    expect(calls[0]).toMatchObject({ rung: "day", overlay: "event", overlayId: "row-1" });
  });
});

describe("the reveal bus", () => {
  it("fires again for the same date — searching one meeting twice must work", () => {
    // The whole reason this is a bus and not a prop: the value doesn't change,
    // so a prop wouldn't re-trigger. The nonce is what makes it a signal.
    const seen: number[] = [];
    const off = onCalendarReveal((r) => seen.push(r.nonce));
    revealOnCalendar({ dateISO: "2026-08-12" });
    revealOnCalendar({ dateISO: "2026-08-12" });
    off();
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    clearCalendarReveal();
  });

  it("holds a reveal for a calendar that mounts a frame later", () => {
    // Search on the phone switches tabs, so MobileCalendar subscribes AFTER the
    // publish. Without the pending drain the jump is silently dropped.
    clearCalendarReveal();
    revealOnCalendar({ dateISO: "2026-09-01", eventId: "x" });
    expect(pendingCalendarReveal()).toMatchObject({ dateISO: "2026-09-01" });
    clearCalendarReveal();
    expect(pendingCalendarReveal()).toBeNull();
  });
});
