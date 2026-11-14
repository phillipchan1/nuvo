import type { Context } from "hono";
import {
  receivedBody,
  receivedMeta,
  verifySvixSignature,
} from "../../supabase/functions/_shared/inboundEmail.ts";
import { OPEN_CORS, json } from "./cors.ts";
import { ingestInbound } from "./inboundIngest.ts";
import { requestIo, type AppEnv } from "./session.ts";

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

  const rec = event && typeof event === "object" ? (event as { data?: Record<string, unknown> }).data : undefined;
  const io = await requestIo(c);
  const result = await ingestInbound(io.sql, meta, async () => {
    if (rec && (typeof rec.text === "string" || typeof rec.html === "string")) {
      return {
        ok: true,
        text: typeof rec.text === "string" ? rec.text : null,
        html: typeof rec.html === "string" ? rec.html : null,
      };
    }
    if (!apiKey) return { ok: false, status: 500, error: "RESEND_API_KEY not configured" };
    const fetched = await fetchReceivedMail(apiKey, meta.emailId);
    if (!fetched.ok) return { ok: false, status: 500, error: "could not fetch mail body" };
    return { ok: true, text: fetched.text, html: fetched.html, from: fetched.from };
  });
  return json(result.body, result.status, OPEN_CORS);
}
