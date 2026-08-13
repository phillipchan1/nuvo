// Inviting people — one rule for who a name means, and one rule for what the
// app must say before mail leaves the building.
//
// D-046 settled the principle: nothing emails a human without saying so, and the
// notification is a caller decision end to end. It settled it in the grid
// composer, which was the only place that could invite anyone. Chat can now do
// it too, and a second copy of "who gets mailed, and does it say so" is exactly
// the drift this repo keeps paying for — so the consent sentence, the default,
// and the name-to-person rule live here and both ends import them.
//
// The division of labour that makes this safe:
//   · the agent RESOLVES and STAGES (this module + a DB lookup) — it never sends
//   · the client SENDS, from a card the user tapped, through the same mutation
//     the composer uses
// There is deliberately no agent tool that puts mail on the wire. The guard is
// structural, not a line in a prompt.
//
// Zero imports, pure — imported by the browser (src/) and by edge functions.

/** Where we know an address from. `meeting` is the weak claim: they turned up on
 *  a synced event, we never saw them in an address book. */
export type ContactSource = "google" | "apple" | "meeting";

export interface ContactCandidate {
  email: string;
  displayName: string | null;
  /** Meeting count — the only frequency signal we have. Ranking only. */
  freq: number;
  sources: ContactSource[];
}

/** One person on a staged invite, after resolution. */
export interface InviteRecipient {
  email: string;
  /** Their name, when any source knows it. Never the address dressed up as one. */
  name: string | null;
  sources: ContactSource[];
  /** False when the user typed an address we've never seen — worth saying so. */
  known: boolean;
}

/** A name the agent could not turn into exactly one person. Never guessed past. */
export interface InviteAmbiguity {
  /** What the user said — "matt", "dave from church". */
  query: string;
  /** Who it could be. Empty means nobody: we have no address for them at all. */
  candidates: ContactCandidate[];
}

export type InviteMode = "create" | "add_guests";

/** A staged invite: everything needed to send, and nothing sent.
 *
 *  Serialized to the client as-is. The client re-reads the event from its own
 *  cache before acting on `add_guests`, so nothing here is trusted as state —
 *  it's a proposal, and the user's tap is what makes it real. */
export interface InviteDraft {
  mode: InviteMode;
  title: string;
  /** ISO instants. Absent on `add_guests` — the event already owns its time. */
  startAt?: string;
  endAt?: string;
  /** The event being added to, on `add_guests`. */
  eventId?: string;
  recipients: InviteRecipient[];
  /** Where it lands: display name + the account it belongs to. */
  calendarName?: string;
  accountEmail?: string;
  /** calendar_accounts.id / calendar id — passed straight back on send. */
  accountId?: string;
  calendarId?: string;
  location?: string;
  /** Whether this event will carry a Meet link, already decided by
   *  `shouldAddMeet` — the card says so because the link rides the invite. */
  addMeet: boolean;
  /** Google RRULE lines when this is a repeating series — set on `create` only;
   *  a recurrence on an event that already exists is a separate, later edit,
   *  not something `add_guests` takes on. */
  recurrence?: string[];
  /** Names that stayed ambiguous. The agent asks about these instead of
   *  picking; the card shows them as unfinished business, never as recipients. */
  unresolved?: InviteAmbiguity[];
}

/** An invite nobody is told about is not an invite. Overridable, never silent. */
export const DEFAULT_NOTIFY_GUESTS = true;

/** Only Google carries guests today. Apple/CardDAV events are personal rows: we
 *  can write the event, we cannot invite anyone to it — and the caller must say
 *  that out loud rather than dropping the guest list on the floor. */
export function supportsGuests(provider: string | null | undefined): boolean {
  return provider === "google";
}

/** What a source is called out loud. Sources are labelled, never blended
 *  (D-046): a merged list that won't say where a name came from asks you to
 *  trust it blindly, and that matters most right before you mail someone. */
export function sourceLabel(source: ContactSource): string {
  switch (source) {
    case "google":
      return "Google";
    case "apple":
      return "Apple";
    case "meeting":
      return "Met before";
  }
}

export function guestNoun(count: number): string {
  return count === 1 ? "guest" : "guests";
}

/** The sentence shown immediately before mail can leave — the one thing D-046
 *  requires. Names the count and whether a Meet link rides along; the recipients
 *  themselves are listed beside it, because a count is not a who. */
export function inviteConsentPrompt(opts: { mode: InviteMode; count: number; addMeet: boolean }): string {
  const n = opts.count;
  const who =
    opts.mode === "add_guests"
      ? n === 1
        ? "the new guest"
        : `these ${n} new guests`
      : n === 1
        ? "this guest"
        : `these ${n} guests`;
  return `Email ${who} an invite${opts.addMeet ? " with a Google Meet link" : ""}?`;
}

/** What the quiet option does — the phrasing has to be honest that the event
 *  still lands on their calendar; only the mail is skipped. */
export const QUIET_HINT = "Adds them to the event without sending an email.";

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function isEmailAddress(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/** Every word we'd accept as "that's them": the name's parts plus the address's
 *  local part, so "matt" matches both *Matt Hansen* and `matt@…`. */
function handles(c: ContactCandidate): string[] {
  const words = (c.displayName ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const local = c.email.split("@")[0].toLowerCase();
  return [...words, ...local.split(/[^\p{L}\p{N}]+/u).filter(Boolean), local];
}

export type RecipientPick =
  | { status: "resolved"; recipient: InviteRecipient }
  | { status: "ambiguous"; candidates: ContactCandidate[] }
  | { status: "unresolved" };

/**
 * Turn one thing the user said into one person — or refuse.
 *
 * The refusal is the feature. Mail is irreversible, so "probably Matt" is not a
 * good enough answer: a name that matches two people comes back as a question,
 * and a name that matches nobody comes back as "I don't have an address",
 * never as the closest-looking row. Ranking already put the best match first;
 * this decides whether first is *unambiguously* right.
 *
 * `candidates` is what the contact search returned for `query`, best first.
 */
export function pickRecipient(query: string, candidates: ContactCandidate[]): RecipientPick {
  const q = normalize(query);
  if (!q) return { status: "unresolved" };

  // A complete address the user typed is the user's own answer — take it, and
  // note whether we actually know them so the card can flag a stranger.
  if (isEmailAddress(q)) {
    const known = candidates.find((c) => c.email.toLowerCase() === q);
    return {
      status: "resolved",
      recipient: known
        ? toRecipient(known)
        : { email: q, name: null, sources: [], known: false },
    };
  }

  if (!candidates.length) return { status: "unresolved" };

  // Every word has to land, so "matt hansen" separates the two Matts that
  // "matt" alone cannot. A full name is the most common thing the agent passes.
  const words = q.split(/\s+/).filter(Boolean);
  const exact = candidates.filter((c) => {
    const h = handles(c);
    return words.every((w) => h.includes(w));
  });
  const pool = exact.length
    ? exact
    : candidates.filter((c) => {
        const h = handles(c);
        return words.every((w) => h.some((x) => x.startsWith(w)));
      });

  if (pool.length === 1) return { status: "resolved", recipient: toRecipient(pool[0]) };
  if (pool.length > 1) return { status: "ambiguous", candidates: pool.slice(0, 5) };
  // Fuzzy-only hits (the search matched, no handle did). Never auto-taken:
  // this is where "typing an address suggested a stranger" lived.
  return { status: "ambiguous", candidates: candidates.slice(0, 5) };
}

export function toRecipient(c: ContactCandidate): InviteRecipient {
  return {
    email: c.email,
    name: c.displayName && normalize(c.displayName) !== c.email.toLowerCase() ? c.displayName : null,
    sources: c.sources,
    known: true,
  };
}

/** How a recipient reads on one line: name first, address as the proof. */
export function recipientLabel(r: InviteRecipient): string {
  return r.name ? `${r.name} · ${r.email}` : r.email;
}

/** Drop duplicates (the same person named twice, or a name that resolved to an
 *  address the user also typed) without disturbing order. */
export function dedupeRecipients(recipients: InviteRecipient[]): InviteRecipient[] {
  const seen = new Set<string>();
  const out: InviteRecipient[] = [];
  for (const r of recipients) {
    const key = r.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, email: key });
  }
  return out;
}
