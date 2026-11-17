/**
 * Which requests poke the cron gate (D-239) — decided once, here.
 *
 * The rule leans to over-poking: an extra poke costs one push-dispatch run
 * for one account on a minute Neon is already awake for the write; a missed
 * one makes a reminder wait for the hourly cap. So every request that opened
 * the database and is not a read counts, except a short list of POSTs that
 * only read (or only touch rows no reminder hangs on).
 */
import type { GatePoke } from "./cronGate.ts";

/** POSTs that read, or write only what no reminder or calendar poll depends on. */
const READ_ONLY_POSTS = [
  /^\/api\/rest\/v1\/rpc\/(sync_changes|contacts)$/,
  /^\/api\/rpc\/(contacts|claim_reminder)$/,
  /^\/api\/auth\//,
  /^\/api\/cron\//,
  /^\/(api|functions\/v1)\/push-dispatch$/,
];

/** Connecting, reconnecting or syncing a calendar moves `next_sync_at`. */
const CALENDAR_PATH = /^\/(api|functions\/v1)\/(google-(oauth|sync|webhook)|m365-(oauth|sync)|icloud-(connect|sync)|ics-(subscribe|sync)|calendar-refresh)$/;
/** OAuth callbacks write the account on a GET redirect. */
const OAUTH_CALLBACK = /^\/(api|functions\/v1)\/(google|m365)-oauth$/;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface PokeInput {
  method: string;
  path: string;
  status: number;
  /** The request opened a database client. A request that never did wrote nothing. */
  touchedDb: boolean;
  /** Planner account the request acted for, when known. */
  user: string | null;
}

export function gatePokeFor(r: PokeInput): GatePoke | null {
  if (!r.touchedDb) return null;
  // Refused before writing (auth, validation, not found). A 5xx may have half-written: poke.
  if (r.status >= 400 && r.status < 500) return null;
  const method = r.method.toUpperCase();
  const writeMethod = WRITE_METHODS.has(method);
  const callback = method === "GET" && OAUTH_CALLBACK.test(r.path);
  const calendar = (writeMethod && CALENDAR_PATH.test(r.path)) || callback;
  const write = (writeMethod && !READ_ONLY_POSTS.some((re) => re.test(r.path))) || callback;
  if (!write) return null;
  const poke: GatePoke = r.user ? { users: [r.user] } : { all: true };
  if (calendar) poke.calendar = true;
  return poke;
}
