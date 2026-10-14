/** @vitest-environment jsdom */
/**
 * D-152 — a new event goes on a CALENDAR, and the default is a calendar too.
 *
 * Three things are pinned here:
 *
 *  1. The default-calendar rule (`_shared/defaultCalendar.ts`) as both runtimes
 *     apply it — the app's `pickCreateTarget` and the agent's
 *     `buildWritableCalendars` → `pickDefaultCalendar` — and that the two land
 *     an unnamed event in the SAME place for every settings shape. A tap and a
 *     chat message disagreeing about the default is the D-047 failure again.
 *  2. The picker list itself: what it offers, the default mark, what a pick
 *     hands back.
 *  3. Task → Event's wiring: both doors (the Schedule's right-click menu and
 *     the task card's footer) ask with that list and hand the pick through.
 *     Those surfaces are too hooked to mount, so — like domain-picker.test —
 *     their wiring is read from source.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTargetGroups, pickCreateTarget } from "../src/lib/calendarWrite";
import { CalendarTargetList } from "../src/components/calendar/EventCalendarPicker";
import { HARNESS_CALENDAR_ACCOUNTS } from "../src/components/calendar/calendarFixtures";
import { accountDefaultCalendarId } from "../supabase/functions/_shared/defaultCalendar.ts";
import {
  buildWritableCalendars,
  pickDefaultCalendar,
  type RawCalendarAccount,
} from "../supabase/functions/agent/calendars.ts";

const ACCOUNTS = HARNESS_CALENDAR_ACCOUNTS;
const RAW = ACCOUNTS as unknown as RawCalendarAccount[];
const HIDDEN = "hidden-cal@group.calendar.google.com";
const WORK = "work-cal@group.calendar.google.com";
const CHURCH = "church-cal@group.calendar.google.com";

describe("accountDefaultCalendarId — the shared rule", () => {
  const ids = ["you@example.com", WORK, HIDDEN];
  const email = "you@example.com";

  it("is the chosen calendar when it is still there and still shown", () => {
    expect(accountDefaultCalendarId(ids, { accountEmail: email, defaultCalendarId: WORK })).toBe(WORK);
  });

  it("falls back to the account's own calendar when the chosen one is hidden or gone", () => {
    expect(
      accountDefaultCalendarId(ids, { accountEmail: email, hiddenIds: [HIDDEN], defaultCalendarId: HIDDEN }),
    ).toBe("you@example.com");
    expect(accountDefaultCalendarId(ids, { accountEmail: email, defaultCalendarId: "deleted" })).toBe(
      "you@example.com",
    );
  });

  it("is undefined when nothing in the account may be chosen", () => {
    expect(accountDefaultCalendarId([HIDDEN], { accountEmail: email, hiddenIds: [HIDDEN] })).toBeUndefined();
  });
});

describe("pickCreateTarget — the app's default", () => {
  it("lands on the default CALENDAR, not just the default account's own", () => {
    expect(
      pickCreateTarget(ACCOUNTS, {
        hiddenIds: [HIDDEN],
        defaultAccountId: "acct-google",
        defaultCalendarId: WORK,
      }),
    ).toEqual({ accountId: "acct-google", calendarId: WORK });
  });

  it("a picked calendar still outranks the default", () => {
    expect(
      pickCreateTarget(ACCOUNTS, {
        defaultAccountId: "acct-google",
        defaultCalendarId: WORK,
        accountId: "acct-google",
        calendarId: CHURCH,
      }),
    ).toEqual({ accountId: "acct-google", calendarId: CHURCH });
  });

  it("never honours a default calendar outside the default account", () => {
    // A calendar id alone is not an address — Work belongs to Google here, so
    // naming it under the iCloud default means the iCloud account's own.
    expect(
      pickCreateTarget(ACCOUNTS, { defaultAccountId: "acct-icloud", defaultCalendarId: WORK }),
    ).toEqual({ accountId: "acct-icloud", calendarId: "https://caldav.example/home/" });
  });

  it("a hidden default calendar yields to the account's own (D-047)", () => {
    expect(
      pickCreateTarget(ACCOUNTS, {
        hiddenIds: [HIDDEN],
        defaultAccountId: "acct-google",
        defaultCalendarId: HIDDEN,
      }),
    ).toEqual({ accountId: "acct-google", calendarId: "you@example.com" });
  });
});

describe("the app and the agent agree on the default", () => {
  const SHAPES: Array<{ name: string; hidden: string[]; account: string | null; calendar: string | null }> = [
    { name: "default calendar set", hidden: [HIDDEN], account: "acct-google", calendar: WORK },
    { name: "account only (every row before migration 87)", hidden: [HIDDEN], account: "acct-google", calendar: null },
    { name: "Apple default", hidden: [HIDDEN], account: "acct-icloud", calendar: "https://caldav.example/family/" },
    { name: "default calendar hidden", hidden: [HIDDEN, WORK], account: "acct-google", calendar: WORK },
    { name: "no default at all", hidden: [HIDDEN], account: null, calendar: null },
  ];

  for (const shape of SHAPES) {
    it(shape.name, () => {
      const app = pickCreateTarget(ACCOUNTS, {
        hiddenIds: shape.hidden,
        defaultAccountId: shape.account,
        defaultCalendarId: shape.calendar,
      });
      const agent = pickDefaultCalendar(buildWritableCalendars(RAW, shape.hidden, shape.account, shape.calendar));
      expect(agent ? { accountId: agent.accountId, calendarId: agent.calendarId } : null).toEqual(app);
    });
  }
});

describe("CalendarTargetList", () => {
  const groups = createTargetGroups(ACCOUNTS, [HIDDEN]);

  it("offers every visible writable calendar under its account, and marks the default", () => {
    render(
      <CalendarTargetList
        groups={groups}
        value={null}
        defaultTarget={{ accountId: "acct-google", calendarId: WORK }}
        onPick={() => {}}
      />,
    );
    const names = screen.getAllByRole("radio").map((r) => r.textContent);
    expect(names).toEqual(["Home", "Family", "You", "Workdefault", "Church"]);
    expect(screen.getByText("you@icloud.com · iCloud")).toBeTruthy();
    expect(screen.queryByText(/Hidden/)).toBeNull();
    expect(screen.queryByText(/read-only/)).toBeNull();
  });

  it("hands back the account AND the calendar", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<CalendarTargetList groups={groups} value={null} onPick={onPick} />);
    await user.click(screen.getByText("Church"));
    expect(onPick).toHaveBeenCalledWith({ accountId: "acct-google", calendarId: CHURCH });
  });
});

describe("Task → Event asks which calendar, on both doors", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", "src", p), "utf8");

  it("the Schedule's right-click menu turns into the list and passes the pick", () => {
    const src = read("components/CalendarPane.tsx");
    const menu = src.slice(src.indexOf("taskEventMode && onConvertTaskToEvent"));
    expect(menu).toContain("<CalendarTargetList");
    expect(menu).toContain("onConvertTaskToEvent(task, target)");
  });

  it("the task card's footer opens the list and passes the pick", () => {
    const src = read("components/SlideOver.tsx");
    expect(src).toContain("onPick={(target) => { onConvertToEvent(target); dismiss(); }}");
    expect(src).toContain("onConvertTaskToEvent(openTask, target)");
  });

  it("the convert honours the pick, then the default", () => {
    const src = read("components/Planner.tsx");
    const fn = src.slice(src.indexOf("const handleConvertTaskToEvent"), src.indexOf("return (", src.indexOf("const handleConvertTaskToEvent")));
    expect(fn).toContain("...createDefaults(settings)");
    expect(fn).toContain("calendarId: picked?.calendarId");
  });
});
