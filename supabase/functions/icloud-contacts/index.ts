// Pull an iCloud account's address book over CardDAV into contacts_directory.
//
// No new credential: this reuses the Apple ID + app-specific password that
// icloud-connect already verified and stashed in Vault for calendar sync. The
// same password authenticates contacts.icloud.com, so connecting Apple Calendar
// already granted everything this needs.
//
// Invoked per account (accountId) by calendar-refresh and right after connect.
// Without accountId it walks every iCloud account, paged past the 1000-row cap.
import { admin, handleOptions, json, logSync, readSecret } from "../_shared/admin.ts";
import { discoverAddressBooks, fetchContacts } from "../_shared/carddav.ts";
import { type DirectoryContact, writeContacts } from "../_shared/contacts.ts";
import { loadAccountsPaged } from "../_shared/syncSchedule.ts";

interface IcloudAccount {
  id: string;
  user_id: string;
  email: string;
  refresh_token_secret_id: string | null;
}

async function syncAccount(account: IcloudAccount): Promise<number> {
  if (!account.refresh_token_secret_id) throw new Error("no app-specific password stored");
  const password = await readSecret(account.refresh_token_secret_id);
  if (!password) throw new Error("app-specific password missing from vault");

  const books = await discoverAddressBooks(account.email, password);
  // An account with no address book is legitimate (contacts never used), unlike
  // an account with no calendar. Return before writing so writeContacts is never
  // handed an empty set that it would have to reason about sweeping.
  if (!books.length) return 0;

  // Collect every book before writing: the sweep is account-wide, so a book
  // that failed mid-pass must not make the rest look deleted.
  const all: DirectoryContact[] = [];
  for (const book of books) {
    const cards = await fetchContacts(book.url, account.email, password);
    all.push(...cards.map((c) => ({ email: c.email, displayName: c.displayName })));
  }

  const result = await writeContacts(account.user_id, account.id, "apple", all);
  if (result.sweepSkipped) {
    await logSync(
      "icloud",
      "contacts",
      "error",
      "refused to sweep: address book came back empty over a populated store",
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
    const accounts = (await loadAccountsPaged("icloud", accountId)) as IcloudAccount[];

    let total = 0;
    const failures: string[] = [];
    for (const account of accounts) {
      try {
        total += await syncAccount(account);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`${account.email}: ${msg}`);
        // Contacts are a secondary feed — a failure here must never mark the
        // account needs_reconnect and scare the user off a working calendar.
        await logSync("icloud", "contacts", "error", msg, account.user_id);
      }
    }

    if (!failures.length) await logSync("icloud", "contacts", "ok");
    return json({ ok: true, contacts: total, failures });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("icloud", "contacts", "error", msg);
    return json({ error: msg }, 500);
  }
});
