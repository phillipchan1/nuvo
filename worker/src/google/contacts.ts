import type { Env } from "../env.ts";
import type { Sql } from "../db.ts";
import { logServerError, redactSecrets } from "../lib/redact.ts";
import { PEOPLE_API, type GoogleAccount } from "./types.ts";
import { listGoogleAccountIds, loadGoogleAccountById, logSync } from "./owned.ts";
import { gFetch } from "./tokens.ts";
import { writeContacts, type DirectoryContact } from "./contactsWrite.ts";

const PAGE_SIZE = 1000;
const MAX_PAGES = 200;

function mapPerson(person: Record<string, unknown>): DirectoryContact[] {
  const addresses = ((person.emailAddresses ?? []) as { value?: string }[])
    .map((e) => (typeof e?.value === "string" ? e.value.trim().toLowerCase() : ""))
    .filter(Boolean);
  if (!addresses.length) return [];
  const names = person.names as { displayName?: string }[] | undefined;
  const orgs = person.organizations as { name?: string }[] | undefined;
  const name = names?.[0]?.displayName?.trim() || orgs?.[0]?.name?.trim() || null;
  return addresses.map((email) => ({ email, displayName: name }));
}

async function readCollection(
  sql: Sql,
  env: Env,
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
    const res = await gFetch(sql, env, account, url.toString());
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(
          `contacts permission not granted for ${account.email} — reconnect the account to grant it`,
        );
      }
      throw new Error(`people ${path} failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      connections?: Record<string, unknown>[];
      otherContacts?: Record<string, unknown>[];
      nextPageToken?: string;
    };
    for (const person of body.connections ?? body.otherContacts ?? []) {
      out.push(...mapPerson(person));
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

async function syncAccount(sql: Sql, env: Env, account: GoogleAccount): Promise<number> {
  const [saved, other] = await Promise.all([
    readCollection(sql, env, account, "/people/me/connections", "names,emailAddresses,organizations"),
    readCollection(sql, env, account, "/otherContacts", "names,emailAddresses"),
  ]);
  const result = await writeContacts(sql, account.user_id, account.id, "google", [...saved, ...other]);
  if (result.sweepSkipped) {
    await logSync(
      sql,
      "google",
      "contacts",
      "error",
      "refused to sweep: People API returned nothing over a populated store",
      account.user_id,
    );
  }
  return result.upserted;
}

export async function runGoogleContacts(
  sql: Sql,
  env: Env,
  opts: { accountId?: string; userId?: string },
): Promise<{ ok: true; contacts: number; failures: string[] }> {
  const ids = await listGoogleAccountIds(sql, opts.accountId);
  let total = 0;
  const failures: string[] = [];
  for (const id of ids) {
    const account = await loadGoogleAccountById(sql, id);
    if (!account) continue;
    if (opts.userId && account.user_id !== opts.userId) continue;
    if (account.needs_reconnect) continue;
    try {
      total += await syncAccount(sql, env, account);
    } catch (e) {
      logServerError("google-contacts", e);
      const msg = e instanceof Error ? e.message : String(e);
      failures.push("sync_failed");
      await logSync(sql, "google", "contacts", "error", redactSecrets(msg), account.user_id);
    }
  }
  if (!failures.length) await logSync(sql, "google", "contacts", "ok");
  return { ok: true, contacts: total, failures };
}
