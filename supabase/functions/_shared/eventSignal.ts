// What a calendar event tells a router about itself.
//
// The AI event router used to see a title and a calendar name, and nothing
// else. That is enough for "SCE quarterly review" and useless for the titles
// people actually use — "1:1", "Sync", "Coffee", "Standup" — which is most of a
// working week. The discriminating signal for a meeting is WHO IS IN IT, and it
// was already synced and sitting in `external_events.raw`; the router's prompt
// even had an `attendees` slot, which no caller had ever filled.
//
// The three providers store `raw` differently, so the shape-reading lives here
// once rather than inside the router:
//
//   · Google    — `raw.attendees[].email/displayName/self`, `raw.description`
//   · Microsoft — `raw.attendees[].emailAddress.address/.name`, `raw.bodyPreview`
//   · iCloud    — `raw` is only `{caldav_href, caldav_etag}`; degrade to nothing
//
// Same constraints as the rest of `_shared`: ZERO imports, pure, no I/O.

// deno-lint-ignore no-control-regex
const CONTROL = /[\x00-\x1F\x7F]/g;

const tidy = (s: unknown, max: number): string =>
  (typeof s === "string" ? s : "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Google books rooms and equipment as attendees. They are noise at best, and
 *  at worst a room name ("Irwindale-3F-Aspen") reads as a strong org signal for
 *  whichever domain shares a word with the building. */
const RESOURCE = /@resource\.calendar\.google\.com$/i;

const MAX_ATTENDEES = 6;

export interface EventSignal {
  /** Pre-joined "Name (@org.com), Name (@org.com)" — empty when unknowable. */
  attendees: string;
  description: string;
  location: string;
  /** Stable key for deduping: the sorted set of attendee ORG domains. See the
   *  note on {@link eventSignalKey}. */
  orgs: string[];
}

interface RawAttendee {
  email?: unknown;
  displayName?: unknown;
  self?: unknown;
  resource?: unknown;
  emailAddress?: { address?: unknown; name?: unknown } | null;
}

/** "Obi Nwosu <obi@sce.com>" → "Obi Nwosu", "@sce.com". The org domain is
 *  frequently a stronger routing signal than the person's name — an unlisted
 *  colleague from a known employer still reads as the day job — and it costs
 *  nothing to derive. */
function readAttendee(a: RawAttendee): { label: string; org: string } | null {
  if (a.self === true) return null; // the user is in every one of their own meetings
  const email = tidy(a.emailAddress?.address ?? a.email, 120).toLowerCase();
  if (email && (RESOURCE.test(email) || a.resource === true)) return null;
  const name = tidy(a.emailAddress?.name ?? a.displayName, 60);
  const org = email.includes("@") ? `@${email.slice(email.lastIndexOf("@") + 1)}` : "";
  const label = name || (email ? email.slice(0, email.indexOf("@")) || email : "");
  if (!label && !org) return null;
  return { label: label || org, org };
}

/** Strip the join-link boilerplate every provider staples onto a description —
 *  it is identical on every meeting, so it is pure prompt weight. */
function readDescription(raw: Record<string, unknown>): string {
  const src = typeof raw.description === "string" ? raw.description : raw.bodyPreview;
  return tidy(src, 400)
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?:join|dial|meeting id|passcode|phone|conference)[^.]{0,60}/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Read whatever this provider's `raw` blob can tell a router. Never throws —
 *  a caldav-only blob, a null, or a shape we've never seen all degrade to an
 *  empty signal, which is exactly the behaviour the router had before. */
export function readEventSignal(raw: unknown, location?: unknown): EventSignal {
  const empty: EventSignal = { attendees: "", description: "", location: tidy(location, 60), orgs: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const r = raw as Record<string, unknown>;

  const list = Array.isArray(r.attendees) ? (r.attendees as RawAttendee[]) : [];
  const labels: string[] = [];
  const orgs = new Set<string>();
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    const read = readAttendee(a);
    if (!read) continue;
    if (read.org) orgs.add(read.org);
    if (labels.length < MAX_ATTENDEES) labels.push(read.org && read.label !== read.org ? `${read.label} (${read.org})` : read.label);
  }

  return {
    attendees: labels.join(", "),
    description: readDescription(r),
    location: tidy(r.location ?? location, 60) || tidy(location, 60),
    orgs: [...orgs].sort(),
  };
}

/** The dedup key for "these two events are the same routing question".
 *
 *  The router routes each UNIQUE title once and fans the verdict out to every
 *  instance, which is what keeps a daily standup from costing thirty
 *  completions. With attendees in the prompt that optimization becomes a BUG if
 *  the key stays title-only: a "1:1" with your manager and a "1:1" with your
 *  pastor collapse into one verdict, and the attendee signal is discarded for
 *  all but the first — silently undoing the thing it was added for.
 *
 *  Keyed on the org domains rather than the individual addresses: it separates
 *  the cases that route differently without making every guest-list permutation
 *  its own completion. */
export function eventSignalKey(title: string, calendarName: string, sig: EventSignal): string {
  return [tidy(title, 200).toLowerCase(), tidy(calendarName, 120).toLowerCase(), sig.orgs.join("|")].join("§");
}
