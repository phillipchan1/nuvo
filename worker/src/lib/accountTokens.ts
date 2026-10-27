/**
 * Seal / open Better Auth `account` OAuth tokens.
 *
 * BA 1.7.13 writes access/refresh/id tokens in plaintext unless
 * `account.encryptOAuthTokens` is on (XChaCha via BETTER_AUTH_SECRET).
 * We also seal leftover plaintext with A's keyring so a token never
 * lands on `account.*` in the clear. TOKEN_ENC_KEY_V1 unset → throw.
 */
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import {
  openToken,
  parseTokenKeyring,
  sealToken,
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

export function isBaEncryptedToken(value: string): boolean {
  if (value.startsWith("$ba$")) return true;
  return value.length % 2 === 0 && value.length >= 32 && /^[0-9a-f]+$/i.test(value);
}

export function isNuvoSealedToken(value: string): boolean {
  return value.startsWith(NUVO_PREFIX);
}

export function isProtectedAccountToken(value: string): boolean {
  return isBaEncryptedToken(value) || isNuvoSealedToken(value);
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

/** Replace plaintext token fields. Already-protected values pass through. */
export async function sealAccountTokenFields(
  env: Pick<Env, "TOKEN_ENC_KEY_V1" | "TOKEN_ENC_KEY_V2" | "TOKEN_ENC_CURRENT" | "BETTER_AUTH_SECRET">,
  account: AccountTokenFields,
): Promise<AccountTokenFields> {
  const pending = ACCOUNT_TOKEN_KEYS.filter((key) => {
    const value = account[key];
    return typeof value === "string" && value.length > 0 && !isProtectedAccountToken(value);
  });
  if (pending.length === 0) return account;
  if (!(env.TOKEN_ENC_KEY_V1 ?? "").trim()) {
    throw new TokenCryptoError("TOKEN_ENC_KEY_V1 missing");
  }
  const next: AccountTokenFields = { ...account };
  const aad = accountAad(next);
  if (aad) {
    const keyring = await parseTokenKeyring(env);
    for (const key of pending) {
      next[key] = formatNuvoSealedToken(await sealToken(account[key] as string, aad, keyring));
    }
    return next;
  }
  // linkSocial's update hook is a patch: tokens, no id/userId. Seal with
  // BA's own XChaCha so leftover plaintext (idToken) never lands in the clear.
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret) throw new TokenCryptoError("account id and userId required to seal");
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
  if (isNuvoSealedToken(stored)) {
    const keyring = await parseTokenKeyring(env);
    const sealed = parseNuvoSealedToken(stored);
    let last: unknown;
    for (const aad of accountAadCandidates(account)) {
      try {
        return await openToken(sealed, aad, keyring);
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof TokenCryptoError ? last : new TokenCryptoError("decrypt failed");
  }
  if (isBaEncryptedToken(stored)) {
    const secret = env.BETTER_AUTH_SECRET?.trim();
    if (!secret) throw new TokenCryptoError("BETTER_AUTH_SECRET missing");
    return symmetricDecrypt({ key: secret, data: stored });
  }
  // Legacy leftover — do not treat as a successful sealed store.
  return stored;
}
