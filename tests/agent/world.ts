// The account the agent is tested against, and stand-ins for the two calendar
// write-back functions it calls.
//
// Phil's actual shape, reduced to what a calendar decision depends on: a Google
// account that is the default, an iCloud account carrying **Family**, and a
// read-only Microsoft account. Every case in agent-calendar.test.ts starts from
// this same world so a failure means the agent changed, not the fixture.
import { db, resetDb, type Row } from "./fakeSupabase.ts";

export const USER = "user-phil";
export const TZ = "America/Los_Angeles";

export const GOOGLE_ACCOUNT = "acct-google";
export const ICLOUD_ACCOUNT = "acct-icloud";
export const M365_ACCOUNT = "acct-m365";

export const GOOGLE_PRIMARY = "phillipchan1@gmail.com";
export const FAMILY_CAL = "https://caldav.icloud.com/1234/calendars/family/";
export const PERSONAL_CAL = "https://caldav.icloud.com/1234/calendars/personal/";

/** Every call the tools made to a sibling edge function, in order. */
export interface FnCall {
  fn: string;
  body: Record<string, unknown>;
}
export const calls: FnCall[] = [];

let nextId = 0;

export function seedWorld(extra: { external_events?: Row[] } = {}): void {
  nextId = 0;
  calls.length = 0;
  resetDb({
    calendar_accounts: [
      {
        id: GOOGLE_ACCOUNT,
        user_id: USER,
        provider: "google",
        email: GOOGLE_PRIMARY,
        sync_direction: "two_way",
        calendars: [{ id: GOOGLE_PRIMARY, summary: GOOGLE_PRIMARY }],
      },
      {
        id: ICLOUD_ACCOUNT,
        user_id: USER,
        provider: "icloud",
        email: "phil@icloud.com",
        sync_direction: "two_way",
        calendars: [
          { id: FAMILY_CAL, summary: "Family" },
          { id: PERSONAL_CAL, summary: "Personal" },
        ],
      },
      {
        id: M365_ACCOUNT,
        user_id: USER,
        provider: "m365",
        email: "phil@work.example",
        sync_direction: "one_way",
        calendars: [{ id: "work-cal", summary: "Work" }],
      },
    ],
    user_settings: [
      {
        user_id: USER,
        hidden_calendar_ids: [],
        default_calendar_account_id: GOOGLE_ACCOUNT,
        day_start_hour: 8,
        day_end_hour: 18,
      },
    ],
    external_events: extra.external_events ?? [],
    tasks: [],
    sprints: [],
    projects: [],
  });
}

/** An external_events row, with the fixture's defaults filled in. */
export function event(over: Partial<Row> & { id: string; title: string; start_at: string; end_at: string }): Row {
  return {
    user_id: USER,
    account_id: ICLOUD_ACCOUNT,
    calendar_id: FAMILY_CAL,
    provider_event_id: `uid-${over.id}`,
    all_day: false,
    location: null,
    busy: true,
    raw: { caldav_href: `${FAMILY_CAL}${over.id}.ics` },
    ...over,
  };
}

export const events = () => (db.external_events ?? []) as Row[];
export const eventsTitled = (title: string) => events().filter((e) => e.title === title);

function accountProvider(accountId: string): string {
  return String((db.calendar_accounts ?? []).find((a) => a.id === accountId)?.provider ?? "");
}

/**
 * google-events / icloud-events, reduced to the behaviour the agent depends on.
 *
 * The asymmetry is deliberate and load-bearing: on a patch, **icloud-events
 * updates the mirror row and google-events does not** (it only refreshes `raw`).
 * That is exactly the real code, and it is why reschedule_event has to mirror
 * locally itself — a fake that tidied it away would let that regress unnoticed.
 */
function runEventsFn(fn: string, body: Record<string, unknown>): { ok: boolean; json: unknown } {
  const provider = fn === "icloud-events" ? "icloud" : "google";
  const rows = (db.external_events ??= []);

  if (body.action === "create") {
    const accountId = String(body.accountId ?? "");
    if (accountProvider(accountId) !== provider) return { ok: false, json: { error: "wrong provider" } };
    const row = {
      id: `evt-new-${++nextId}`,
      user_id: USER,
      account_id: accountId,
      calendar_id: body.calendarId,
      provider_event_id: `uid-new-${nextId}`,
      title: body.title,
      start_at: body.start_at,
      end_at: body.end_at,
      all_day: false,
      location: body.location ?? null,
      busy: true,
      raw: {},
    };
    rows.push(row);
    return { ok: true, json: { ok: true, event: row } };
  }

  const evt = rows.find((r) => r.id === body.eventId);
  if (!evt) return { ok: false, json: { error: "event not found" } };
  // Both functions refuse an event that isn't theirs — this is what made a
  // hardcoded "google-events" fail on an Apple event the agent had just created.
  if (accountProvider(String(evt.account_id)) !== provider) {
    return { ok: false, json: { error: "not this provider's event" } };
  }

  if (body.action === "delete") {
    db.external_events = rows.filter((r) => r.id !== body.eventId);
    return { ok: true, json: { ok: true } };
  }
  if (body.action === "move") {
    evt.calendar_id = body.calendarId;
    return { ok: true, json: { ok: true } };
  }
  if (body.patch) {
    if (provider === "icloud") Object.assign(evt, body.patch);
    // google-events deliberately leaves start_at/end_at/title on the row alone.
    return { ok: true, json: { ok: true } };
  }
  return { ok: false, json: { error: "patch or action required" } };
}

/** Route the tools' real `fetch` at the fakes above, and record every call. */
export function installFetch(): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const m = /\/functions\/v1\/([\w-]+)$/.exec(url);
    if (!m) throw new Error(`unexpected fetch in a tool test: ${url}`);
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ fn: m[1], body });

    if (m[1] === "google-events" || m[1] === "icloud-events") {
      const { ok, json } = runEventsFn(m[1], body);
      return Promise.resolve(
        new Response(JSON.stringify(json), { status: ok ? 200 : 400, headers: { "Content-Type": "application/json" } }),
      );
    }
    // task-mirror and friends: succeed silently, they're not under test here.
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  }) as typeof fetch;
}
