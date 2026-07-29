// What the agent DOES, not what its prompt says.
//
// Until this file existed, every agent bug was found by Phil in production and
// fixed by adding another sentence to a 4,000-word prompt — because there was no
// way to prove a fix held, and no way to delete a rule safely. These cases run
// the real `executeTool` against an in-memory account (tests/agent/), so a
// regression fails here instead of on someone's calendar.
//
// Most cases are lifted from one transcript, 2026-07-28: "next Wednesday Kim's
// coming for dinner" landed on tomorrow, the reply announced a time the card
// disagreed with, the correction produced a second event, and the wrong one
// couldn't be cancelled because it was on Apple. Each is a case below.
//
// Adding a case: prefer a real failure over an imagined one, and assert the
// user-visible consequence (which row moved, what the reply is handed to say)
// rather than the internal call shape, so a refactor doesn't break the test.
import { beforeEach, describe, expect, it } from "vitest";

import { executeTool } from "../supabase/functions/agent/tools.ts";
import {
  calls,
  event,
  events,
  eventsTitled,
  FAMILY_CAL,
  GOOGLE_ACCOUNT,
  GOOGLE_PRIMARY,
  ICLOUD_ACCOUNT,
  installFetch,
  M365_ACCOUNT,
  PERSONAL_CAL,
  seedWorld,
  TZ,
  USER,
} from "./agent/world.ts";

/** Run a tool the way index.ts runs it, and parse the JSON the model gets back. */
async function tool(name: string, args: Record<string, unknown>) {
  const out = await executeTool(USER, name, args, "user-jwt", TZ);
  return { ...out, json: JSON.parse(out.result) as Record<string, never> };
}

/** Dinner on Wed Aug 5, 6:30–8:00 PM Pacific — the event from the transcript. */
const KIM = {
  title: "Kim's coming for dinner",
  start_local: "2026-08-05T18:30",
  end_local: "2026-08-05T20:00",
};

beforeEach(() => {
  seedWorld();
  installFetch();
});

describe("creating an event", () => {
  it("puts a named calendar's event on that calendar, at the stated local time", async () => {
    const { json, action } = await tool("create_calendar_event", { ...KIM, calendar_name: "Family" });

    expect(json.calendar).toBe("Family");
    const [row] = eventsTitled(KIM.title);
    expect(row.calendar_id).toBe(FAMILY_CAL);
    expect(row.account_id).toBe(ICLOUD_ACCOUNT);
    // 6:30 PM Pacific in August is UTC-7.
    expect(row.start_at).toBe("2026-08-06T01:30:00.000Z");
    expect(action?.verb).toBe("created");
  });

  it("hands the reply a formatted local time instead of a UTC string to convert", async () => {
    // The bug this pins: the model was given start_at in UTC and asked to
    // narrate a local time, so it announced "6:30–8:00 PM" over a card reading
    // 5:15. Prose and card now come from the same string.
    const { json } = await tool("create_calendar_event", { ...KIM, calendar_name: "Family" });

    expect(json.when).toBe("Wed, Aug 5, 6:30–8:00 PM");
    expect(json.start_local).toBe(KIM.start_local);
    expect(json.end_local).toBe(KIM.end_local);
  });

  it("routes an unnamed event to the default account, never to Family", async () => {
    const { json } = await tool("create_calendar_event", { ...KIM });

    expect(json.calendar).toBe(GOOGLE_PRIMARY);
    expect(json.isDefault).toBe(true);
    expect(eventsTitled(KIM.title)[0].account_id).toBe(GOOGLE_ACCOUNT);
  });

  it("flags the same title a few days off as a possible duplicate", async () => {
    // The correction path: dinner was put on the wrong day, the user corrected
    // it, and the second create must not confirm cleanly while the first sits
    // there. Nothing is blocked — a fortnightly dinner is real — but the twin
    // comes back so the reply has to account for it.
    seedWorld({
      external_events: [
        event({ id: "evt-wrong-day", title: KIM.title, start_at: "2026-07-30T01:30:00.000Z", end_at: "2026-07-30T03:00:00.000Z" }),
      ],
    });

    const { json } = await tool("create_calendar_event", { ...KIM, calendar_name: "Family" });

    expect(json.created).toBe(true);
    expect(json.possibleDuplicate).toBeTruthy();
    expect((json.possibleDuplicate as { id: string }).id).toBe("evt-wrong-day");
    expect((json.possibleDuplicate as { when: string }).when).toBe("Wed, Jul 29, 6:30–8:00 PM");
  });

  it("says nothing about duplicates when there is no twin", async () => {
    const { json } = await tool("create_calendar_event", { ...KIM, calendar_name: "Family" });
    expect(json.possibleDuplicate).toBeUndefined();
  });

  it("relocates rather than duplicates when the same event is re-created at the same time", async () => {
    seedWorld({
      external_events: [
        event({
          id: "evt-on-google",
          title: KIM.title,
          start_at: "2026-08-06T01:30:00.000Z",
          end_at: "2026-08-06T03:00:00.000Z",
          account_id: GOOGLE_ACCOUNT,
          calendar_id: GOOGLE_PRIMARY,
        }),
      ],
    });

    const { json } = await tool("create_calendar_event", { ...KIM, calendar_name: "Family" });

    expect(json.calendar).toBe("Family");
    expect(eventsTitled(KIM.title)).toHaveLength(1);
  });
});

describe("correcting an event the agent just made", () => {
  beforeEach(() => {
    seedWorld({
      external_events: [
        event({ id: "evt-1", title: KIM.title, start_at: "2026-07-30T01:30:00.000Z", end_at: "2026-07-30T03:00:00.000Z" }),
      ],
    });
    installFetch();
  });

  it("moves the Apple event a week out instead of leaving it and adding another", async () => {
    // "Next Wednesday not tomorrow" — the whole point. One row, new time.
    const { json, action } = await tool("reschedule_event", {
      event_id: "evt-1",
      start_local: KIM.start_local,
      end_local: KIM.end_local,
    });

    expect(events()).toHaveLength(1);
    expect(events()[0].start_at).toBe("2026-08-06T01:30:00.000Z");
    expect(json.when).toBe("Wed, Aug 5, 6:30–8:00 PM");
    expect(action?.verb).toBe("moved");
    expect(action?.ref?.id).toBe("evt-1");
  });

  it("keeps the length when only the start moves", async () => {
    await tool("reschedule_event", { event_id: "evt-1", start_local: "2026-07-29T19:00" });

    const [row] = events();
    expect(row.start_at).toBe("2026-07-30T02:00:00.000Z");
    expect(new Date(row.end_at as string).getTime() - new Date(row.start_at as string).getTime()).toBe(90 * 60_000);
  });

  it("mirrors the new time locally even on Google, which patches only `raw`", async () => {
    // google-events refreshes `raw` and leaves start_at alone, so without the
    // agent mirroring it the card in the transcript shows the old time until
    // the next sync. Provider-specific, easy to regress, invisible in review.
    seedWorld({
      external_events: [
        event({
          id: "evt-g",
          title: "Standup",
          start_at: "2026-08-05T16:00:00.000Z",
          end_at: "2026-08-05T16:30:00.000Z",
          account_id: GOOGLE_ACCOUNT,
          calendar_id: GOOGLE_PRIMARY,
        }),
      ],
    });
    installFetch();

    await tool("reschedule_event", { event_id: "evt-g", start_local: "2026-08-05T10:00" });

    expect(events()[0].start_at).toBe("2026-08-05T17:00:00.000Z");
  });

  it("retitles without disturbing the time", async () => {
    const { json } = await tool("reschedule_event", { event_id: "evt-1", title: "Kim & Dave for dinner" });

    expect(events()[0].title).toBe("Kim & Dave for dinner");
    expect(events()[0].start_at).toBe("2026-07-30T01:30:00.000Z");
    expect(json.title).toBe("Kim & Dave for dinner");
  });

  it("refuses an empty change instead of writing a no-op", async () => {
    await expect(tool("reschedule_event", { event_id: "evt-1" })).rejects.toThrow(/Nothing to change/);
  });

  it("re-homes to another calendar without creating a second row", async () => {
    const { json } = await tool("move_event", { event_id: "evt-1", calendar_name: "Personal" });

    expect(events()).toHaveLength(1);
    expect(events()[0].calendar_id).toBe(PERSONAL_CAL);
    expect(json.calendar).toBe("Personal");
  });
});

describe("taking an event back", () => {
  beforeEach(() => {
    seedWorld({
      external_events: [
        event({ id: "evt-apple", title: KIM.title, start_at: "2026-07-30T01:30:00.000Z", end_at: "2026-07-30T03:00:00.000Z" }),
        event({
          id: "evt-google",
          title: "Standup",
          start_at: "2026-08-05T16:00:00.000Z",
          end_at: "2026-08-05T16:30:00.000Z",
          account_id: GOOGLE_ACCOUNT,
          calendar_id: GOOGLE_PRIMARY,
        }),
      ],
    });
    installFetch();
  });

  it("cancels an Apple event — the one the agent could create but not remove", async () => {
    // Verbatim from the transcript: "I couldn't cancel it because the mistaken
    // entry appears to be on a non-Google calendar." It was an event the agent
    // had created itself, sixty seconds earlier.
    const { json } = await tool("cancel_event", { event_id: "evt-apple" });

    expect(json.cancelled).toBe(true);
    expect(eventsTitled(KIM.title)).toHaveLength(0);
    expect(calls.at(-1)?.fn).toBe("icloud-events");
  });

  it("cancels a Google event through google-events", async () => {
    await tool("cancel_event", { event_id: "evt-google" });

    expect(eventsTitled("Standup")).toHaveLength(0);
    expect(calls.at(-1)?.fn).toBe("google-events");
  });

  it("does not notify attendees unless asked, and says so when it does", async () => {
    await tool("cancel_event", { event_id: "evt-google" });
    expect(calls.at(-1)?.body.sendUpdates).toBe("none");

    seedWorld({
      external_events: [
        event({
          id: "evt-google",
          title: "Standup",
          start_at: "2026-08-05T16:00:00.000Z",
          end_at: "2026-08-05T16:30:00.000Z",
          account_id: GOOGLE_ACCOUNT,
          calendar_id: GOOGLE_PRIMARY,
        }),
      ],
    });
    installFetch();
    const { action } = await tool("cancel_event", { event_id: "evt-google", notify: true });
    expect(calls.at(-1)?.body.sendUpdates).toBe("all");
    expect(action?.summary).toMatch(/attendees notified/);
  });

  it("names the event and its time back, so a wrong target is visible", async () => {
    const { json, action } = await tool("cancel_event", { event_id: "evt-apple" });

    expect(json.when).toBe("Wed, Jul 29, 6:30–8:00 PM");
    expect(action?.summary).toContain(KIM.title);
  });

  it("asks for an id rather than guessing between two events of the same name", async () => {
    seedWorld({
      external_events: [
        event({ id: "evt-a", title: KIM.title, start_at: "2026-07-30T01:30:00.000Z", end_at: "2026-07-30T03:00:00.000Z" }),
        event({ id: "evt-b", title: KIM.title, start_at: "2026-08-06T01:30:00.000Z", end_at: "2026-08-06T03:00:00.000Z" }),
      ],
    });
    installFetch();

    await expect(tool("cancel_event", { event_title: KIM.title })).rejects.toThrow(/Multiple events match/);
    expect(events()).toHaveLength(2);
  });
});

describe("read-only calendars", () => {
  beforeEach(() => {
    seedWorld({
      external_events: [
        event({
          id: "evt-m365",
          title: "Board meeting",
          start_at: "2026-08-05T16:00:00.000Z",
          end_at: "2026-08-05T17:00:00.000Z",
          account_id: M365_ACCOUNT,
          calendar_id: "work-cal",
        }),
      ],
    });
    installFetch();
  });

  it("says Microsoft is read-only instead of failing vaguely", async () => {
    for (const [name, args] of [
      ["cancel_event", { event_id: "evt-m365" }],
      ["reschedule_event", { event_id: "evt-m365", start_local: "2026-08-05T11:00" }],
    ] as const) {
      await expect(tool(name, args)).rejects.toThrow(/Microsoft calendar, which Nuvo can read but not write/);
    }
    expect(events()).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});

describe("times are read in the user's own zone", () => {
  it("6:30 PM means 6:30 PM where the user is standing, not in Pacific", async () => {
    // The traveling-user bug class: the tool schemas used to name
    // America/Los_Angeles while the prompt said "the user's zone".
    const out = await executeTool(USER, "create_calendar_event", { ...KIM, calendar_name: "Family" }, "jwt", "America/New_York");
    const json = JSON.parse(out.result);

    expect(json.when).toBe("Wed, Aug 5, 6:30–8:00 PM");
    expect(events()[0].start_at).toBe("2026-08-05T22:30:00.000Z"); // 6:30 PM EDT
  });
});
