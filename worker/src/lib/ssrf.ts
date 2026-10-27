/** Outbound ICS feed guard. Only public https hosts, bounded fetch. */

import { outboundFetch } from "./outboundFetch.ts";

export const ICS_MAX_REDIRECTS = 3;
export const ICS_MAX_BYTES = 5 * 1024 * 1024;
export const ICS_FETCH_MS = 10_000;
export const ICS_DEADLINE_MS = 20_000;

export function rewriteFeedUrl(raw: string): string {
  return raw.trim().replace(/^webcal:\/\//i, "https://");
}

function stripTrailingDots(host: string): string {
  return host.replace(/\.+$/, "");
}

function ipv4Octets(raw: string): number[] | null {
  const m = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const oct = m.slice(1).map(Number);
  if (oct.some((n) => n > 255)) return null;
  return oct;
}

function ipv4FromInt(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function isBlockedIpv4(oct: number[]): boolean {
  const [a, b, c, d] = oct;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  if (a >= 224 && a <= 239) return true;
  return false;
}

function parseIpv6(raw: string): bigint | null {
  let s = raw.trim().toLowerCase();
  if (!s.includes(":")) return null;
  if (s.includes(".")) {
    const idx = s.lastIndexOf(":");
    const v4 = ipv4Octets(s.slice(idx + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, idx)}:${hi}:${lo}`;
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts.length === 2 ? (parts[1] ? parts[1].split(":") : []) : [];
  if (parts.length === 1 && left.length !== 8) return null;
  if (parts.length === 2 && left.length + right.length > 8) return null;
  const mid = parts.length === 2 ? Array(8 - left.length - right.length).fill("0") : [];
  const words = [...left, ...mid, ...right];
  if (words.length !== 8) return null;
  let n = 0n;
  for (const w of words) {
    if (!/^[0-9a-f]{1,4}$/.test(w)) return null;
    n = (n << 16n) | BigInt(parseInt(w, 16));
  }
  return n;
}

function isBlockedIpv6(addr: bigint): boolean {
  if (addr === 0n || addr === 1n) return true;
  if (addr >> 121n === 0x7en) return true; // fc00::/7
  if (addr >> 118n === 0x3fan) return true; // fe80::/10
  if (addr >> 120n === 0xffn) return true; // multicast ff00::/8
  if (addr >> 32n === 0xffffn) {
    return isBlockedIpv4(ipv4FromInt(Number(addr & 0xffff_ffffn)));
  }
  // IPv4-compatible ::/96 (deprecated), e.g. [::7f00:1]
  if (addr >> 32n === 0n && addr > 1n) {
    return isBlockedIpv4(ipv4FromInt(Number(addr & 0xffff_ffffn)));
  }
  // NAT64 well-known prefix 64:ff9b::/96
  if (addr >> 32n === 0x0064_ff9b_0000_0000_0000_0000n) {
    return isBlockedIpv4(ipv4FromInt(Number(addr & 0xffff_ffffn)));
  }
  // 6to4 2002::/16 — IPv4 sits in bits 16..47
  if (addr >> 112n === 0x2002n) {
    return isBlockedIpv4(ipv4FromInt(Number((addr >> 80n) & 0xffff_ffffn)));
  }
  return false;
}

export function isBlockedHost(host: string): boolean {
  const raw = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const h = stripTrailingDots(raw);
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "metadata.google.internal") return true;
  const v4 = ipv4Octets(h);
  if (v4) return isBlockedIpv4(v4);
  const v6 = parseIpv6(h);
  if (v6 !== null) return isBlockedIpv6(v6);
  return false;
}

export type DnsLookup = (hostname: string) => Promise<string[]>;

function remainingMs(deadline?: number): number {
  if (deadline == null) return ICS_DEADLINE_MS;
  return Math.max(0, deadline - Date.now());
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, ms));
}

async function dohLookup(hostname: string, deadline?: number): Promise<string[]> {
  const answers: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    const left = remainingMs(deadline);
    if (left <= 0) throw Object.assign(new Error("dns lookup timed out"), { name: "TimeoutError" });
    const res = await outboundFetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
      {
        headers: { Accept: "application/dns-json" },
        signal: timeoutSignal(Math.min(5_000, left)),
      },
    );
    if (!res.ok) throw new Error("dns lookup failed");
    const body = (await res.json()) as { Status?: number; Answer?: { type?: number; data?: string }[] };
    if (body.Status !== 0) throw new Error("dns lookup failed");
    for (const row of body.Answer ?? []) {
      if (typeof row.data === "string" && (row.type === 1 || row.type === 28 || /[:.]/.test(row.data))) {
        const data = row.data.trim();
        if (ipv4Octets(data) || data.includes(":")) answers.push(data);
      }
    }
  }
  if (!answers.length) throw new Error("dns lookup empty");
  return answers;
}

let lookupDns: DnsLookup = (host) => dohLookup(host);

export function installDnsLookupForTests(fn: DnsLookup): () => void {
  lookupDns = fn;
  return () => {
    lookupDns = (host) => dohLookup(host);
  };
}

function isIpLiteral(host: string): boolean {
  const h = stripTrailingDots(host.trim().toLowerCase().replace(/^\[|\]$/g, ""));
  return ipv4Octets(h) !== null || parseIpv6(h) !== null;
}

export async function resolvePublicHostname(
  host: string,
  deadline?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const h = stripTrailingDots(host.trim().toLowerCase().replace(/^\[|\]$/g, ""));
  if (isIpLiteral(h) || isBlockedHost(h)) {
    return isBlockedHost(h) ? { ok: false, error: "That host isn't allowed" } : { ok: true };
  }
  if (remainingMs(deadline) <= 0) return { ok: false, error: "feed fetch timed out" };
  let answers: string[];
  try {
    answers = await lookupDns(h);
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, error: "feed fetch timed out" };
    return { ok: false, error: "That host isn't allowed" };
  }
  if (!answers.length || answers.some((addr) => isBlockedHost(addr))) {
    return { ok: false, error: "That host isn't allowed" };
  }
  return { ok: true };
}

export async function assertPublicFeedUrl(
  raw: string,
  opts?: { deadline?: number },
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!raw || typeof raw !== "string") return { ok: false, error: "A valid https calendar URL is required" };
  const feedUrl = rewriteFeedUrl(raw);
  if (!/^https:\/\//i.test(feedUrl)) return { ok: false, error: "A valid https calendar URL is required" };
  let parsed: URL;
  try {
    parsed = new URL(feedUrl);
  } catch {
    return { ok: false, error: "Malformed URL" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "A valid https calendar URL is required" };
  if (parsed.port && parsed.port !== "443") return { ok: false, error: "That host isn't allowed" };
  if (parsed.username || parsed.password) return { ok: false, error: "That host isn't allowed" };
  if (isBlockedHost(parsed.hostname)) return { ok: false, error: "That host isn't allowed" };
  const resolved = await resolvePublicHostname(parsed.hostname, opts?.deadline);
  if (!resolved.ok) return resolved;
  return { ok: true, url: parsed.toString() };
}

let fetchTimeoutMs = ICS_FETCH_MS;
let deadlineMs = ICS_DEADLINE_MS;

export function installIcsFetchTimeoutForTests(ms: number): () => void {
  const prev = fetchTimeoutMs;
  fetchTimeoutMs = ms;
  return () => {
    fetchTimeoutMs = prev;
  };
}

export function installIcsDeadlineForTests(ms: number): () => void {
  const prev = deadlineMs;
  deadlineMs = ms;
  return () => {
    deadlineMs = prev;
  };
}

type CapResult = { ok: true; text: string } | { ok: false; reason: "too_large" | "timeout" | "failed" };

async function readCapped(res: Response, max: number, signal?: AbortSignal): Promise<CapResult> {
  if (signal?.aborted) return { ok: false, reason: "timeout" };
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, reason: "too_large" };
  }
  if (!res.body) {
    const text = await res.text();
    return text.length > max ? { ok: false, reason: "too_large" } : { ok: true, text };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) return { ok: false, reason: "timeout" };
      const { done, value } = await reader.read();
      if (signal?.aborted) return { ok: false, reason: "timeout" };
      if (done) break;
      n += value.byteLength;
      if (n > max) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: signal?.aborted ? "timeout" : "failed" };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  const buf = new Uint8Array(n);
  let off = 0;
  for (const chunk of chunks) {
    buf.set(chunk, off);
    off += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(buf) };
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function timedOut(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  return name === "TimeoutError" || name === "AbortError";
}

export async function fetchIcsFeed(
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string; status?: number }> {
  const deadline = Date.now() + deadlineMs;
  let current = url;
  for (let hop = 0; hop <= ICS_MAX_REDIRECTS; hop++) {
    if (remainingMs(deadline) <= 0) return { ok: false, error: "feed fetch timed out" };
    const guarded = await assertPublicFeedUrl(current, { deadline });
    if (!guarded.ok) return { ok: false, error: guarded.error };
    const hopMs = Math.min(fetchTimeoutMs, remainingMs(deadline));
    if (hopMs <= 0) return { ok: false, error: "feed fetch timed out" };
    const signal = timeoutSignal(hopMs);
    let res: Response;
    try {
      res = await outboundFetch(guarded.url, {
        redirect: "manual",
        headers: { Accept: "text/calendar" },
        signal,
      });
    } catch (e) {
      return { ok: false, error: timedOut(e) ? "feed fetch timed out" : "feed fetch failed" };
    }
    if (isRedirect(res.status)) {
      if (hop === ICS_MAX_REDIRECTS) return { ok: false, error: "too many redirects" };
      const loc = res.headers.get("Location");
      if (!loc) return { ok: false, error: "redirect without location" };
      try {
        current = new URL(loc, guarded.url).toString();
      } catch {
        return { ok: false, error: "feed fetch failed" };
      }
      continue;
    }
    if (!res.ok) return { ok: false, error: `feed fetch failed: HTTP ${res.status}`, status: res.status };
    const text = await readCapped(res, ICS_MAX_BYTES, signal);
    if (!text.ok) {
      if (text.reason === "timeout") return { ok: false, error: "feed fetch timed out" };
      if (text.reason === "too_large") return { ok: false, error: "feed too large" };
      return { ok: false, error: "feed fetch failed" };
    }
    return { ok: true, text: text.text };
  }
  return { ok: false, error: "too many redirects" };
}

export function isIcsAuthFailure(status?: number, error?: string): boolean {
  if (status === 401 || status === 403) return true;
  return /\bHTTP 401\b/.test(error ?? "") || /\bHTTP 403\b/.test(error ?? "");
}
