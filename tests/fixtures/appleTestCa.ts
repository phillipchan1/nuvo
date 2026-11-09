// A generated Apple-shaped CA for App Store JWS tests: Root (P-384) →
// WWDR-marked CA intermediate (P-384) → App-Store-marked leaf (P-256), DER built
// by hand so the test needs no dependency. Pin the generated root with
// `{ rootFingerprints: [ca.rootFp] }`; under the real Apple pin it is refused.
// Shared by worker/src/billing.check.ts (node --experimental-strip-types) and
// vitest (tests/apple-iap-verify.test.ts) — erasable TypeScript only.
export function lenBytes(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x100) return [0x81, n];
  return [0x82, n >> 8, n & 0xff];
}
export function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const head = [tag, ...lenBytes(total)];
  const out = new Uint8Array(head.length + total);
  out.set(head, 0);
  let o = head.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
export const u8 = (...b: number[]) => new Uint8Array(b);
export const seq = (...p: Uint8Array[]) => tlv(0x30, ...p);
export const OID_SHA256 = u8(0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02);
export const OID_SHA384 = u8(0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03);
export const OID_LEAF = u8(0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x0b, 0x01);
export const OID_INTER = u8(0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x02, 0x01);
export function name(cn: string): Uint8Array {
  return seq(tlv(0x31, seq(u8(0x06, 0x03, 0x55, 0x04, 0x03), tlv(0x0c, new TextEncoder().encode(cn)))));
}
export function utc(d: Date): Uint8Array {
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, new TextEncoder().encode(s));
}
export function derInt(raw: Uint8Array): Uint8Array {
  let v = raw;
  while (v.length > 1 && v[0] === 0 && !(v[1]! & 0x80)) v = v.slice(1);
  if (v[0]! & 0x80) v = new Uint8Array([0, ...v]);
  return tlv(0x02, v);
}
export function rawToDerSig(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  return seq(derInt(raw.slice(0, half)), derInt(raw.slice(half)));
}
export type Key = { pair: CryptoKeyPair; spki: Uint8Array; curve: "P-256" | "P-384" };
export async function newKey(curve: "P-256" | "P-384"): Promise<Key> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: curve }, true, ["sign", "verify"])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return { pair, spki, curve };
}
export const OID_BASIC_CONSTRAINTS = u8(0x06, 0x03, 0x55, 0x1d, 0x13);
/** One Extension: `SEQUENCE { extnID, [critical], extnValue OCTET STRING }`. */
export function ext(oid: Uint8Array, value: Uint8Array, critical = false): Uint8Array {
  return seq(oid, ...(critical ? [u8(0x01, 0x01, 0xff)] : []), tlv(0x04, value));
}
/** basicConstraints; `ca: false` is written out explicitly (parsers must accept it). */
export function basicConstraints(ca: boolean): Uint8Array {
  return ext(OID_BASIC_CONSTRAINTS, seq(u8(0x01, 0x01, ca ? 0xff : 0x00)), true);
}
export interface CertOptions {
  /** basicConstraints: true / false written out; undefined = absent. */
  ca?: boolean;
  /** Replace the generated extension list entirely. */
  extensions?: Uint8Array[];
}
let serial = 1;
export async function cert(
  subject: string,
  key: Key,
  issuer: string,
  issuerKey: Key,
  marker: Uint8Array | null,
  nb: Date,
  na: Date,
  opts: CertOptions = {},
) {
  const sigOid = issuerKey.curve === "P-384" ? OID_SHA384 : OID_SHA256;
  const hash = issuerKey.curve === "P-384" ? "SHA-384" : "SHA-256";
  const list = opts.extensions ?? [
    ...(opts.ca !== undefined ? [basicConstraints(opts.ca)] : []),
    ...(marker ? [ext(marker, u8(0x05, 0x00))] : []),
  ];
  const ext_ = list.length ? [tlv(0xa3, seq(...list))] : [];
  const tbs = seq(
    tlv(0xa0, u8(0x02, 0x01, 0x02)),
    u8(0x02, 0x01, serial++),
    seq(sigOid),
    name(issuer),
    seq(utc(nb), utc(na)),
    name(subject),
    key.spki,
    ...ext_,
  );
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash }, issuerKey.pair.privateKey, tbs));
  return seq(tbs, seq(sigOid), tlv(0x03, u8(0), rawToDerSig(raw)));
}
export const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
export const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function sha256Hex(b: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b)), (x) => x.toString(16).padStart(2, "0")).join("");
}


export const past = new Date("2020-01-01T00:00:00Z");
export const future = new Date("2040-01-01T00:00:00Z");

export type AppleTestCa = Awaited<ReturnType<typeof makeAppleTestCa>>;

export async function makeAppleTestCa() {
  const rootKey = await newKey("P-384");
  const interKey = await newKey("P-384");
  const leafKey = await newKey("P-256");
  const rootDer = await cert("Test Root CA - G3", rootKey, "Test Root CA - G3", rootKey, null, past, future, { ca: true });
  const interDer = await cert("Test WWDR G6", interKey, "Test Root CA - G3", rootKey, OID_INTER, past, future, { ca: true });
  const leafDer = await cert("Test Prod ECC Mac App Store", leafKey, "Test WWDR G6", interKey, OID_LEAF, past, future);
  const rootFp = await sha256Hex(rootDer);
  const x5c = [b64(leafDer), b64(interDer), b64(rootDer)];
  async function jws(payload: Record<string, unknown>, opts: { key?: Key; chain?: string[] } = {}) {
    const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", x5c: opts.chain ?? x5c })));
    const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, (opts.key ?? leafKey).pair.privateKey, new TextEncoder().encode(`${h}.${p}`)),
    );
    return `${h}.${p}.${b64url(sig)}`;
  }
  return { rootKey, interKey, leafKey, rootDer, interDer, leafDer, rootFp, x5c, jws };
}
