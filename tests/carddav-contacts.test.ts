// Regression suite for CardDAV contact parsing.
//
// The sibling of caldav-discovery.test.ts, and here for the same reason: the
// iCloud calendar outage was a *parsing* bug — Apple wrote `name='VEVENT'`
// where the code expected `name="VEVENT"` — and no amount of network-level
// checking would have caught it. vCard has more formatting latitude than that
// XML did (line folding, group prefixes, parameter lists, escaped values), so
// the parser gets pinned to concrete payloads rather than to assumptions.
//
// The failure this prevents is quieter than the calendar one: a contact that
// fails to parse is simply a person the user cannot invite, with nothing
// logged and nothing to notice.
//
// Run: npm test

import { describe, expect, it } from "vitest";

import { parseAddressBookList, parseVCards } from "../supabase/functions/_shared/carddav.ts";

const HOME = "https://p42-contacts.icloud.com/9000000000/carddavhome/";

const multistatus = (...blocks: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><multistatus xmlns="DAV:">${blocks.join("")}</multistatus>`;

function collection(href: string, name: string, resourceType: string): string {
  return `<response xmlns="DAV:"><href>${href}</href><propstat><prop>` +
    `<displayname xmlns="DAV:">${name}</displayname>` +
    `<resourcetype xmlns="DAV:">${resourceType}</resourcetype>` +
    `</prop><status>HTTP/1.1 200 OK</status></propstat></response>`;
}

const BOOK = `<collection/><addressbook xmlns="urn:ietf:params:xml:ns:carddav"/>`;

describe("parseAddressBookList", () => {
  it("finds addressbook collections and skips the home set itself", () => {
    const xml = multistatus(
      collection(HOME, "Home", `<collection/>`),
      collection(`${HOME}card/`, "Contacts", BOOK),
    );
    const books = parseAddressBookList(xml, HOME);
    expect(books).toHaveLength(1);
    expect(books[0].displayName).toBe("Contacts");
    expect(books[0].url).toBe(`${HOME}card/`);
  });

  it("ignores non-addressbook collections", () => {
    const xml = multistatus(collection(`${HOME}notes/`, "Notes", `<collection/>`));
    expect(parseAddressBookList(xml, HOME)).toHaveLength(0);
  });

  it("resolves relative hrefs against the home url", () => {
    const xml = multistatus(collection("/9000000000/carddavhome/card/", "Contacts", BOOK));
    expect(parseAddressBookList(xml, HOME)[0].url).toBe(`${HOME}card/`);
  });

  it("survives a namespace prefix on the addressbook element", () => {
    const xml = multistatus(
      collection(`${HOME}card/`, "Contacts", `<D:collection/><C:addressbook xmlns:C="urn:ietf:params:xml:ns:carddav"/>`),
    );
    expect(parseAddressBookList(xml, HOME)).toHaveLength(1);
  });
});

describe("parseVCards", () => {
  it("reads a plain card", () => {
    const out = parseVCards(
      `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ada Lovelace\r\nEMAIL:ada@example.com\r\nEND:VCARD\r\n`,
    );
    expect(out).toEqual([{ email: "ada@example.com", displayName: "Ada Lovelace" }]);
  });

  it("handles Apple's group prefixes and type parameters", () => {
    // Apple emits `item1.EMAIL;type=INTERNET;type=pref:` constantly. Reading the
    // property name naively leaves "ITEM1.EMAIL;TYPE=INTERNET" and matches nothing.
    const out = parseVCards(
      `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Grace Hopper\r\n` +
        `item1.EMAIL;type=INTERNET;type=pref:grace@navy.mil\r\nEND:VCARD\r\n`,
    );
    expect(out).toEqual([{ email: "grace@navy.mil", displayName: "Grace Hopper" }]);
  });

  it("unfolds wrapped lines", () => {
    // RFC 6350 folding: a CRLF followed by a space continues the value. Parsing
    // line-at-a-time truncates the address mid-string.
    const out = parseVCards(
      `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Long Name\r\nEMAIL:someone.with.a.very\r\n .long.address@example.com\r\nEND:VCARD\r\n`,
    );
    expect(out[0].email).toBe("someone.with.a.very.long.address@example.com");
  });

  it("returns one row per address so every address is invitable", () => {
    const out = parseVCards(
      `BEGIN:VCARD\r\nFN:Two Inboxes\r\nEMAIL:work@example.com\r\nEMAIL:home@example.org\r\nEND:VCARD\r\n`,
    );
    expect(out.map((c) => c.email)).toEqual(["work@example.com", "home@example.org"]);
    expect(out.every((c) => c.displayName === "Two Inboxes")).toBe(true);
  });

  it("falls back to N, then ORG, when FN is absent", () => {
    const structured = parseVCards(`BEGIN:VCARD\r\nN:Turing;Alan;;;\r\nEMAIL:alan@example.com\r\nEND:VCARD\r\n`);
    expect(structured[0].displayName).toBe("Alan Turing");

    const org = parseVCards(`BEGIN:VCARD\r\nORG:Acme Corp;Sales\r\nEMAIL:sales@acme.com\r\nEND:VCARD\r\n`);
    expect(org[0].displayName).toBe("Acme Corp");
  });

  it("parses several cards from one REPORT blob", () => {
    const out = parseVCards(
      `BEGIN:VCARD\r\nFN:One\r\nEMAIL:one@example.com\r\nEND:VCARD\r\n` +
        `BEGIN:VCARD\r\nFN:Two\r\nEMAIL:two@example.com\r\nEND:VCARD\r\n`,
    );
    expect(out).toHaveLength(2);
  });

  it("drops cards with no usable address rather than inventing one", () => {
    const out = parseVCards(
      `BEGIN:VCARD\r\nFN:No Contact Details\r\nTEL:+15550100\r\nEND:VCARD\r\n` +
        `BEGIN:VCARD\r\nFN:Malformed\r\nEMAIL:not-an-address\r\nEND:VCARD\r\n`,
    );
    expect(out).toHaveLength(0);
  });

  it("normalizes case and de-duplicates within a card", () => {
    const out = parseVCards(
      `BEGIN:VCARD\r\nFN:Shouty\r\nEMAIL:Person@Example.COM\r\nEMAIL:person@example.com\r\nEND:VCARD\r\n`,
    );
    expect(out).toEqual([{ email: "person@example.com", displayName: "Shouty" }]);
  });

  it("returns nothing for an empty payload instead of throwing", () => {
    expect(parseVCards("")).toEqual([]);
  });
});
