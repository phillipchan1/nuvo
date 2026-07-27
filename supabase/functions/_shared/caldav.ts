// Minimal CalDAV client for iCloud (caldav.icloud.com).
//
// Apple has no OAuth for iCloud calendars — the credential is the user's Apple
// ID plus an *app-specific password* (appleid.apple.com → Sign-In and Security →
// App-Specific Passwords). We authenticate with HTTP Basic and speak just enough
// of RFC 4791 to (a) discover the calendars, (b) pull events in a window as
// iCalendar text (reused by the shared `parseIcs`), and (c) create / update /
// delete single events for two-way sync.
//
// The XML is parsed with namespace-agnostic regexes rather than a DOM parser:
// the Supabase edge runtime has no DOMParser, the responses are small and
// predictable, and this keeps the function dependency-free.

const ICLOUD_BASE = "https://caldav.icloud.com";
const UA = "Nuvo/1.0";

export interface CalDavCalendar {
  /** Absolute collection URL — the stable id we store as calendar_id. */
  url: string;
  displayName: string;
  /** #RRGGBB, normalized from Apple's #RRGGBBAA, or null. */
  color: string | null;
}

export interface CalDavEvent {
  /** Absolute resource URL — needed for PUT/DELETE write-back. */
  href: string;
  etag: string | null;
  /** Raw VCALENDAR text (a full calendar wrapping this event). */
  ics: string;
}

// ── Auth ────────────────────────────────────────────────────────────────
export function basicAuth(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

// ── Low-level DAV request with manual redirect following ──────────────────
// iCloud 301-redirects PROPFIND/REPORT from caldav.icloud.com to a per-shard
// host (pNN-caldav.icloud.com). fetch()'s automatic redirect can drop the method
// and body for a 301, so we follow manually and re-send everything.
async function dav(
  url: string,
  init: { method: string; auth: string; depth?: "0" | "1"; body?: string },
): Promise<Response> {
  let current = url;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(current, {
      method: init.method,
      redirect: "manual",
      headers: {
        Authorization: init.auth,
        "User-Agent": UA,
        ...(init.depth ? { Depth: init.depth } : {}),
        ...(init.body ? { "Content-Type": "application/xml; charset=utf-8" } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
    });
    if ([301, 302, 307, 308].includes(res.status)) {
      const loc = res.headers.get("Location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many CalDAV redirects");
}

// ── Tiny XML helpers (namespace-agnostic) ─────────────────────────────────
function unescapeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#13;", "\r")
    .replaceAll("&#10;", "\n")
    .replaceAll("&amp;", "&");
}

/** All inner texts for a local element name, ignoring any namespace prefix. */
function pickAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9]+:)?${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function pickFirst(xml: string, tag: string): string | null {
  const all = pickAll(xml, tag);
  return all.length ? all[0] : null;
}

/** Split a multistatus body into its <response> blocks. */
function responses(xml: string): string[] {
  return pickAll(xml, "response");
}

function normalizeColor(raw: string | null): string | null {
  if (!raw) return null;
  const hex = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(0, 6)}`; // #RRGGBBAA → #RRGGBB
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`;
  return null;
}

/** Does this collection advertise VEVENT support?
 *
 *  This is the filter that keeps reminder lists (VTODO-only) out of the
 *  calendar list, and it is where iCloud sync died silently: it tested for
 *  `name="VEVENT"` while Apple writes the attribute single-quoted —
 *  `<comp name='VEVENT' xmlns='urn:ietf:params:xml:ns:caldav'/>`. Every real
 *  calendar therefore had a non-empty component set that failed the match and
 *  was skipped, discovery returned [], and the sync reported success over an
 *  empty account. XML says nothing about which quote style a server picks, so
 *  accept either (and bare), and keep matching the tag namespace-agnostically.
 *
 *  An absent property still means "keep it" — RFC 4791 makes
 *  supported-calendar-component-set optional, and excluding on silence would
 *  drop calendars for the servers that omit it. */
function supportsVevent(compSet: string): boolean {
  if (!compSet.trim()) return true;
  return /<(?:[A-Za-z0-9]+:)?comp\b[^>]*\bname\s*=\s*(?:"VEVENT"|'VEVENT'|VEVENT\b)/i.test(compSet);
}

/** The pure half of discovery: multistatus XML → calendars.
 *
 *  Split out from the request chain so the parse can be tested against real
 *  captured iCloud responses — the bug above was a parsing bug that no amount
 *  of network-level checking would have caught. */
export function parseCalendarList(listXml: string, homeUrl: string): CalDavCalendar[] {
  const calendars: CalDavCalendar[] = [];
  for (const block of responses(listXml)) {
    const resourceType = pickFirst(block, "resourcetype") ?? "";
    // Only real calendar collections that hold events (skip reminders/inbox/outbox).
    if (!/<(?:[A-Za-z0-9]+:)?calendar\b/i.test(resourceType)) continue;
    if (!supportsVevent(pickFirst(block, "supported-calendar-component-set") ?? "")) continue;
    const href = pickFirst(block, "href");
    if (!href) continue;
    const url = new URL(href.trim(), homeUrl).toString();
    // Skip the home collection itself (its href equals the home set).
    if (url.replace(/\/$/, "") === homeUrl.replace(/\/$/, "")) continue;
    const displayName = unescapeXml(pickFirst(block, "displayname") ?? "").trim() || "Calendar";
    const color = normalizeColor(pickFirst(block, "calendar-color"));
    calendars.push({ url, displayName, color });
  }
  return calendars;
}

/** How many <response> blocks the server sent — used only to tell "the server
 *  gave us nothing" apart from "we failed to recognize what it gave us". */
export function countResponses(listXml: string): number {
  return responses(listXml).length;
}

// ── Discovery ─────────────────────────────────────────────────────────────
/** A revoked or changed app-specific password is the one failure the *user*
 *  has to fix, so it must never be reported as "the response looked odd".
 *  Apple can 401 at any hop — the partition host (pNN-caldav) re-authenticates
 *  independently of caldav.icloud.com — so every hop checks. */
function assertOk(res: Response, what: string): void {
  if (res.status === 401 || res.status === 403) {
    throw new Error("iCloud rejected the Apple ID or app-specific password");
  }
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status}`);
}

// 1. current-user-principal → 2. calendar-home-set → 3. list calendar collections.
export async function discoverCalendars(username: string, password: string): Promise<CalDavCalendar[]> {
  const auth = basicAuth(username, password);

  // 1. Principal.
  const principalRes = await dav(`${ICLOUD_BASE}/`, {
    method: "PROPFIND",
    auth,
    depth: "0",
    body: `<?xml version="1.0" encoding="utf-8"?><A:propfind xmlns:A="DAV:"><A:prop><A:current-user-principal/></A:prop></A:propfind>`,
  });
  assertOk(principalRes, "principal lookup");
  const principalXml = await principalRes.text();
  const principalHref =
    pickFirst(pickFirst(principalXml, "current-user-principal") ?? "", "href") ?? pickFirst(principalXml, "href");
  if (!principalHref) throw new Error("could not resolve iCloud principal");
  const principalUrl = new URL(principalHref.trim(), principalRes.url || `${ICLOUD_BASE}/`).toString();

  // 2. Calendar home set.
  const homeRes = await dav(principalUrl, {
    method: "PROPFIND",
    auth,
    depth: "0",
    body: `<?xml version="1.0" encoding="utf-8"?><A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><A:prop><C:calendar-home-set/></A:prop></A:propfind>`,
  });
  assertOk(homeRes, "calendar-home lookup");
  const homeXml = await homeRes.text();
  const homeHref = pickFirst(pickFirst(homeXml, "calendar-home-set") ?? "", "href");
  if (!homeHref) throw new Error("could not resolve iCloud calendar home");
  const homeUrl = new URL(homeHref.trim(), homeRes.url || principalUrl).toString();

  // 3. Enumerate collections under the home set.
  const listRes = await dav(homeUrl, {
    method: "PROPFIND",
    auth,
    depth: "1",
    body: `<?xml version="1.0" encoding="utf-8"?><A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:I="http://apple.com/ns/ical/"><A:prop><A:displayname/><A:resourcetype/><C:supported-calendar-component-set/><I:calendar-color/></A:prop></A:propfind>`,
  });
  assertOk(listRes, "calendar list");
  const listXml = await listRes.text();

  const calendars = parseCalendarList(listXml, homeUrl);

  // An empty list is never a legitimate answer, and returning one is what made
  // this failure invisible for ten days: syncAccount fetched nothing, reported
  // "ok", and the set-based sweep then deleted every stored event for the
  // account. A throw is the safe shape — it marks the account needs_reconnect
  // and leaves the cache intact — so discovery must fail loudly rather than
  // hand back []. Every iCloud account has at least one calendar; if we can't
  // see one, we are broken, not empty.
  if (!calendars.length) {
    const seen = countResponses(listXml);
    throw new Error(
      seen
        ? `iCloud listed ${seen} collections but none parsed as a VEVENT calendar — the CalDAV response shape changed`
        : "iCloud returned no collections for this calendar home",
    );
  }
  return calendars;
}

// ── Read events in a window ────────────────────────────────────────────────
function davDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function fetchEvents(
  calendarUrl: string,
  username: string,
  password: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<CalDavEvent[]> {
  const auth = basicAuth(username, password);
  const body =
    `<?xml version="1.0" encoding="utf-8"?><C:calendar-query xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
    `<A:prop><A:getetag/><C:calendar-data/></A:prop>` +
    `<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">` +
    `<C:time-range start="${davDate(windowStart)}" end="${davDate(windowEnd)}"/>` +
    `</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`;

  const res = await dav(calendarUrl, { method: "REPORT", auth, depth: "1", body });
  if (!res.ok) throw new Error(`calendar-query failed: HTTP ${res.status}`);
  const xml = await res.text();

  const events: CalDavEvent[] = [];
  for (const block of responses(xml)) {
    const data = pickFirst(block, "calendar-data");
    if (!data) continue;
    const ics = unescapeXml(data).trim();
    if (!ics.includes("BEGIN:VCALENDAR")) continue;
    const href = pickFirst(block, "href");
    if (!href) continue;
    events.push({
      href: new URL(href.trim(), calendarUrl).toString(),
      etag: pickFirst(block, "getetag")?.trim().replace(/^"|"$/g, "") ?? null,
      ics,
    });
  }
  return events;
}

// ── Write-back ──────────────────────────────────────────────────────────────
/** Fetch a single event resource (its full VCALENDAR + current etag). */
export async function getEvent(
  href: string,
  username: string,
  password: string,
): Promise<{ ics: string; etag: string | null }> {
  const res = await dav(href, { method: "GET", auth: basicAuth(username, password) });
  if (!res.ok) throw new Error(`get event failed: HTTP ${res.status}`);
  return { ics: await res.text(), etag: res.headers.get("ETag") };
}

/** PUT a VCALENDAR to a resource URL (create when ifMatch omitted, else update). */
export async function putEvent(
  href: string,
  ics: string,
  username: string,
  password: string,
  ifMatch?: string | null,
): Promise<string | null> {
  let current = href;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(current, {
      method: "PUT",
      redirect: "manual",
      headers: {
        Authorization: basicAuth(username, password),
        "User-Agent": UA,
        "Content-Type": "text/calendar; charset=utf-8",
        ...(ifMatch ? { "If-Match": ifMatch } : {}),
      },
      body: ics,
    });
    if ([301, 302, 307, 308].includes(res.status)) {
      const loc = res.headers.get("Location");
      if (!loc) throw new Error(`put redirected without Location (HTTP ${res.status})`);
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`put event failed: HTTP ${res.status} ${await res.text()}`);
    return res.headers.get("ETag");
  }
  throw new Error("too many CalDAV redirects on PUT");
}

/** DELETE an event resource. 404/410 are treated as already-gone by the caller. */
export async function deleteEvent(
  href: string,
  username: string,
  password: string,
  ifMatch?: string | null,
): Promise<number> {
  let current = href;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(current, {
      method: "DELETE",
      redirect: "manual",
      headers: {
        Authorization: basicAuth(username, password),
        "User-Agent": UA,
        ...(ifMatch ? { "If-Match": ifMatch } : {}),
      },
    });
    if ([301, 302, 307, 308].includes(res.status)) {
      const loc = res.headers.get("Location");
      if (!loc) return res.status;
      current = new URL(loc, current).toString();
      continue;
    }
    return res.status;
  }
  throw new Error("too many CalDAV redirects on DELETE");
}
