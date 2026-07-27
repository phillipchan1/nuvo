// Regression suite for CalDAV calendar discovery.
//
// The thing being protected: **discovery must never quietly return an empty
// list.** iCloud sync reported `ok` on 1,022 consecutive runs while syncing
// nothing, because `parseCalendarList` tested for `name="VEVENT"` and Apple
// writes `name='VEVENT'`. Every calendar failed that test, discovery returned
// [], no events were fetched, and the set-based sweep in eventSync then deleted
// all 293 stored rows for the account — still reporting success.
//
// So the tests come in two halves:
//   1. parse a *real* captured iCloud calendar-home response (fixture below,
//      account id redacted) and assert the calendars we expect come out — the
//      only check that would have caught a server-side formatting change;
//   2. assert the shape of the failure: nothing recognized must be loud.
//
// Run: npm test

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { countResponses, parseCalendarList } from "../supabase/functions/_shared/caldav.ts";

const HOME = "https://p42-caldav.icloud.com/9000000000/calendars/";

const icloudHome = readFileSync(
  join(import.meta.dirname ?? __dirname, "fixtures/icloud-calendar-home.xml"),
  "utf8",
);

/** Wrap a resourcetype + component set in the minimum multistatus scaffolding. */
function collection(href: string, name: string, resourceType: string, compSet: string): string {
  return `<response xmlns="DAV:"><href>${href}</href><propstat><prop>` +
    `<displayname xmlns="DAV:">${name}</displayname>` +
    `<resourcetype xmlns="DAV:">${resourceType}</resourcetype>` +
    (compSet
      ? `<supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav">${compSet}</supported-calendar-component-set>`
      : "") +
    `</prop><status>HTTP/1.1 200 OK</status></propstat></response>`;
}

const multistatus = (...blocks: string[]) => `<?xml version="1.0" encoding="UTF-8"?><multistatus xmlns="DAV:">${blocks.join("")}</multistatus>`;
const CAL = `<collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/>`;

describe("parseCalendarList — real iCloud response", () => {
  const calendars = parseCalendarList(icloudHome, HOME);

  it("finds the account's event calendars", () => {
    // The exact bug: this was 0.
    expect(calendars.length).toBeGreaterThan(0);
    const names = calendars.map((c) => c.displayName);
    expect(names).toContain("Work");
    expect(names).toContain("Family");
    expect(names).toContain("Bible Reading Plan");
  });

  it("still excludes reminder lists, the home collection, inbox and outbox", () => {
    const names = calendars.map((c) => c.displayName);
    // VTODO-only collections — the component-set filter's actual job.
    expect(names).not.toContain("Grocery ⚠️");
    expect(names).not.toContain("Reminders ⚠️");
    const urls = calendars.map((c) => c.url);
    expect(urls).not.toContain(HOME);
    expect(urls.some((u) => /\/(inbox|outbox|notification)\/$/.test(u))).toBe(false);
  });

  it("returns absolute urls and normalizes Apple's #RRGGBBAA colors", () => {
    for (const c of calendars) expect(c.url.startsWith("https://")).toBe(true);
    const work = calendars.find((c) => c.displayName === "Work");
    expect(work?.color).toBe("#FF2968");
  });
});

describe("parseCalendarList — attribute quoting", () => {
  // Apple emits single quotes; RFC 4791 examples use double. A parser that
  // knows only one style drops every calendar on the other server.
  const cases: Array<[string, string]> = [
    ["single-quoted", `<comp name='VEVENT' xmlns='urn:ietf:params:xml:ns:caldav'/>`],
    ["double-quoted", `<comp name="VEVENT"/>`],
    ["prefixed and spaced", `<C:comp name = 'VEVENT'/>`],
  ];
  for (const [label, compSet] of cases) {
    it(`accepts a ${label} VEVENT component set`, () => {
      const xml = multistatus(collection(`${HOME}a/`, "A", CAL, compSet));
      expect(parseCalendarList(xml, HOME).map((c) => c.displayName)).toEqual(["A"]);
    });
  }

  it("keeps a calendar that reports no component set at all", () => {
    // The property is optional in RFC 4791 — excluding on silence would drop
    // calendars on servers that simply don't answer it.
    const xml = multistatus(collection(`${HOME}a/`, "A", CAL, ""));
    expect(parseCalendarList(xml, HOME)).toHaveLength(1);
  });

  it("still rejects a VTODO-only collection whatever the quoting", () => {
    const xml = multistatus(
      collection(`${HOME}a/`, "Todos", CAL, `<comp name='VTODO'/>`),
      collection(`${HOME}b/`, "Todos2", CAL, `<comp name="VTODO"/>`),
    );
    expect(parseCalendarList(xml, HOME)).toHaveLength(0);
  });

  it("does not mistake a longer component name for VEVENT", () => {
    const xml = multistatus(collection(`${HOME}a/`, "A", CAL, `<comp name='VEVENTX'/>`));
    expect(parseCalendarList(xml, HOME)).toHaveLength(0);
  });
});

describe("empty discovery is diagnosable", () => {
  // discoverCalendars turns both of these into a throw. The counts are what let
  // the message say *which* half broke: a server that sent nothing is the
  // user's problem (or Apple's); collections we failed to recognize is ours.
  it("distinguishes 'no collections' from 'nothing recognized'", () => {
    expect(countResponses(multistatus())).toBe(0);
    const unrecognized = multistatus(
      collection(`${HOME}a/`, "A", CAL, `<comp name=&VEVENT&/>`),
    );
    expect(countResponses(unrecognized)).toBe(1);
    expect(parseCalendarList(unrecognized, HOME)).toHaveLength(0);
  });
});
