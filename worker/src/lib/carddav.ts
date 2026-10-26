// Minimal CardDAV client for iCloud contacts (contacts.icloud.com).
//
// The sibling of _shared/caldav.ts, and deliberately shaped the same way: same
// HTTP Basic auth with the Apple ID + app-specific password already stored in
// Vault by icloud-connect, same manual redirect following (Apple 301s to a
// per-shard pNN- host and fetch() can drop the method/body on a 301), same
// namespace-agnostic regex parsing because the edge runtime has no DOMParser.
//
// Discovery walks current-user-principal -> addressbook-home-set -> the
// addressbook collections under it, then a REPORT pulls the vCards.

const ICLOUD_BASE = "https://contacts.icloud.com";
const UA = "Nuvo/1.0";

export interface CardDavAddressBook {
  /** Absolute collection URL. */
  url: string;
  displayName: string;
}

export interface CardDavContact {
  email: string;
  displayName: string | null;
}

export function basicAuth(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

// ── Low-level DAV request with manual redirect following ──────────────────
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
  throw new Error("too many CardDAV redirects");
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

function responses(xml: string): string[] {
  return pickAll(xml, "response");
}

/** A revoked app-specific password is the one failure the *user* must fix, so
 *  it must never surface as "the response looked odd". Apple can 401 at any
 *  hop — the shard host re-authenticates independently. */
function assertOk(res: Response, what: string): void {
  if (res.status === 401 || res.status === 403) {
    throw new Error("iCloud rejected the Apple ID or app-specific password");
  }
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status}`);
}

// ── vCard parsing ─────────────────────────────────────────────────────────
/** Unfold RFC 6350 line continuations: a CRLF followed by a space or tab is a
 *  wrap, not a new line. Long names and addresses are routinely folded, and
 *  parsing without unfolding truncates them mid-value. */
function unfold(vcard: string): string[] {
  return vcard.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

/** Strip the parameter list from a property name: "EMAIL;TYPE=WORK" -> "EMAIL",
 *  and drop any vCard group prefix ("item1.EMAIL" -> "EMAIL"), which Apple
 *  emits constantly for typed properties. */
function propName(line: string): string {
  const head = line.split(":", 1)[0] ?? "";
  const bare = head.split(";", 1)[0] ?? "";
  const dot = bare.lastIndexOf(".");
  return (dot >= 0 ? bare.slice(dot + 1) : bare).toUpperCase();
}

function propValue(line: string): string {
  const idx = line.indexOf(":");
  return idx >= 0 ? line.slice(idx + 1).trim() : "";
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Parse a vCard payload into one contact per email address.
 *
 *  A person with three addresses becomes three rows sharing a display name —
 *  the picker searches addresses, so an address we drop is a person the user
 *  cannot invite. Exported for testing against real captured Apple payloads:
 *  the CalDAV outage was a parsing bug no network-level check would have
 *  caught, and this parser has the same exposure. */
export function parseVCards(payload: string): CardDavContact[] {
  const out: CardDavContact[] = [];
  // A REPORT can return several vCards in one address-data blob.
  const cards = payload.split(/BEGIN:VCARD/i).slice(1);
  for (const card of cards) {
    const lines = unfold(card);
    let fn: string | null = null;
    let structured: string | null = null;
    let org: string | null = null;
    const emails: string[] = [];

    for (const line of lines) {
      const name = propName(line);
      if (name === "FN") {
        fn = propValue(line).replace(/\\,/g, ",").replace(/\\;/g, ";").trim() || null;
      } else if (name === "N" && !structured) {
        // "Family;Given;Additional;Prefix;Suffix" -> "Given Family".
        const parts = propValue(line).split(";");
        const composed = [parts[1], parts[0]].filter((p) => p && p.trim()).join(" ").trim();
        structured = composed || null;
      } else if (name === "ORG" && !org) {
        org = propValue(line).split(";")[0]?.trim() || null;
      } else if (name === "EMAIL") {
        const value = propValue(line).toLowerCase();
        if (isValidEmail(value) && !emails.includes(value)) emails.push(value);
      }
    }

    // Company entries carry no personal name; ORG is the only human-readable
    // label they have, so falling back to it beats showing a bare address.
    const displayName = fn ?? structured ?? org;
    for (const email of emails) out.push({ email, displayName });
  }
  return out;
}

// ── Discovery ─────────────────────────────────────────────────────────────
export async function discoverAddressBooks(
  username: string,
  password: string,
): Promise<CardDavAddressBook[]> {
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
    pickFirst(pickFirst(principalXml, "current-user-principal") ?? "", "href") ??
    pickFirst(principalXml, "href");
  if (!principalHref) throw new Error("could not resolve iCloud contacts principal");
  const principalUrl = new URL(principalHref.trim(), principalRes.url || `${ICLOUD_BASE}/`).toString();

  // 2. Address book home set.
  const homeRes = await dav(principalUrl, {
    method: "PROPFIND",
    auth,
    depth: "0",
    body: `<?xml version="1.0" encoding="utf-8"?><A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><A:prop><C:addressbook-home-set/></A:prop></A:propfind>`,
  });
  assertOk(homeRes, "addressbook-home lookup");
  const homeXml = await homeRes.text();
  const homeHref = pickFirst(pickFirst(homeXml, "addressbook-home-set") ?? "", "href");
  if (!homeHref) throw new Error("could not resolve iCloud addressbook home");
  const homeUrl = new URL(homeHref.trim(), homeRes.url || principalUrl).toString();

  // 3. Enumerate collections under the home set.
  const listRes = await dav(homeUrl, {
    method: "PROPFIND",
    auth,
    depth: "1",
    body: `<?xml version="1.0" encoding="utf-8"?><A:propfind xmlns:A="DAV:"><A:prop><A:displayname/><A:resourcetype/></A:prop></A:propfind>`,
  });
  assertOk(listRes, "addressbook list");
  const books = parseAddressBookList(await listRes.text(), homeUrl);

  // Unlike calendars, an account with no address book is a legitimate state
  // (contacts were never used). The caller treats [] as "nothing to sync" and
  // must NOT sweep — see syncAppleContacts.
  return books;
}

/** The pure half of discovery — split out so it can be tested against captured
 *  Apple responses rather than only over the network. */
export function parseAddressBookList(listXml: string, homeUrl: string): CardDavAddressBook[] {
  const books: CardDavAddressBook[] = [];
  for (const block of responses(listXml)) {
    const resourceType = pickFirst(block, "resourcetype") ?? "";
    if (!/<(?:[A-Za-z0-9]+:)?addressbook\b/i.test(resourceType)) continue;
    const href = pickFirst(block, "href");
    if (!href) continue;
    const url = new URL(href.trim(), homeUrl).toString();
    if (url.replace(/\/$/, "") === homeUrl.replace(/\/$/, "")) continue;
    const displayName = unescapeXml(pickFirst(block, "displayname") ?? "").trim() || "Contacts";
    books.push({ url, displayName });
  }
  return books;
}

// ── Read every card in an address book ────────────────────────────────────
export async function fetchContacts(
  bookUrl: string,
  username: string,
  password: string,
): Promise<CardDavContact[]> {
  const auth = basicAuth(username, password);
  const body =
    `<?xml version="1.0" encoding="utf-8"?><C:addressbook-query xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">` +
    `<A:prop><A:getetag/><C:address-data/></A:prop></C:addressbook-query>`;

  const res = await dav(bookUrl, { method: "REPORT", auth, depth: "1", body });
  if (!res.ok) throw new Error(`addressbook-query failed: HTTP ${res.status}`);
  const xml = await res.text();

  const out: CardDavContact[] = [];
  for (const block of responses(xml)) {
    const data = pickFirst(block, "address-data");
    if (!data) continue;
    const vcard = unescapeXml(data).trim();
    if (!vcard.toUpperCase().includes("BEGIN:VCARD")) continue;
    out.push(...parseVCards(vcard));
  }
  return out;
}
