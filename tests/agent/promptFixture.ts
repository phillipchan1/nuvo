// The snapshot the model reasons over in the prompt-level eval.
//
// Small on purpose — enough shape for a calendar or capture decision, not a
// replica of buildContext. The date table is built with the real kernel
// functions rather than typed out, so a case can never assert against a
// hand-written date the app would disagree with.
import { addDaysISO, calendarWeekStart, WEEKDAY_NAMES, weekDates } from "../../supabase/functions/_shared/planningRules.ts";

/** Tuesday. The day of the transcript every case is drawn from. */
export const TODAY = "2026-07-28";

function labelDate(iso: string): string {
  const day = WEEKDAY_NAMES[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return `${iso} (${day[0].toUpperCase()}${day.slice(1)})`;
}

function table(today: string) {
  const thisMonday = calendarWeekStart(today);
  const label = (dates: Record<string, string>) =>
    Object.fromEntries(Object.entries(dates).map(([d, iso]) => [d, labelDate(iso)]));
  return {
    today: labelDate(today),
    tomorrow: labelDate(addDaysISO(today, 1)),
    thisWeek: label(weekDates(thisMonday)),
    nextWeek: label(weekDates(addDaysISO(thisMonday, 7))),
  };
}

export function fixtureContext(today = TODAY) {
  return {
    today,
    nowISO: `${today}T17:05:00.000Z`,
    nowLabel: "Tue, 10:05 AM",
    dates: table(today),
    settings: { dayStartHour: 8, dayEndHour: 18 },
    todaySchedule: [
      { kind: "event", title: "Staff meeting", timeRange: "9:00 – 10:00 AM", localDate: today, past: true },
    ],
    todayFreeSlots: [{ start: "10:30 AM", end: "12:00 PM", minutes: 90 }],
    inbox: [],
    todayTasks: [],
    weekStart: "2026-07-27",
    weekSlate: [],
    needsASprint: [],
    nextWeekSlate: [],
    weekPriorities: [],
    weekPool: [],
    events: [],
    // A topical calendar sits here on purpose: naming an event after a person
    // must not route it to a calendar whose name merely sounds related.
    writableCalendars: [
      {
        accountId: "acct-google",
        provider: "google",
        accountEmail: "phillipchan1@gmail.com",
        calendarId: "phillipchan1@gmail.com",
        name: "phillipchan1@gmail.com",
        isDefault: true,
      },
      {
        accountId: "acct-icloud",
        provider: "icloud",
        accountEmail: "phil@icloud.com",
        calendarId: "cal-family",
        name: "Family",
      },
      {
        accountId: "acct-google",
        provider: "google",
        accountEmail: "phillipchan1@gmail.com",
        calendarId: "cal-womens",
        name: "Women's Ministry",
      },
    ],
    labels: [],
    vertical: {
      domains: [{ id: "dom-church", name: "Church" }, { id: "dom-family", name: "Family" }],
      initiatives: [],
      projects: [{ id: "proj-meridian", name: "Meridian Phase 2", domainId: "dom-church", status: "in_progress" }],
    },
  };
}
