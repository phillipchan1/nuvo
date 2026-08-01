// Writing side of contact sync — shared by google-contacts and icloud-contacts.
//
// Both providers are full-snapshot reads with no delta, so each run upserts
// everything it saw and sweeps whatever it didn't. That is the same shape as
// calendar sync, and it carries the same hazard: a provider returning nothing
// is indistinguishable from an address book that was emptied. We reuse
// `isSuspectWipe` rather than re-deriving the rule.
import { admin } from "./admin.ts";
import { isSuspectWipe } from "./sweepSafety.ts";
import {
  type ContactCandidate,
  type ContactSource,
  type InviteAmbiguity,
  type InviteRecipient,
  dedupeRecipients,
  pickRecipient,
} from "./invites.ts";

export interface DirectoryContact {
  email: string;
  displayName: string | null;
}

export interface ContactSyncResult {
  upserted: number;
  removed: number;
  sweepSkipped: boolean;
}

/** Chunked so a large address book can't blow the statement or payload size.
 *  10k contacts is an ordinary Gmail "other contacts" list. */
const CHUNK = 500;

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Replace one account's contacts with `contacts`, then sweep what's gone.
 *
 *  Deduplicates by address first: the unique index is (account_id, email), and
 *  a single upsert payload containing the same address twice errors out in
 *  Postgres ("ON CONFLICT DO UPDATE command cannot affect row a second time"),
 *  which both providers can produce — a person with the same address on two
 *  cards, or a Google contact appearing in both connections and otherContacts. */
export async function writeContacts(
  userId: string,
  accountId: string,
  source: "google" | "apple",
  contacts: DirectoryContact[],
): Promise<ContactSyncResult> {
  const byEmail = new Map<string, DirectoryContact>();
  for (const c of contacts) {
    const email = c.email.trim().toLowerCase();
    if (!isValidEmail(email)) continue;
    const existing = byEmail.get(email);
    // Prefer whichever copy actually carries a human name.
    if (existing && existing.displayName && !c.displayName) continue;
    byEmail.set(email, { email, displayName: c.displayName?.trim() || null });
  }
  const rows = [...byEmail.values()].map((c) => ({
    user_id: userId,
    account_id: accountId,
    source,
    email: c.email,
    display_name: c.displayName,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin
      .from("contacts_directory")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "account_id,email" });
    if (error) throw error;
  }

  // Sweep: anything for this account we didn't just write is gone upstream.
  const { count: storedCount } = await admin
    .from("contacts_directory")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);

  if (isSuspectWipe(rows.length, storedCount ?? 0)) {
    // A provider that hands back an empty address book over a populated one is
    // far more likely to be broken than to be telling the truth. Keep what we
    // have; the next run can still correct real deletions.
    return { upserted: rows.length, removed: 0, sweepSkipped: true };
  }

  let removed = 0;
  if (rows.length) {
    // Sweep by timestamp rather than by address: a `not.in` list of 10k
    // addresses would overflow the request URL. Every row this run touched is
    // now stamped at or after `cutoff` — inserts carry it literally, and
    // conflicting rows get now() from the set_updated_at trigger — so anything
    // still older than the cutoff is a contact the provider stopped sending.
    const cutoff = rows[0].updated_at;
    const { data, error } = await admin
      .from("contacts_directory")
      .delete()
      .eq("account_id", accountId)
      .lt("updated_at", cutoff)
      .select("id");
    if (error) throw error;
    removed = data?.length ?? 0;
  } else {
    const { data, error } = await admin
      .from("contacts_directory")
      .delete()
      .eq("account_id", accountId)
      .select("id");
    if (error) throw error;
    removed = data?.length ?? 0;
  }

  return { upserted: rows.length, removed, sweepSkipped: false };
}

// ---------------------------------------------------------------------------
// Reading side — the same ranked list the guest picker shows, for a runtime
// with no session.
//
// `contacts(search)` is security definer over auth.uid(); the agent runs on the
// service role, where that is null. `contacts_for(uid, search)` (migration 50)
// is the same body with the id passed in, so the browser and the agent agree
// about who "Matt" is without a second ranking implementation in Deno.
// ---------------------------------------------------------------------------

const SOURCES: ContactSource[] = ["google", "apple", "meeting"];

function toCandidate(row: Record<string, unknown>): ContactCandidate {
  const sources = Array.isArray(row.sources)
    ? (row.sources as string[]).filter((s): s is ContactSource => (SOURCES as string[]).includes(s))
    : [];
  const email = String(row.email ?? "").toLowerCase();
  const displayName = row.display_name ? String(row.display_name) : null;
  return {
    email,
    displayName: displayName && displayName.toLowerCase() !== email ? displayName : null,
    freq: Number(row.freq ?? 0),
    sources,
  };
}

/** Ranked candidates for one search string. Empty search returns the people
 *  they meet most, which is what "who can I invite?" should show. */
export async function searchContacts(userId: string, query: string): Promise<ContactCandidate[]> {
  const { data, error } = await admin.rpc("contacts_for", { uid: userId, search: query ?? "" });
  if (error) throw error;
  return (data as Record<string, unknown>[] | null ?? []).map(toCandidate);
}

export interface ResolvedRecipients {
  recipients: InviteRecipient[];
  /** Names that matched two people or none. The caller must ask — never pick. */
  unresolved: InviteAmbiguity[];
}

/** Resolve everything the user named at once, keeping the two outcomes apart:
 *  people we're certain of, and questions. A single ambiguous name doesn't
 *  invalidate the rest of the invite — it just can't be sent until it's answered. */
export async function resolveRecipients(userId: string, tokens: string[]): Promise<ResolvedRecipients> {
  const recipients: InviteRecipient[] = [];
  const unresolved: InviteAmbiguity[] = [];

  for (const raw of tokens) {
    const token = (raw ?? "").trim();
    if (!token) continue;
    const candidates = await searchContacts(userId, token);
    const pick = pickRecipient(token, candidates);
    if (pick.status === "resolved") recipients.push(pick.recipient);
    else unresolved.push({ query: token, candidates: pick.status === "ambiguous" ? pick.candidates : [] });
  }

  return { recipients: dedupeRecipients(recipients), unresolved };
}
