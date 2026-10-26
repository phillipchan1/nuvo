import postgres from "postgres";
import { isLoopbackHostname } from "./authUrl.ts";
import type { Env } from "./env.ts";
import { databaseUrl } from "./env.ts";

export type Sql = postgres.Sql;

const PLACEHOLDER_HYPERDRIVE = "00000000000000000000000000000000";

/** True when the Worker will use the Hyperdrive binding (not the preview placeholder). */
export function usesHyperdrive(env: Pick<Env, "HYPERDRIVE">): boolean {
  const from = env.HYPERDRIVE?.connectionString?.trim() ?? "";
  return Boolean(from) && !from.includes(PLACEHOLDER_HYPERDRIVE);
}

/** Parsed hostname only — never a substring of user, database, or query. */
export function isHyperdriveHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "hyperdrive.local" || host.endsWith(".hyperdrive.local");
}

/**
 * TLS from the URL's sslmode, not a substring of the connection string.
 * `?application_name=localhost` on a Neon host must still require TLS.
 * Cloudflare Hyperdrive (`*.hyperdrive.local`) is already TLS to origin —
 * client TLS to Hyperdrive hangs, so it is always off.
 */
export function postgresSsl(connectionString: string): false | "require" {
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (isHyperdriveHostname(host)) return false;
    const mode = (parsed.searchParams.get("sslmode") ?? "").toLowerCase();
    if (mode === "disable" || mode === "prefer" || mode === "allow" || mode === "false") {
      return false;
    }
    if (mode === "require" || mode === "verify-ca" || mode === "verify-full") {
      return "require";
    }
    if (isLoopbackHostname(host)) return false;
    return "require";
  } catch {
    return "require";
  }
}

/**
 * ssl for a client opened from this env. Hyperdrive-sourced strings are
 * never client-TLS, even if the hostname is not `.hyperdrive.local`.
 */
export function clientSsl(env: Pick<Env, "HYPERDRIVE">, connectionString: string): false | "require" {
  if (usesHyperdrive(env)) return false;
  return postgresSsl(connectionString);
}

/**
 * Fresh client per request. Workers cannot reuse TCP sockets across requests.
 * `max: 1` — this is one of two sockets a data request opens (see openAuth).
 * Production multiplexes both through Hyperdrive (docs/cloudflare-cutover.md).
 */
export function openSql(env: Env): Sql {
  const url = databaseUrl(env);
  if (!url) throw new Error("database is not configured");
  return postgres(url, {
    max: 1,
    prepare: false,
    ssl: clientSsl(env, url),
  });
}

export function closeSql(sql: Sql): Promise<void> {
  return sql.end({ timeout: 5 });
}

export function jsonParam(sql: Sql, value: unknown): ReturnType<Sql["json"]> {
  return sql.json(JSON.parse(JSON.stringify(value)) as Parameters<Sql["json"]>[0]);
}
