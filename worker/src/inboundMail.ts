import PostalMime from "postal-mime";
import {
  INBOUND_TOKEN_RE,
  localPart,
  type ReceivedMeta,
} from "../../supabase/functions/_shared/inboundEmail.ts";
import type { Env } from "./env.ts";
import { ingestInbound } from "./inboundIngest.ts";
import { openRequestIo } from "./requestIo.ts";

/** The subset of Cloudflare's `ForwardableEmailMessage` this handler uses. */
export interface InboundMailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer | string;
  readonly headers: Headers;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<unknown>;
}

type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

/**
 * Plain addresses on the receiving domains. Email Routing rules forward these
 * before they reach the Worker; if one does arrive here it never becomes a
 * task — it is forwarded to INBOUND_FORWARD_TO (a verified Email Routing
 * destination) when set, otherwise logged and dropped.
 */
export const PLAIN_INBOUND = new Set(["unsubscribe", "hello"]);

async function rawBytes(raw: InboundMailMessage["raw"]): Promise<ArrayBuffer> {
  if (typeof raw === "string") return new TextEncoder().encode(raw).buffer as ArrayBuffer;
  if (raw instanceof ArrayBuffer) return raw;
  if (raw instanceof Uint8Array) return raw.slice().buffer as ArrayBuffer;
  return await new Response(raw).arrayBuffer();
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

function addrList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const a of v as { address?: string; group?: { address?: string }[] }[]) {
    if (a?.address) out.push(a.address);
    for (const g of a?.group ?? []) if (g?.address) out.push(g.address);
  }
  return out;
}

/**
 * Cloudflare Email Routing → inbox task. Dedupe key is `cf:<token>:<Message-ID>`
 * (sha256 of the raw message when there is no Message-ID); the token keeps one
 * BCC'd message from colliding across two Nuvo inboxes.
 */
export async function handleInboundMail(message: InboundMailMessage, env: Env, ctx: WaitUntil): Promise<void> {
  const rcpt = (message.to ?? "").trim().toLowerCase();
  const local = localPart(rcpt);

  if (!local || !INBOUND_TOKEN_RE.test(local)) {
    if (local && PLAIN_INBOUND.has(local)) {
      const dest = env.INBOUND_FORWARD_TO?.trim();
      if (dest) {
        try {
          await message.forward(dest);
          console.log(`[inbound-mail] forwarded ${local}@ to INBOUND_FORWARD_TO`);
        } catch (e) {
          console.log(`[inbound-mail] forward of ${local}@ failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        console.log(`[inbound-mail] ${local}@ received; INBOUND_FORWARD_TO unset, not forwarded`);
      }
    } else {
      console.log("[inbound-mail] dropped: recipient is not an inbox address");
    }
    return;
  }

  const raw = await rawBytes(message.raw);
  const parsed = await PostalMime.parse(raw);
  const messageId = (parsed.messageId ?? message.headers.get("message-id") ?? "").trim().replace(/^<|>$/g, "");
  const meta: ReceivedMeta = {
    emailId: `cf:${local}:${messageId || `sha256:${await sha256Hex(raw)}`}`,
    from: parsed.from?.address ?? message.from ?? "",
    subject: parsed.subject ?? "",
    candidates: [rcpt, ...addrList(parsed.to), ...addrList(parsed.cc)],
    attachments: (parsed.attachments ?? []).flatMap((a) => {
      const name = a.filename?.trim();
      return name ? [{ filename: name }] : [];
    }),
  };

  const io = openRequestIo(env);
  try {
    const result = await ingestInbound(io.sql, meta, async () => ({
      ok: true,
      text: parsed.text ?? null,
      html: parsed.html ?? null,
    }));
    const tag = typeof result.body.ignored === "string" ? `ignored: ${result.body.ignored}` : (result.body.error ?? "ok");
    console.log(`[inbound-mail] ${result.status} ${tag}`);
    if (result.status === 429) message.setReject("Too many messages to this Nuvo inbox right now. Try again later.");
    else if (result.status >= 400) message.setReject("Nuvo could not accept this message.");
  } finally {
    ctx.waitUntil(io.close());
  }
}
