/**
 * Seal / open Better Auth `account` OAuth tokens.
 *
 * BA 1.7.13 with only BETTER_AUTH_SECRET sets `secretConfig` to that
 * string, so `encryptOAuthTokens` writes **bare hex** (no `$ba$` prefix).
 * Classification is decrypt-based: if BA's own decrypt succeeds, the
 * value is already ciphertext — never re-seal it. Open unwraps a legacy
 * nv1. wrapper first, then BA-decrypts the inner value so revoke and
 * BA's own token reads both see plaintext.
 */
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import {
  openToken,
  parseTokenKeyring,
  TokenCryptoError,
  type SealedToken,
} from "../secrets.ts";
import type { Env } from "../env.ts";

export const ACCOUNT_TOKEN_KEYS = ["accessToken", "refreshToken", "idToken"] as const;
export type AccountTokenKey = (typeof ACCOUNT_TOKEN_KEYS)[number];

const NUVO_PREFIX = "nv1.";

export type AccountTokenFields = {
  id?: string;
  userId?: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
};

export function isNuvoSealedToken(value: string): boolean {
  return value.startsWith(NUVO_PREFIX);
}

export function baCiphertext(value: string): string {
  if (!value.startsWith("$ba$")) return value;
  const rest = value.slice(4);
  const sep = rest.indexOf("$");
  return sep === -1 ? value : rest.slice(sep + 1);
}

/**
 * Attempt BA's own decrypt (string secret = bare hex; `$ba$<v>$` envelope
 * is unwrapped then decrypted the same way). Success ⇒ BA ciphertext.
 */
export async function tryDecryptBaToken(secret: string, value: string): Promise<string | null> {
  if (!secret || !value) return null;
  try {
    const plain = await symmetricDecrypt({ key: secret, data: value });
    if (typeof plain === "string" && plain.length > 0) return plain;
  } catch {
    /* not bare-hex BA ciphertext */
  }
  if (value.startsWith("$ba$")) {
    const hex = baCiphertext(value);
    if (hex !== value) {
      try {
        const plain = await symmetricDecrypt({ key: secret, data: hex });
        if (typeof plain === "string" && plain.length > 0) return plain;
      } catch {
        /* not an envelope we can open */
      }
    }
  }
  return null;
}

export async function isBaEncryptedToken(secret: string, value: string): Promise<boolean> {
  return (await tryDecryptBaToken(secret, value)) !== null;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function b64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function formatNuvoSealedToken(sealed: SealedToken): string {
  return `${NUVO_PREFIX}${sealed.keyVersion}.${bytesToB64(sealed.iv)}.${bytesToB64(sealed.ciphertext)}`;
}

export function parseNuvoSealedToken(value: string): SealedToken {
  const parts = value.slice(NUVO_PREFIX.length).split(".");
  if (parts.length !== 3) throw new TokenCryptoError("invalid sealed account token");
  const keyVersion = Number.parseInt(parts[0] ?? "", 10);
  if (!Number.isFinite(keyVersion)) throw new TokenCryptoError("invalid sealed account token");
  return {
    keyVersion,
    iv: b64ToBytes(parts[1] ?? ""),
    ciphertext: b64ToBytes(parts[2] ?? ""),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AccountAad = { table: string; rowId: string; userId: string };

function asUuid(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

/** Prefer account.id, else userId. BA's update hook often has neither. */
export function accountAad(account: AccountTokenFields): AccountAad | null {
  const userId = asUuid(account.userId);
  const rowId = asUuid(account.id) ?? userId;
  if (!rowId || !userId) return null;
  return { table: "account", rowId, userId };
}

function accountAadCandidates(account: AccountTokenFields): AccountAad[] {
  const userId = asUuid(account.userId);
  const id = asUuid(account.id);
  const out: AccountAad[] = [];
  const push = (rowId: string, uid: string) => {
    if (out.some((a) => a.rowId === rowId && a.userId === uid)) return;
    out.push({ table: "account", rowId, userId: uid });
  };
  if (id && userId) push(id, userId);
  if (userId) push(userId, userId);
  if (id && userId) push(userId, id);
  return out;
}

async function alreadyProtected(
  secret: string | undefined,
  value: string,
): Promise<boolean> {
  if (isNuvoSealedToken(value)) return true;
  if (!secret) return false;
  return (await tryDecryptBaToken(secret, value)) !== null;
}

/** Replace plaintext token fields. BA ciphertext and nv1. wrappers pass through. */
export async function sealAccountTokenFields(
  env: Pick<Env, "TOKEN_ENC_KEY_V1" | "TOKEN_ENC_KEY_V2" | "TOKEN_ENC_CURRENT" | "BETTER_AUTH_SECRET">,
  account: AccountTokenFields,
): Promise<AccountTokenFields> {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  const pending: AccountTokenKey[] = [];
  for (const key of ACCOUNT_TOKEN_KEYS) {
    const value = account[key];
    if (typeof value !== "string" || value.length === 0) continue;
    if (await alreadyProtected(secret, value)) continue;
    pending.push(key);
  }
  if (pending.length === 0) return account;
  if (!(env.TOKEN_ENC_KEY_V1 ?? "").trim()) {
    throw new TokenCryptoError("TOKEN_ENC_KEY_V1 missing");
  }
  const next: AccountTokenFields = { ...account };
  // Leftover plaintext: encrypt the same way BA does (string secret → hex)
  // so BA's own decryptOAuthToken can read it. Do not nv1-wrap BA hex.
  if (!secret) throw new TokenCryptoError("BETTER_AUTH_SECRET missing");
  for (const key of pending) {
    next[key] = await symmetricEncrypt({ key: secret, data: account[key] as string });
  }
  return next;
}

export async function openAccountRefreshToken(
  env: Pick<Env, "TOKEN_ENC_KEY_V1" | "TOKEN_ENC_KEY_V2" | "TOKEN_ENC_CURRENT" | "BETTER_AUTH_SECRET">,
  stored: string,
  account: AccountTokenFields,
): Promise<string | null> {
  if (!stored) return null;
  const secret = env.BETTER_AUTH_SECRET?.trim();
  let inner = stored;
  if (isNuvoSealedToken(stored)) {
    const keyring = await parseTokenKeyring(env);
    const sealed = parseNuvoSealedToken(stored);
    let last: unknown;
    let opened: string | null = null;
    for (const aad of accountAadCandidates(account)) {
      try {
        opened = await openToken(sealed, aad, keyring);
        last = null;
        break;
      } catch (err) {
        last = err;
      }
    }
    if (opened == null) {
      throw last instanceof TokenCryptoError ? last : new TokenCryptoError("decrypt failed");
    }
    inner = opened;
  }
  if (secret) {
    const ba = await tryDecryptBaToken(secret, inner);
    if (ba !== null) return ba;
  }
  return inner;
}
