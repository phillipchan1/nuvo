import { describe, expect, it } from "vitest";
import { hasRecognized, recognize } from "../src/lib/recognize";

// `recognize` decides what in a note becomes a tap. A missed link costs nothing; a
// wrong one dials a stranger — so most of this file is the things it must NOT link.

const found = (text: string) =>
  recognize(text)
    .filter((p) => p.kind !== "text")
    .map((p) => (p.kind === "text" ? null : [p.kind, p.text, p.href]));

/** Every phone-shaped string below must come back as plain text. */
const NOT_A_PHONE = [
  "6265550100", // a bare run — an account number as likely as a phone
  "18006265550", // the same with a leading 1
  "2026-10-26", // an ISO date
  "10/26/2026",
  "10-26-2026",
  "192.168.100.1", // an IP address
  "$1,234.56",
  "$79.99",
  "order 12345678",
  "confirmation 4471 9920 3318", // grouped digits that aren't a phone
  "4111 1111 1111 1111", // a card number
  "version 1.2.3",
  "123-456-7890", // area code starts with 1 — not a NANP number
  "Mon–Fri 8am–8pm ET (5am–5pm PT)",
  "since 2023 500 customers",
  "ID626-555-0100", // the tail of an identifier
  "626-555-01001", // one digit too many
  "626-555\n0100", // a newline never joins two lines into one number
  "+1", // a plus is not a number
  "+12 34", // too short to be international
];

describe("recognize — phone numbers", () => {
  it("finds the number in the note that started this, and nothing else in it", () => {
    const note =
      "Frontier Loyalty: 1-800-921-8101, Mon–Fri 8am–8pm ET (5am–5pm PT).\n\n" +
      `Script: "I've had 1 Gig since 2023, and you raised me from $69.99 to $79.99. New customers get 1 Gig for ` +
      `$64.99 and 500 for $44.99. Spectrum offered me 1 Gig at $60 with a free mobile line. I'd like it back at $50."`;
    expect(found(note)).toEqual([["phone", "1-800-921-8101", "tel:18009218101"]]);
  });

  it.each([
    ["(626) 555-0100", "tel:6265550100"],
    ["626-555-0100", "tel:6265550100"],
    ["626.555.0100", "tel:6265550100"],
    ["626 555 0100", "tel:6265550100"],
    ["1 (626) 555-0100", "tel:16265550100"],
    ["1-800-921-8101", "tel:18009218101"],
    ["+1 626 555 0100", "tel:+16265550100"],
    ["+1 (323) 555-0100", "tel:+13235550100"],
    ["+44 20 7946 0958", "tel:+442079460958"],
    ["+33 1 23 45 67 89", "tel:+33123456789"],
    ["+81 3-1234-5678", "tel:+81312345678"],
    ["+49 30 123456", "tel:+4930123456"],
  ])("recognises %s and dials what was typed", (typed, href) => {
    expect(found(`call ${typed} today`)).toEqual([["phone", typed, href]]);
  });

  it("reads a non-breaking space between groups — pasted numbers carry them", () => {
    const nbsp = String.fromCharCode(0xa0);
    const typed = ["+44", "20", "7946", "0958"].join(nbsp);
    expect(found(`call ${typed} today`)).toEqual([["phone", typed, "tel:+442079460958"]]);
  });

  it("invents no country code — a national number is dialled as written", () => {
    expect(found("626-555-0100")[0]?.[2]).toBe("tel:6265550100");
  });

  it("takes a number out of the middle of a sentence, punctuation and all", () => {
    expect(found("Call (626) 555-0100, then ask for Maya.")).toEqual([["phone", "(626) 555-0100", "tel:6265550100"]]);
    expect(found("Her line is 626-555-0100.")).toEqual([["phone", "626-555-0100", "tel:6265550100"]]);
  });

  it.each(NOT_A_PHONE)("leaves %j as plain text", (text) => {
    expect(found(text)).toEqual([]);
    expect(hasRecognized(text)).toBe(false);
  });

  it("is conservative about a national number from elsewhere with no +", () => {
    // Not guessed at: a UK "020 7946 0958" has no region to be read in, so it stays text.
    expect(found("020 7946 0958")).toEqual([]);
  });
});

describe("recognize — email and links", () => {
  it("finds an email and leaves the sentence's full stop out of it", () => {
    expect(found("Write to maya@example.com.")).toEqual([["email", "maya@example.com", "mailto:maya@example.com"]]);
  });

  it("finds a link, and leaves the sentence's punctuation out of it", () => {
    expect(found("Draft: https://docs.example.com/launch.")).toEqual([
      ["url", "https://docs.example.com/launch", "https://docs.example.com/launch"],
    ]);
    expect(found("(see https://example.com/a.)")).toEqual([["url", "https://example.com/a", "https://example.com/a"]]);
  });

  it("keeps a closing paren that belongs to the link", () => {
    const wiki = "https://en.wikipedia.org/wiki/Foo_(bar)";
    expect(found(`read ${wiki} first`)).toEqual([["url", wiki, wiki]]);
  });

  it("does not take a phone number out of an email address or a link", () => {
    expect(found("6265550100@vtext.com")).toEqual([["email", "6265550100@vtext.com", "mailto:6265550100@vtext.com"]]);
    const url = "https://x.example.com/call/626-555-0100";
    expect(found(url)).toEqual([["url", url, url]]);
  });

  it("finds all three in one note, in order", () => {
    const kinds = recognize("Maya — maya@example.com or (626) 555-0142; draft at https://docs.example.com/launch")
      .filter((p) => p.kind !== "text")
      .map((p) => p.kind);
    expect(kinds).toEqual(["email", "phone", "url"]);
  });
});

describe("recognize — shape", () => {
  it("is empty for empty text and one plain run for plain text", () => {
    expect(recognize("")).toEqual([]);
    expect(recognize("Check the competitor grid first.")).toEqual([
      { kind: "text", text: "Check the competitor grid first." },
    ]);
    expect(hasRecognized("")).toBe(false);
  });

  it("always concatenates back to exactly what was typed", () => {
    const samples = [
      "",
      "plain",
      "Call (626) 555-0100, or write maya@example.com.\nhttps://a.example/b?c=1, then 1-800-921-8101",
      "a 626-555-0100 b 626-555-0100 c",
      "((626) 555-0100)",
      "http://",
      "+44 20 7946 0958 and 15 minutes",
      ...NOT_A_PHONE,
    ];
    for (const s of samples) expect(recognize(s).map((p) => p.text).join("")).toBe(s);
  });

  it("is safe to call repeatedly — no matcher state leaks between calls", () => {
    for (let i = 0; i < 3; i++) {
      expect(found("Call 626-555-0100")).toEqual([["phone", "626-555-0100", "tel:6265550100"]]);
    }
  });
});
