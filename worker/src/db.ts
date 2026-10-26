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
    if (isLoopbackHostname(host)) {
      const mode = (parsed.searchParams.get("sslmode") ?? "").toLowerCase();
      if (mode === "require" || mode === "verify-ca" || mode === "verify-full") {
        return "require";
      }
      return false;
    }
    // Remote DATABASE_URL (Neon): always TLS. sslmode=prefer/allow/disable
    // must not open a cleartext client to a public host.
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
 * Drop `sslmode` so node-pg / postgres.js cannot re-enable TLS from the
 * URL after we decided `ssl: false` (Hyperdrive bindings often append
 * `?sslmode=require`).
 */
export function stripSslMode(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    if (!parsed.searchParams.has("sslmode")) return connectionString;
    parsed.searchParams.delete("sslmode");
    return parsed.toString();
  } catch {
    return connectionString;
  }
}

/** Connection string + ssl for a client. `sslmode` never overrides `ssl`. */
export function clientConnection(
  env: Pick<Env, "HYPERDRIVE">,
  connectionString: string,
): { connectionString: string; ssl: false | "require" } {
  const ssl = clientSsl(env, connectionString);
  return {
    // Always drop sslmode so node-pg cannot override the explicit `ssl`
    // (require on Hyperdrive, or disable on a remote Neon host).
    connectionString: stripSslMode(connectionString),
    ssl,
  };
}

/**
 * Fresh client per request. Workers cannot reuse TCP sockets across requests.
 * `max: 1` — this is one of two sockets a data request opens (see openAuth).
 * Production multiplexes both through Hyperdrive (docs/cloudflare-cutover.md).
 */
export function openSql(env: Env): Sql {
  const url = databaseUrl(env);
  if (!url) throw new Error("database is not configured");
  const { connectionString, ssl } = clientConnection(env, url);
  return postgres(connectionString, {
    max: 1,
    prepare: false,
    ssl,
  });
}

export function closeSql(sql: Sql): Promise<void> {
  return sql.end({ timeout: 5 });
}

export function jsonParam(sql: Sql, value: unknown): ReturnType<Sql["json"]> {
  return sql.json(JSON.parse(JSON.stringify(value)) as Parameters<Sql["json"]>[0]);
}
