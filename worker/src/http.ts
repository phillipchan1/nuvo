import type { Context } from "hono";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BadRequestError extends Error {
  override name = "BadRequestError";
  constructor(message = "bad request") {
    super(message);
  }
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function containsNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\0");
  if (Array.isArray(value)) return value.some(containsNul);
  if (value && typeof value === "object") return Object.values(value).some(containsNul);
  return false;
}

export function requireUuid(value: string | undefined, label = "id"): string {
  if (!value || !isUuid(value) || value.includes("\0")) {
    throw new BadRequestError(`${label} is not a uuid`);
  }
  return value;
}

export async function readJson<T>(c: Context): Promise<T> {
  const text = await c.req.text();
  if (text.includes("\0")) throw new BadRequestError("malformed body");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BadRequestError("malformed body");
  }
  if (containsNul(body)) throw new BadRequestError("malformed body");
  return body as T;
}

/** POST/PATCH table bodies must be a JSON object. A string, null, or [] is 400. */
export function requireJsonObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("malformed body");
  }
  return body as Record<string, unknown>;
}

export function postgresInputError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code) : "";
  return code === "22P02" || code === "22P05" || code === "22021" || code === "22P03" || code === "23505";
}

const UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "EAI_AGAIN",
  "CONNECT_TIMEOUT",
  "57P01",
  "57P03",
  "08000",
  "08001",
  "08003",
  "08006",
]);

function errorText(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const row = err as { code?: unknown; errno?: unknown; message?: unknown };
    return [row.code, row.errno, row.message].filter((v) => v != null).join(" ");
  }
  return String(err);
}

/** Connection / DB-down. Never use the message as a client body (hosts leak). */
export function isDatabaseUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return typeof err === "string" && isUnavailableText(err);
  }
  const row = err as { code?: unknown; errno?: unknown; cause?: unknown };
  const code = String(row.code ?? row.errno ?? "");
  if (UNAVAILABLE_CODES.has(code)) return true;
  if (row.cause && isDatabaseUnavailable(row.cause)) return true;
  return isUnavailableText(errorText(err));
}

export function isUnavailableText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("econnrefused") ||
    lower.includes("connection refused") ||
    // Hyperdrive / pg when origin is down: "disconnected: Connection refused"
    lower.includes("disconnected") ||
    lower.includes("connect timeout") ||
    lower.includes("connection timeout") ||
    lower.includes("connect_timeout") ||
    lower.includes("timeout expired") ||
    lower.includes("connection terminated") ||
    lower.includes("connection ended") ||
    lower.includes("connection_ended") ||
    lower.includes("connection_closed") ||
    lower.includes("enotfound") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset") ||
    lower.includes("too many clients") ||
    lower.includes("the database system is starting") ||
    lower.includes("the database system is shutting")
  );
}
