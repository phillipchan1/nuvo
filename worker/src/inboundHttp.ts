import type { Context } from "hono";
import {
  notesFromMail,
  pickInboundToken,
  receivedBody,
  receivedMeta,
  titleFromSubject,
  verifySvixSignature,
} from "../../supabase/functions/_shared/inboundEmail.ts";
import { OPEN_CORS, json } from "./cors.ts";
import { requestIo, type AppEnv } from "./session.ts";
import { bootstrapUser, insertOwned, makeStore } from "./store.ts";

const RATE_LIMIT_PER_MIN = 30;

async function fetchReceivedMail(
  apiKey: string,
  emailId: string,
): Promise<{ ok: true; text: string | null; html: string | null; from: string } | { ok: false; status: number }> {
  let last = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    last = res.status;
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status };
    if (res.status === 404) continue;
    if (!res.ok) {
      if (res.status >= 500) continue;
      return { ok: false, status: res.status };
    }
    try {
      return { ok: true, ...receivedBody(JSON.parse(await res.text())) };
    } catch {
      return { ok: false, status: res.status };
    }
  }
  return { ok: false, status: last };
}

export async function handleInboundEmail(c: Context<AppEnv>): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
  if (c.req.method !== "POST") return json({ error: "Method not allowed" }, 405, OPEN_CORS);

  const secret = c.env.RESEND_WEBHOOK_SECRET ?? "";
  const apiKey = c.env.RESEND_API_KEY ?? "";
  if (!secret) {
    return json({ error: "RESEND_WEBHOOK_SECRET not configured" }, 500, OPEN_CORS);
  }

  const raw = await c.req.text();
  const ok = await verifySvixSignature({
    secret,
    id: c.req.header("svix-id") ?? "",
    timestamp: c.req.header("svix-timestamp") ?? "",
    body: raw,
    signatureHeader: c.req.header("svix-signature") ?? "",
  });
  if (!ok) return json({ error: "bad signature" }, 401, OPEN_CORS);

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ ignored: "invalid json" }, 200, OPEN_CORS);
  }
  const meta = receivedMeta(event);
  if (!meta) return json({ ignored: "not email.received" }, 200, OPEN_CORS);

  const token = pickInboundToken(meta.candidates);
  if (!token) return json({ ignored: "no inbox address" }, 200, OPEN_CORS);

  const io = await requestIo(c);
  const owners = (await io.sql`
    SELECT user_id FROM user_settings WHERE inbound_token = ${token} LIMIT 1
  `) as { user_id: string }[];
  if (!owners[0]?.user_id) return json({ ignored: "no matching inbox address" }, 200, OPEN_CORS);
  const userId = owners[0].user_id;
  const store = await bootstrapUser(makeStore(io.sql, userId), null);

  const seen = (await store.sql`
    SELECT email_id, task_id FROM inbound_emails
    WHERE email_id = ${meta.emailId}
    LIMIT 1
  `) as { email_id: string; task_id: string | null }[];
  if (seen[0]?.task_id) return json({ ignored: "duplicate", task_id: seen[0].task_id }, 200, OPEN_CORS);

  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  const recent = (await store.sql`
    SELECT count(*)::int AS n
    FROM inbound_emails
    WHERE user_id = ${store.userId}
      AND received_at >= ${oneMinAgo}
  `) as { n: number }[];
  if (Number(recent[0]?.n ?? 0) >= RATE_LIMIT_PER_MIN) {
    return json({ error: "rate limited" }, 429, OPEN_CORS);
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
      if (again[0]?.task_id) return json({ ignored: "duplicate", task_id: again[0].task_id }, 200, OPEN_CORS);
    }
  }

  let text: string | null = null;
  let html: string | null = null;
  const rec = event && typeof event === "object" ? (event as { data?: Record<string, unknown> }).data : undefined;
  if (rec && (typeof rec.text === "string" || typeof rec.html === "string")) {
    text = typeof rec.text === "string" ? rec.text : null;
    html = typeof rec.html === "string" ? rec.html : null;
  } else {
    if (!apiKey) return json({ error: "RESEND_API_KEY not configured" }, 500, OPEN_CORS);
    const fetched = await fetchReceivedMail(apiKey, meta.emailId);
    if (!fetched.ok) return json({ error: "could not fetch mail body" }, 500, OPEN_CORS);
    text = fetched.text;
    html = fetched.html;
    if (!meta.from && fetched.from) meta.from = fetched.from;
  }

  const title = titleFromSubject(meta.subject, meta.from);
  const notes = notesFromMail({
    from: meta.from,
    text,
    html,
    attachments: meta.attachments,
  });

  const task = await insertOwned(store, "tasks", { title, notes, status: "inbox" });
  if (!task) return json({ error: "cannot insert" }, 400, OPEN_CORS);
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
  return json({ id: task.id }, 200, OPEN_CORS);
}
