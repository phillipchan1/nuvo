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

export function postgresInputError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code) : "";
  return code === "22P02" || code === "22P05" || code === "22021" || code === "22P03";
}
