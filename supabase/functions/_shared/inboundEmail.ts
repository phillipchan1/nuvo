/**
 * Email → inbox task. Pure: the SPA (the address you copy) and the
 * `inbound-email` webhook (the mail Resend delivers) must agree on the
 * address shape, the subject→title rule, and how a body becomes notes.
 *
 * Zero Deno, zero fetches. A `Deno.` here would break the browser build.
 */

export const DEFAULT_INBOUND_MAIL_DOMAIN = "inbox.nuvo.day";

/** 12 hex chars — `user_settings.inbound_token`. Anything else on the
 *  receiving domain (hello@, abuse@) is not an inbox address. */
export const INBOUND_TOKEN_RE = /^[0-9a-f]{12}$/;

export const TITLE_MAX = 300;
export const NOTES_MAX = 8_000;
export const SVIX_TOLERANCE_SEC = 300;

export function inboundMailDomain(override?: string | null): string {
  const raw = (override ?? DEFAULT_INBOUND_MAIL_DOMAIN).trim().toLowerCase();
  return raw.replace(/^@/, "");
}

export function inboundAddress(token: string, domain?: string | null): string {
  return `${token.trim().toLowerCase()}@${inboundMailDomain(domain)}`;
}

/** Pull bare addresses out of a Resend recipient field. */
export function addressesFrom(v: unknown): string[] {
  const out: string[] = [];
  const push = (s: unknown) => {
    if (typeof s !== "string" || !s.trim()) return;
    const m = s.match(/<([^>]+)>/);
    out.push((m ? m[1] : s).trim());
  };
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === "string") push(item);
      else if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        push(rec.address ?? rec.email);
      }
    }
  } else {
    push(v);
  }
  return out;
}

export function localPart(addr: string): string | null {
  const at = addr.indexOf("@");
  if (at <= 0) return null;
  return addr.slice(0, at).trim().toLowerCase();
}

/** First candidate whose local part is a real inbound token. */
export function pickInboundToken(addresses: string[]): string | null {
  for (const addr of addresses) {
    const token = localPart(addr);
    if (token && INBOUND_TOKEN_RE.test(token)) return token;
  }
  return null;
}

/** Subject is the title. Strip nested Re:/Fwd: so a forward isn't named
 *  "Fwd: Re: …"; an empty subject becomes "Email from {who}". */
export function titleFromSubject(subject: string, from?: string): string {
  let t = subject.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 8; i++) {
    const next = t.replace(/^(?:re|fwd?|aw|wg|sv)\s*(?:\[\d+\])?\s*:\s*/i, "").trim();
    if (next === t) break;
    t = next;
  }
  if (!t) {
    const who = displayFrom(from ?? "");
    return who ? `Email from ${who}` : "Forwarded email";
  }
  return t.slice(0, TITLE_MAX);
}

export function displayFrom(from: string): string {
  const t = from.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const named = t.match(/^(.+?)\s*<([^>]+)>$/);
  if (named) {
    const name = named[1].replace(/^["']|["']$/g, "").trim();
    return name || named[2].trim();
  }
  return t;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function notesFromMail(input: {
  from?: string;
  text?: string | null;
  html?: string | null;
  attachments?: { filename?: string | null }[];
}): string {
  const body =
    (input.text && input.text.trim()) ||
    (input.html ? htmlToText(input.html) : "");
  const from = (input.from ?? "").trim();
  const attached = (input.attachments ?? [])
    .map((a) => a.filename?.trim())
    .filter((n): n is string => Boolean(n));
  const parts = [
    from ? `From: ${from}` : "",
    body,
    attached.length ? `Attached: ${attached.join(", ")}` : "",
  ].filter(Boolean);
  const notes = parts.join("\n\n").trim();
  if (notes.length <= NOTES_MAX) return notes;
  return `${notes.slice(0, NOTES_MAX).trimEnd()}\n\n…`;
}

export interface ReceivedMeta {
  emailId: string;
  from: string;
  subject: string;
  candidates: string[];
  attachments: { filename: string }[];
}

/** Metadata Resend puts on `email.received`. Body is fetched separately. */
export function receivedMeta(event: unknown): ReceivedMeta | null {
  if (!event || typeof event !== "object") return null;
  const rec = event as Record<string, unknown>;
  if (rec.type !== "email.received") return null;
  const data = (rec.data && typeof rec.data === "object" ? rec.data : {}) as Record<string, unknown>;
  const emailId = typeof data.email_id === "string" ? data.email_id : "";
  if (!emailId) return null;
  const from =
    addressesFrom(data.from)[0] ??
    (typeof data.from === "string" ? data.from : "") ??
    "";
  const subject = typeof data.subject === "string" ? data.subject : "";
  const candidates = [
    ...addressesFrom(data.received_for),
    ...addressesFrom(data.to),
    ...addressesFrom(data.cc),
  ];
  const attachments = Array.isArray(data.attachments)
    ? data.attachments.flatMap((a) => {
        if (!a || typeof a !== "object") return [];
        const name = (a as { filename?: unknown }).filename;
        return typeof name === "string" && name.trim() ? [{ filename: name.trim() }] : [];
      })
    : [];
  return { emailId, from, subject, candidates, attachments };
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function bytesToB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function svixSign(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    b64ToBytes(rawSecret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return bytesToB64(new Uint8Array(sig));
}

/** Resend/Svix: HMAC-SHA256 over `${id}.${timestamp}.${body}`, 5-minute replay window. */
export async function verifySvixSignature(input: {
  secret: string;
  id: string;
  timestamp: string;
  body: string;
  signatureHeader: string;
  nowSec?: number;
}): Promise<boolean> {
  const ts = Number(input.timestamp);
  const now = input.nowSec ?? Date.now() / 1000;
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SVIX_TOLERANCE_SEC) return false;
  if (!input.id || !input.signatureHeader) return false;
  const expected = await svixSign(input.secret, input.id, input.timestamp, input.body);
  return input.signatureHeader.split(" ").some((part) => {
    const comma = part.indexOf(",");
    const value = comma === -1 ? part : part.slice(comma + 1);
    return value.length > 0 && timingSafeEqual(value, expected);
  });
}
