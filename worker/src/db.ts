import postgres from "postgres";
import { isLoopbackHostname } from "./authUrl.ts";
import type { Env } from "./env.ts";
import { databaseUrl } from "./env.ts";

export type Sql = postgres.Sql;

const cache = new WeakMap<object, Sql>();

/**
 * TLS from the URL's sslmode, not a substring of the connection string.
 * `?application_name=localhost` on a Neon host must still require TLS.
 */
export function postgresSsl(connectionString: string): false | "require" {
  try {
    const parsed = new URL(connectionString);
    const mode = (parsed.searchParams.get("sslmode") ?? "").toLowerCase();
    if (mode === "disable" || mode === "prefer" || mode === "allow" || mode === "false") {
      return false;
    }
    if (mode === "require" || mode === "verify-ca" || mode === "verify-full") {
      return "require";
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (isLoopbackHostname(host)) return false;
    return "require";
  } catch {
    return "require";
  }
}

export function getSql(env: Env): Sql {
  const cached = cache.get(env);
  if (cached) return cached;
  const url = databaseUrl(env);
  if (!url) throw new Error("database is not configured (HYPERDRIVE or DATABASE_URL)");
  const sql = postgres(url, {
    max: 5,
    prepare: false,
    ssl: postgresSsl(url),
  });
  cache.set(env, sql);
  return sql;
}

export function jsonParam(sql: Sql, value: unknown): ReturnType<Sql["json"]> {
  return sql.json(JSON.parse(JSON.stringify(value)) as Parameters<Sql["json"]>[0]);
}
