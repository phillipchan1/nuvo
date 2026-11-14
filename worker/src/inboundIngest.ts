import {
  notesFromMail,
  pickInboundToken,
  titleFromSubject,
  type ReceivedMeta,
} from "../../supabase/functions/_shared/inboundEmail.ts";
import type { Sql } from "./db.ts";
import { bootstrapUser, insertOwned, makeStore } from "./store.ts";

export const RATE_LIMIT_PER_MIN = 30;

export type InboundBody =
  | { ok: true; text: string | null; html: string | null; from?: string }
  | { ok: false; status: number; error: string };

export type IngestResult = { status: number; body: Record<string, unknown> };

/**
 * Email → inbox task, shared by the Resend webhook (`inboundHttp.ts`) and the
 * Cloudflare Email Routing `email()` handler (`inboundMail.ts`). The caller
 * owns transport (signature, MIME); this owns token → owner, dedupe on
 * `email_id`, the per-minute rate limit, and the task insert. `loadBody` runs
 * only after the dedupe row exists (Resend fetches the body over HTTP).
 */
export async function ingestInbound(
  sql: Sql,
  meta: ReceivedMeta,
  loadBody: () => Promise<InboundBody>,
): Promise<IngestResult> {
  const token = pickInboundToken(meta.candidates);
  if (!token) return { status: 200, body: { ignored: "no inbox address" } };

  const owners = (await sql`
    SELECT user_id FROM user_settings WHERE inbound_token = ${token} LIMIT 1
  `) as { user_id: string }[];
  if (!owners[0]?.user_id) return { status: 200, body: { ignored: "no matching inbox address" } };
  const userId = owners[0].user_id;
  const store = await bootstrapUser(makeStore(sql, userId), null);

  const seen = (await store.sql`
    SELECT email_id, task_id FROM inbound_emails
    WHERE email_id = ${meta.emailId}
    LIMIT 1
  `) as { email_id: string; task_id: string | null }[];
  if (seen[0]?.task_id) return { status: 200, body: { ignored: "duplicate", task_id: seen[0].task_id } };

  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  const recent = (await store.sql`
    SELECT count(*)::int AS n
    FROM inbound_emails
    WHERE user_id = ${store.userId}
      AND received_at >= ${oneMinAgo}
  `) as { n: number }[];
  if (Number(recent[0]?.n ?? 0) >= RATE_LIMIT_PER_MIN) {
    return { status: 429, body: { error: "rate limited" } };
  }

  if (!seen[0]) {
    try {
      await store.sql`
        INSERT INTO inbound_emails (email_id, user_id, from_address, subject)
        VALUES (${meta.emailId}, ${store.userId}, ${meta.from || null}, ${meta.subject || null})
      `;
    } catch {
      const again = (await store.sql`
        SELECT task_id FROM inbound_emails WHERE email_id = ${meta.emailId} LIMIT 1
      `) as { task_id: string | null }[];
      if (again[0]?.task_id) return { status: 200, body: { ignored: "duplicate", task_id: again[0].task_id } };
    }
  }

  const got = await loadBody();
  if (!got.ok) return { status: got.status, body: { error: got.error } };
  if (!meta.from && got.from) meta.from = got.from;

  const title = titleFromSubject(meta.subject, meta.from);
  const notes = notesFromMail({
    from: meta.from,
    text: got.text,
    html: got.html,
    attachments: meta.attachments,
  });

  const task = await insertOwned(store, "tasks", { title, notes, status: "inbox" });
  if (!task) return { status: 400, body: { error: "cannot insert" } };
  await store.sql`
    UPDATE tasks SET source = 'email'
    WHERE id = ${String(task.id)} AND user_id = ${store.userId}
  `;
  await store.sql`
    UPDATE inbound_emails
    SET task_id = ${String(task.id)},
        from_address = ${meta.from || null},
        subject = ${meta.subject || null}
    WHERE email_id = ${meta.emailId}
      AND user_id = ${store.userId}
  `;
  return { status: 200, body: { id: task.id } };
}
