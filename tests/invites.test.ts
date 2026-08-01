import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFY_GUESTS,
  dedupeRecipients,
  inviteConsentPrompt,
  isEmailAddress,
  pickRecipient,
  recipientLabel,
  sourceLabel,
  supportsGuests,
  type ContactCandidate,
} from "../supabase/functions/_shared/invites";

const matt: ContactCandidate = {
  email: "matt.hansen@example.com",
  displayName: "Matt Hansen",
  freq: 12,
  sources: ["google", "meeting"],
};
const otherMatt: ContactCandidate = {
  email: "mreyes@example.com",
  displayName: "Matt Reyes",
  freq: 3,
  sources: ["apple"],
};
const daniel: ContactCandidate = {
  email: "daniel@example.com",
  displayName: "Daniel Hoang",
  freq: 30,
  sources: ["google"],
};

describe("resolving a name to a person", () => {
  it("takes a single unambiguous match", () => {
    const pick = pickRecipient("matt", [matt]);
    expect(pick.status).toBe("resolved");
    if (pick.status !== "resolved") return;
    expect(pick.recipient.email).toBe("matt.hansen@example.com");
    expect(pick.recipient.name).toBe("Matt Hansen");
    expect(pick.recipient.known).toBe(true);
  });

  it("refuses to choose between two people with the same first name", () => {
    // The whole point. Ranking would happily hand back the most-met Matt, and
    // mail is not undoable — two Matts is a question, not a default.
    const pick = pickRecipient("matt", [matt, otherMatt]);
    expect(pick.status).toBe("ambiguous");
    if (pick.status !== "ambiguous") return;
    expect(pick.candidates.map((c) => c.email)).toEqual([matt.email, otherMatt.email]);
  });

  it("matches a full name, a surname, or the address's local part", () => {
    expect(pickRecipient("hansen", [matt, daniel]).status).toBe("resolved");
    expect(pickRecipient("Matt Hansen", [matt, otherMatt]).status).toBe("resolved");
    expect(pickRecipient("daniel", [daniel]).status).toBe("resolved");
  });

  it("accepts a prefix only when it points at one person", () => {
    expect(pickRecipient("dan", [daniel]).status).toBe("resolved");
    expect(pickRecipient("mat", [matt, otherMatt]).status).toBe("ambiguous");
  });

  it("says it doesn't know rather than offering the nearest row", () => {
    // D-046's bug in a new coat: fuzzy search returning *something* for every
    // query is exactly how a stranger's address suggested a frequent contact.
    expect(pickRecipient("cory", []).status).toBe("unresolved");
    const fuzzy = pickRecipient("cory", [matt, daniel]);
    expect(fuzzy.status).toBe("ambiguous");
  });

  it("takes a complete address the user typed, known or not", () => {
    const known = pickRecipient("daniel@example.com", [daniel]);
    expect(known.status).toBe("resolved");
    if (known.status === "resolved") {
      expect(known.recipient.known).toBe(true);
      expect(known.recipient.name).toBe("Daniel Hoang");
    }

    const stranger = pickRecipient("nobody@elsewhere.com", []);
    expect(stranger.status).toBe("resolved");
    if (stranger.status === "resolved") {
      // Flagged, not blocked — the card says "not in contacts" beside them.
      expect(stranger.recipient.known).toBe(false);
      expect(stranger.recipient.name).toBeNull();
    }
  });

  it("never presents an address as a person's name", () => {
    const asName: ContactCandidate = { ...daniel, displayName: "daniel@example.com" };
    const pick = pickRecipient("daniel@example.com", [asName]);
    expect(pick.status).toBe("resolved");
    if (pick.status !== "resolved") return;
    expect(pick.recipient.name).toBeNull();
    expect(recipientLabel(pick.recipient)).toBe("daniel@example.com");
  });

  it("drops the same person named twice", () => {
    const rs = dedupeRecipients([
      { email: "Matt.Hansen@example.com", name: "Matt Hansen", sources: ["google"], known: true },
      { email: "matt.hansen@example.com", name: null, sources: [], known: true },
    ]);
    expect(rs).toHaveLength(1);
    expect(rs[0].email).toBe("matt.hansen@example.com");
    expect(rs[0].name).toBe("Matt Hansen");
  });

  it("validates addresses the same way the contact writer does", () => {
    expect(isEmailAddress("a@b.co")).toBe(true);
    expect(isEmailAddress("matt")).toBe(false);
    expect(isEmailAddress("matt@localhost")).toBe(false);
  });
});

describe("what the user is told before mail leaves", () => {
  it("names the count and whether a Meet link rides along", () => {
    expect(inviteConsentPrompt({ mode: "create", count: 1, addMeet: false })).toBe(
      "Email this guest an invite?",
    );
    expect(inviteConsentPrompt({ mode: "create", count: 3, addMeet: true })).toBe(
      "Email these 3 guests an invite with a Google Meet link?",
    );
  });

  it("distinguishes adding guests to an existing meeting", () => {
    expect(inviteConsentPrompt({ mode: "add_guests", count: 2, addMeet: false })).toBe(
      "Email these 2 new guests an invite?",
    );
  });

  it("defaults to telling people — an invite nobody is told about isn't one", () => {
    expect(DEFAULT_NOTIFY_GUESTS).toBe(true);
  });

  it("labels every source, never blends them", () => {
    expect(sourceLabel("google")).toBe("Google");
    expect(sourceLabel("apple")).toBe("Apple");
    expect(sourceLabel("meeting")).toBe("Met before");
  });

  it("only Google carries guests", () => {
    expect(supportsGuests("google")).toBe(true);
    expect(supportsGuests("icloud")).toBe(false);
    expect(supportsGuests(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The structural guard. The safety property of this feature is not "the prompt
// tells the model to ask first" — a prompt is a suggestion. It's that no code
// path reachable from a tool call can put an invite on the wire: the agent
// resolves and stages, the client sends from a card the user tapped.
// ---------------------------------------------------------------------------
const SHARED = "supabase/functions/_shared/invites.ts";

/** Comments are not code. A guard that reads them flags the very comment that
 *  explains why the danger isn't there. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else out.push(full);
  }
  return out;
}

describe("the agent cannot email anyone", () => {
  const agentFiles = sourceFiles("supabase/functions/agent").filter((f) => /\.ts$/.test(f));

  it("never invokes the invite action", () => {
    const offenders = agentFiles.filter((f) =>
      /action:\s*["']invite["']/.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(
      offenders,
      "adding guests is a user act — stage an InviteDraft and let the card call inviteToEvent",
    ).toEqual([]);
  });

  it("never forwards a guest list to an events function", () => {
    // create_calendar_event routes anything with attendees into stageInvite, so
    // no `attendees` may appear in a body sent to google-events / icloud-events.
    const offenders = agentFiles.filter((f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      return /action:\s*["']create["'][\s\S]{0,400}?\battendees\b/.test(src);
    });
    expect(offenders, `route guests through stageInvite (${SHARED}), never straight to create`).toEqual([]);
  });

  it("never decides for itself whether guests get mailed", () => {
    const offenders = agentFiles.filter((f) => /\bnotifyGuests\b/.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders, "notifyGuests is the user's choice, made on the card — not a tool argument").toEqual(
      [],
    );
  });
});

describe("consent has one implementation", () => {
  const files = sourceFiles("src")
    .concat(sourceFiles("supabase/functions"))
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith("invites.ts"));

  it("no surface writes its own version of the guest-consent sentence", () => {
    // Two doors onto outbound mail (the composer, the chat card) that word the
    // question differently is how one of them quietly stops asking properly.
    const offenders = files.filter((f) => /Email\s+(these|this)\s/.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders, `import inviteConsentPrompt from ${SHARED}`).toEqual([]);
  });
});
