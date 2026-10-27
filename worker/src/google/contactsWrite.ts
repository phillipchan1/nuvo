import type { Sql } from "../db.ts";
import { isSuspectWipe } from "../../../supabase/functions/_shared/sweepSafety.ts";

export interface DirectoryContact {
  email: string;
  displayName: string | null;
}

const CHUNK = 500;

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function writeContacts(
  sql: Sql,
  userId: string,
  accountId: string,
  source: "google" | "apple",
  contacts: DirectoryContact[],
): Promise<{ upserted: number; removed: number; sweepSkipped: boolean }> {
  const byEmail = new Map<string, DirectoryContact>();
  for (const c of contacts) {
    const email = c.email.trim().toLowerCase();
    if (!isValidEmail(email)) continue;
    const existing = byEmail.get(email);
    if (existing && existing.displayName && !c.displayName) continue;
    byEmail.set(email, { email, displayName: c.displayName?.trim() || null });
  }
  const rows = [...byEmail.values()];
  const cutoff = new Date().toISOString();

  for (let i = 0; i < rows.length; i += CHUNK) {
    for (const c of rows.slice(i, i + CHUNK)) {
      await sql`
        INSERT INTO contacts_directory (user_id, account_id, source, email, name, display_name, updated_at)
        VALUES (${userId}, ${accountId}, ${source}, ${c.email}, ${c.displayName}, ${c.displayName}, ${cutoff})
        ON CONFLICT (account_id, email) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          name = EXCLUDED.name,
          updated_at = EXCLUDED.updated_at
        WHERE contacts_directory.user_id = ${userId}
      `;
    }
  }

  const counted = await sql`
    SELECT count(*)::int AS n FROM contacts_directory
    WHERE account_id = ${accountId}
      AND user_id = ${userId}
  `;
  const storedCount = Number((counted[0] as { n?: number } | undefined)?.n ?? 0);

  if (isSuspectWipe(rows.length, storedCount)) {
    return { upserted: rows.length, removed: 0, sweepSkipped: true };
  }

  const removedRows = rows.length
    ? await sql`
        DELETE FROM contacts_directory
        WHERE account_id = ${accountId}
          AND user_id = ${userId}
          AND updated_at < ${cutoff}
        RETURNING id
      `
    : await sql`
        DELETE FROM contacts_directory
        WHERE account_id = ${accountId}
          AND user_id = ${userId}
        RETURNING id
      `;
  return { upserted: rows.length, removed: removedRows.length, sweepSkipped: false };
}
