// Pull a Google account's address book into contacts_directory via People API.
//
// Two sources, because saved contacts alone are not an address book:
//   connections   — people the user deliberately saved to Google Contacts
//   otherContacts — people Google auto-recorded from email, never saved
// The second is where most correspondents actually live; without it, someone
// you have emailed for years but never met or saved is invisible to the guest
// picker. Each needs its own scope (contacts.readonly / contacts.other.readonly)
// — see SCOPES in google-oauth.
//
// Both endpoints page with nextPageToken and cap at 1000 per page.
import { admin, handleOptions, json, logSync } from "../_shared/admin.ts";
import { type GoogleAccount, gFetch, loadGoogleAccounts } from "../_shared/google.ts";
import { type DirectoryContact, writeContacts } from "../_shared/contacts.ts";

const PEOPLE_API = "https://people.googleapis.com/v1";
const PAGE_SIZE = 1000;
/** A hard ceiling so a pathological account can't loop forever. 200k addresses
 *  is far beyond any real "other contacts" list. */
const MAX_PAGES = 200;

// deno-lint-ignore no-explicit-any
function mapPerson(person: any): DirectoryContact[] {
  const addresses: string[] = (person?.emailAddresses ?? [])
    // deno-lint-ignore no-explicit-any
    .map((e: any) => (typeof e?.value === "string" ? e.value.trim().toLowerCase() : ""))
    .filter(Boolean);
  if (!addresses.length) return [];

  const name: string | null =
    person?.names?.[0]?.displayName?.trim() ||
    person?.organizations?.[0]?.name?.trim() ||
    null;

  // One row per address, same as CardDAV: the picker searches addresses, so an
  // address we drop is a person the user cannot invite.
  return addresses.map((email) => ({ email, displayName: name }));
}

/** Page one People API collection to exhaustion. */
async function readCollection(
  account: GoogleAccount,
  path: string,
  personFields: string,
): Promise<DirectoryContact[]> {
  const out: DirectoryContact[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${PEOPLE_API}${path}`);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    url.searchParams.set("personFields", personFields);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await gFetch(account, url.toString());
    if (!res.ok) {
      const body = await res.text();
      // 403 here means the consent screen granted calendar but not contacts —
      // an account connected before the contacts scopes were added. Say so
      // precisely: the fix is re-connecting, not debugging the sync.
      if (res.status === 403) {
        throw new Error(
          `contacts permission not granted for ${account.email} — reconnect the account to grant it`,
        );
      }
      throw new Error(`people ${path} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    const body = await res.json();
    // deno-lint-ignore no-explicit-any
    for (const person of (body.connections ?? body.otherContacts ?? []) as any[]) {
      out.push(...mapPerson(person));
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

async function syncAccount(account: GoogleAccount): Promise<number> {
  // otherContacts supports a much narrower personFields set than connections —
  // asking it for organizations is a 400, not a silently ignored field.
  const [saved, other] = await Promise.all([
    readCollection(account, "/people/me/connections", "names,emailAddresses,organizations"),
    readCollection(account, "/otherContacts", "names,emailAddresses"),
  ]);

  // Saved first: writeContacts dedupes by address keeping the copy that carries
  // a name, and a saved contact has the better name of the two.
  const result = await writeContacts(account.user_id, account.id, "google", [...saved, ...other]);
  if (result.sweepSkipped) {
    await logSync(
      "google",
      "contacts",
      "error",
      "refused to sweep: People API returned nothing over a populated store",
      account.user_id,
    );
  }
  return result.upserted;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const { accountId } = await req.json().catch(() => ({}));
    const accounts = await loadGoogleAccounts(accountId);

    let total = 0;
    const failures: string[] = [];
    for (const account of accounts) {
      if (account.needs_reconnect) continue;
      try {
        total += await syncAccount(account);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`${account.email}: ${msg}`);
        // Contacts are a secondary feed. Never mark needs_reconnect from here —
        // that banner means "your calendar is broken", and a missing contacts
        // scope does not break the calendar.
        await logSync("google", "contacts", "error", msg, account.user_id);
      }
    }

    if (!failures.length) await logSync("google", "contacts", "ok");
    return json({ ok: true, contacts: total, failures });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("google", "contacts", "error", msg);
    return json({ error: msg }, 500);
  }
});
