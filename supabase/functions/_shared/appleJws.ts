/**
 * App Store signed-data (JWS) verification — shared by the Worker
 * (`worker/src/billing/appleJws.ts` re-exports this file) and the Supabase
 * edge functions (`apple-iap`, `apple-webhook`). Zero imports, WebCrypto only, so Deno,
 * workerd and Node all run the identical code.
 *
 * App Store Server Notifications V2 arrive as `{ signedPayload }`, an ES256
 * JWS whose header carries the certificate chain in `x5c`
 * (leaf → Apple Worldwide Developer Relations intermediate → Apple Root CA G3).
 * The nested `signedTransactionInfo` / `signedRenewalInfo` are JWS too.
 *
 * Verification here is the same chain Apple's own App Store Server Library
 * checks, without a dependency:
 *   1. the last cert in `x5c` IS Apple Root CA - G3 (SHA-256 pinned),
 *   2. each cert is signed by the next one up (ECDSA, P-256/P-384),
 *   3. each cert is inside its validity window at the payload's signedDate,
 *   4. the leaf carries Apple's receipt-signing marker OID and the
 *      intermediate carries Apple's WWDR intermediate marker OID,
 *   5. the JWS signature verifies under the leaf's key.
 *
 * StoreKit 2's `Transaction`/`VerificationResult.jwsRepresentation` is the
 * same shape, so the in-app purchase confirm (`apple-iap`) verifies with it too.
 *
 * App Store Server Notifications are verified with it on both runtimes: the
 * Worker's webhook and the Supabase `apple-webhook` (`appleWebhook.ts`).
 */

/** SHA-256 of Apple Root CA - G3 (https://www.apple.com/certificateauthority/AppleRootCA-G3.cer). */
export const APPLE_ROOT_CA_G3_SHA256 =
  "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";

/** 1.2.840.113635.100.6.11.1 — Apple receipt/App Store signing leaf. */
const OID_APPLE_LEAF = new Uint8Array([0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x0b, 0x01]);
/** 1.2.840.113635.100.6.2.1 — Apple WWDR intermediate. */
const OID_APPLE_INTERMEDIATE = new Uint8Array([0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x02, 0x01]);

const OID_P256 = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
const OID_P384 = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22]);
const OID_ECDSA_SHA256 = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
const OID_ECDSA_SHA384 = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03]);

export class AppleJwsError extends Error {
  override name = "AppleJwsError";
}

export interface AppleJwsOptions {
  /** Hex SHA-256 fingerprints accepted as the root. Default: Apple Root CA - G3 only. */
  rootFingerprints?: readonly string[];
  /** Override the instant certs are checked at. Default: the payload's signedDate, else now. */
  at?: Date;
}

// `as BufferSource` below is type-only: Deno's lib makes Uint8Array generic
// over its buffer (TS 5.7+), and the repo's tsc (5.6) does not.

// ── DER ──────────────────────────────────────────────────────────────────────

interface Tlv {
  tag: number;
  start: number; // first byte of the TLV (tag)
  contentStart: number;
  end: number; // exclusive
}

function readTlv(bytes: Uint8Array, offset: number): Tlv {
  if (offset + 2 > bytes.length) throw new AppleJwsError("truncated DER");
  const tag = bytes[offset]!;
  let len = bytes[offset + 1]!;
  let p = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new AppleJwsError("bad DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + bytes[p + i]!;
    p += n;
  }
  const end = p + len;
  if (end > bytes.length) throw new AppleJwsError("truncated DER");
  return { tag, start: offset, contentStart: p, end };
}

function children(bytes: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let p = parent.contentStart;
  while (p < parent.end) {
    const t = readTlv(bytes, p);
    out.push(t);
    p = t.end;
  }
  return out;
}

function slice(bytes: Uint8Array, t: Tlv, contentOnly = false): Uint8Array {
  return bytes.slice(contentOnly ? t.contentStart : t.start, t.end);
}

function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

function parseTime(bytes: Uint8Array, t: Tlv): Date {
  const s = new TextDecoder().decode(slice(bytes, t, true));
  let m: RegExpExecArray | null;
  if (t.tag === 0x17 && (m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s))) {
    const yy = Number(m[1]);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  }
  if (t.tag === 0x18 && (m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s))) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  }
  throw new AppleJwsError("bad certificate time");
}

export interface ParsedCert {
  der: Uint8Array;
  tbs: Uint8Array;
  sigAlg: "SHA-256" | "SHA-384";
  signature: Uint8Array; // DER ECDSA-Sig-Value
  spki: Uint8Array;
  curve: "P-256" | "P-384";
  notBefore: Date;
  notAfter: Date;
}

export function parseCertificate(der: Uint8Array): ParsedCert {
  const cert = readTlv(der, 0);
  if (cert.tag !== 0x30 || cert.end !== der.length) throw new AppleJwsError("not a certificate");
  const [tbsT, algT, sigT] = children(der, cert);
  if (!tbsT || !algT || !sigT || sigT.tag !== 0x03) throw new AppleJwsError("bad certificate");
  const alg = slice(der, algT);
  const sigAlg = contains(alg, OID_ECDSA_SHA256) ? "SHA-256" : contains(alg, OID_ECDSA_SHA384) ? "SHA-384" : null;
  if (!sigAlg) throw new AppleJwsError("unsupported certificate signature algorithm");
  const sigBits = slice(der, sigT, true);
  if (sigBits[0] !== 0) throw new AppleJwsError("bad signature bit string");

  const fields = children(der, tbsT);
  let i = 0;
  if (fields[i]?.tag === 0xa0) i++; // [0] version
  i++; // serial
  i++; // signature algorithm
  i++; // issuer
  const validity = fields[i++];
  i++; // subject
  const spkiT = fields[i++];
  if (!validity || !spkiT || validity.tag !== 0x30 || spkiT.tag !== 0x30) throw new AppleJwsError("bad tbsCertificate");
  const [nb, na] = children(der, validity);
  if (!nb || !na) throw new AppleJwsError("bad validity");
  const spki = slice(der, spkiT);
  const curve = contains(spki, OID_P256) ? "P-256" : contains(spki, OID_P384) ? "P-384" : null;
  if (!curve) throw new AppleJwsError("unsupported certificate key");
  return {
    der,
    tbs: slice(der, tbsT),
    sigAlg,
    signature: sigBits.slice(1),
    spki,
    curve,
    notBefore: parseTime(der, nb),
    notAfter: parseTime(der, na),
  };
}

/** DER `SEQUENCE { INTEGER r, INTEGER s }` → raw `r || s` (what WebCrypto verifies). */
export function ecdsaDerToRaw(sig: Uint8Array, size: number): Uint8Array {
  const seq = readTlv(sig, 0);
  if (seq.tag !== 0x30) throw new AppleJwsError("bad ECDSA signature");
  const parts = children(sig, seq);
  if (parts.length !== 2 || parts.some((p) => p.tag !== 0x02)) throw new AppleJwsError("bad ECDSA signature");
  const out = new Uint8Array(size * 2);
  parts.forEach((p, idx) => {
    let v = slice(sig, p, true);
    while (v.length > size && v[0] === 0) v = v.slice(1);
    if (v.length > size) throw new AppleJwsError("bad ECDSA integer");
    out.set(v, idx * size + (size - v.length));
  });
  return out;
}

async function importSpki(cert: ParsedCert): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", cert.spki as BufferSource, { name: "ECDSA", namedCurve: cert.curve }, false, ["verify"]);
}

async function signedBy(child: ParsedCert, issuer: ParsedCert): Promise<boolean> {
  const key = await importSpki(issuer);
  const size = issuer.curve === "P-256" ? 32 : 48;
  return crypto.subtle.verify(
    { name: "ECDSA", hash: child.sigAlg },
    key,
    ecdsaDerToRaw(child.signature, size) as BufferSource,
    child.tbs as BufferSource,
  );
}

// ── base64 ───────────────────────────────────────────────────────────────────

function b64ToBytes(b64: string): Uint8Array {
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? "" : "=".repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(part: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64ToBytes(part)));
  } catch {
    throw new AppleJwsError("JWS segment is not JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AppleJwsError("JWS segment is not an object");
  return parsed as Record<string, unknown>;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function signedDateOf(payload: Record<string, unknown>): Date | null {
  const v = payload.signedDate;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? new Date(n) : null;
}

/** Verify one App Store JWS and return its payload. Throws AppleJwsError on anything off. */
export async function verifyAppleJws(
  jws: string,
  opts: AppleJwsOptions = {},
): Promise<Record<string, unknown>> {
  const parts = jws.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) throw new AppleJwsError("not a compact JWS");
  const [h, p, s] = parts as [string, string, string];
  const header = b64urlJson(h);
  if (header.alg !== "ES256") throw new AppleJwsError("JWS alg must be ES256");
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length !== 3 || x5c.some((c) => typeof c !== "string")) {
    throw new AppleJwsError("JWS x5c must be a three-certificate chain");
  }
  const payload = b64urlJson(p);

  let certs: ParsedCert[];
  try {
    certs = (x5c as string[]).map((c) => parseCertificate(b64ToBytes(c)));
  } catch (e) {
    if (e instanceof AppleJwsError) throw e;
    throw new AppleJwsError("bad x5c certificate");
  }
  const [leaf, intermediate, root] = certs as [ParsedCert, ParsedCert, ParsedCert];

  const pins = (opts.rootFingerprints ?? [APPLE_ROOT_CA_G3_SHA256]).map((f) => f.replace(/[^0-9a-f]/gi, "").toLowerCase());
  if (!pins.includes(await sha256Hex(root.der))) throw new AppleJwsError("x5c root is not Apple Root CA");

  const at = opts.at ?? signedDateOf(payload) ?? new Date();
  for (const c of certs) {
    if (at < c.notBefore || at > c.notAfter) throw new AppleJwsError("certificate outside its validity window");
  }
  if (!contains(leaf.tbs, OID_APPLE_LEAF)) throw new AppleJwsError("leaf is not an App Store signing certificate");
  if (!contains(intermediate.tbs, OID_APPLE_INTERMEDIATE)) throw new AppleJwsError("intermediate is not Apple WWDR");
  if (!(await signedBy(intermediate, root))) throw new AppleJwsError("intermediate not signed by root");
  if (!(await signedBy(leaf, intermediate))) throw new AppleJwsError("leaf not signed by intermediate");
  if (leaf.curve !== "P-256") throw new AppleJwsError("leaf key must be P-256 for ES256");

  const sig = b64ToBytes(s);
  if (sig.length !== 64) throw new AppleJwsError("ES256 signature must be 64 bytes");
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await importSpki(leaf),
    sig as BufferSource,
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new AppleJwsError("JWS signature does not verify");
  return payload;
}
