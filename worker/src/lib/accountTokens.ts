/**
 * Seal / open Better Auth `account` OAuth tokens.
 *
 * Decrypt with BA's keyring-aware `secretConfig` (string when only
 * `BETTER_AUTH_SECRET` is set; `{ keys, currentVersion, legacySecret }`
 * when `BETTER_AUTH_SECRETS` is set) — never the raw string alone.
 * Encrypted-looking values (`$ba$` or even-length hex) that will not
 * decrypt fail closed: seal never re-wraps them, open returns null
 * (never ciphertext).
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

/** Same shape BA puts on `ctx.context.secretConfig`. */
export type BaSecretConfig = string | {
  keys: Map<number, string>;
  currentVersion: number;
  legacySecret?: string;
};

export type TokenCryptoEnv = Pick<
  Env,
  "TOKEN_ENC_KEY_V1" | "TOKEN_ENC_KEY_V2" | "TOKEN_ENC_CURRENT" | "BETTER_AUTH_SECRET" | "BETTER_AUTH_SECRETS"
> & {
  secretConfig?: BaSecretConfig;
};

export function isNuvoSealedToken(value: string): boolean {
  return value.startsWith(NUVO_PREFIX);
}

/** BA's own heuristic (`better-auth/oauth2` `isLikelyEncrypted`). */
export function isLikelyEncrypted(value: string): boolean {
  if (value.startsWith("$ba$")) return true;
  return value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

export function baCiphertext(value: string): string {
  if (!value.startsWith("$ba$")) return value;
  const rest = value.slice(4);
  const sep = rest.indexOf("$");
  return sep === -1 ? value : rest.slice(sep + 1);
}

/**
 * `2:<current>,1:<previous>` — first entry is the write version.
 * Same grammar as BA's `BETTER_AUTH_SECRETS`.
 */
export function parseBetterAuthSecrets(
  raw: string | undefined,
): { version: number; value: string }[] | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const out: { version: number; value: string }[] = [];
  for (const entry of trimmed.split(",")) {
    const part = entry.trim();
    const colon = part.indexOf(":");
    if (colon === -1) return null;
    const version = Number.parseInt(part.slice(0, colon), 10);
    const value = part.slice(colon + 1).trim();
    if (!Number.isInteger(version) || version < 0 || !value) return null;
    out.push({ version, value });
  }
  return out.length > 0 ? out : null;
}

/** Prefer an explicit config (hook `ctx.context.secretConfig`), else env. */
export function resolveBaSecretConfig(env: TokenCryptoEnv): BaSecretConfig | undefined {
  if (env.secretConfig !== undefined) return env.secretConfig;
  const secrets = parseBetterAuthSecrets(env.BETTER_AUTH_SECRETS);
  const legacy = env.BETTER_AUTH_SECRET?.trim();
  if (secrets) {
    const keys = new Map<number, string>();
    for (const s of secrets) keys.set(s.version, s.value);
    return {
      keys,
      currentVersion: secrets[0]!.version,
      ...(legacy ? { legacySecret: legacy } : {}),
    };
  }
  return legacy || undefined;
}

/**
 * Decrypt with the keyring-aware config. Success ⇒ BA ciphertext opened.
 * Does not treat decrypt-fail as plaintext.
 */
export async function tryDecryptBaToken(
  secretConfig: BaSecretConfig,
  value: string,
): Promise<string | null> {
  if (!value) return null;
  try {
    const plain = await symmetricDecrypt({ key: secretConfig, data: value });
    if (typeof plain === "string" && plain.length > 0) return plain;
  } catch {
    /* not ciphertext this config can open */
  }
  return null;
}

export async function isBaEncryptedToken(
  secretConfig: BaSecretConfig,
  value: string,
): Promise<boolean> {
  return (await tryDecryptBaToken(secretConfig, value)) !== null;
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

function alreadyProtected(value: string): boolean {
  if (isNuvoSealedToken(value)) return true;
  // Encrypted-looking (hex or $ba$) — never re-seal, even if this
  // config cannot open it. Re-sealing is how rotation double-encrypts.
  return isLikelyEncrypted(value);
}

/** Replace plaintext token fields. BA ciphertext and nv1. wrappers pass through. */
export async function sealAccountTokenFields(
  env: TokenCryptoEnv,
  account: AccountTokenFields,
  secretConfig?: BaSecretConfig,
): Promise<AccountTokenFields> {
  const config = secretConfig ?? resolveBaSecretConfig(env);
  const pending: AccountTokenKey[] = [];
  for (const key of ACCOUNT_TOKEN_KEYS) {
    const value = account[key];
    if (typeof value !== "string" || value.length === 0) continue;
    if (alreadyProtected(value)) continue;
    pending.push(key);
  }
  if (pending.length === 0) return account;
  if (!(env.TOKEN_ENC_KEY_V1 ?? "").trim()) {
    throw new TokenCryptoError("TOKEN_ENC_KEY_V1 missing");
  }
  if (!config) throw new TokenCryptoError("BETTER_AUTH_SECRET missing");
  const next: AccountTokenFields = { ...account };
  for (const key of pending) {
    next[key] = await symmetricEncrypt({ key: config, data: account[key] as string });
  }
  return next;
}

export async function openAccountRefreshToken(
  env: TokenCryptoEnv,
  stored: string,
  account: AccountTokenFields,
  secretConfig?: BaSecretConfig,
): Promise<string | null> {
  if (!stored) return null;
  const config = secretConfig ?? resolveBaSecretConfig(env);
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
  if (config) {
    const ba = await tryDecryptBaToken(config, inner);
    if (ba !== null) return ba;
  }
  if (isLikelyEncrypted(inner)) return null;
  return inner;
}
