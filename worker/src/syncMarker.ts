/**
 * The change marker — what lets a quiet feed poll skip Neon (D-245).
 *
 * D-238 made "what moved since my cursor?" one small answer, but every answer
 * still came from Postgres: a session lookup, the planner-user lookup, and the
 * `sync_changes` read. An open Mac asks once a minute, so Neon's compute never
 * reached its five idle minutes and never suspended while the app was open.
 *
 * Every write reaches Postgres through this Worker, so the Worker can know,
 * without asking Postgres, whether an account has been written since a feed
 * answer was computed. This Durable Object holds that:
 *
 *   clock      — a counter; every poke takes the next value
 *   pokedAt    — per account, the clock value of its last poke
 *   proof      — per account, "as of clock C, Neon said nothing of this
 *                account's moved above cursor F" (and the highest cursor it
 *                handed out, so a cursor this proof never saw is asked about)
 *   creds      — hash of a session credential → the account Neon verified it as
 *
 * A feed poll asks `/check` first. Known credential + a proof still standing +
 * a cursor inside it → the Worker answers "nothing moved" itself: no SQL, no
 * connection, no Hyperdrive. Anything else → a ticket (the clock as of now),
 * the normal Postgres answer, and, when that answer is empty, `/prove` with the
 * ticket. A poke that landed after the ticket was issued voids the proof — so a
 * write that commits while the feed query runs can never be proven away.
 *
 * Correctness rests on one rule: **every write to a synced table is followed by
 * a poke for its account (or for everyone) after it commits.** The writers, and
 * where each pokes, are listed in docs/product/decisions.md D-245 and checked in
 * syncMarker.check.ts. A writer outside the Worker (psql, a migration) is caught
 * by `PROOF_TTL_MS`: no proof outlives it, so the feed asks Neon again.
 *
 * Fail-open everywhere: no binding, a DO error or timeout, lost storage (a new
 * incarnation), an unknown credential — the feed asks Neon, exactly as before.
 *
 * **State is persisted, every key, before the object answers.** A Durable
 * Object is evicted after a few idle seconds, and a feed polls once a minute:
 * memory alone was empty at every poll (measured — the first build kept it in
 * memory and never once answered at the edge). Persisting proofs *and* pokes
 * together keeps the rule intact; persisting only proofs would let a lost poke
 * stand behind a kept proof. The one way a change can still be late is a poke
 * that never reaches the object at all (a DO outage); `PROOF_TTL_MS`, a poll
 * after this device's own write, and every app launch ask Neon regardless.
 *
 * Plain fetch-style class (no `cloudflare:workers` import), like CronGate, so
 * the Node check scripts can drive it.
 */
import { raceTimeout } from "./db.ts";
import type { Env } from "./env.ts";
import { persistWriteFreshness } from "./writeFreshness.ts";

/** No proof is trusted longer than this — the backstop for a writer that forgot to poke. */
export const PROOF_TTL_MS = 3 * 60 * 60_000;
/** A verified credential is trusted for the feed's "nothing moved" this long (or until its session expires). */
export const CRED_TTL_MS = PROOF_TTL_MS;
/** A ticket must come back within this; the feed's own client timeout is 20s. */
export const TICKET_TTL_MS = 60_000;
/** Memory bound. Past it the object forgets everything — safe, it only costs queries. */
export const MAX_ENTRIES = 50_000;
/** How long the Worker waits on the marker before treating it as absent. */
export const MARKER_TIMEOUT_MS = 2_000;

export interface Ticket {
  inc: string;
  epoch: number;
  clock: number;
  issued: number;
}

interface Proof {
  clock: number;
  at: number;
  floor: bigint;
  ceil: bigint;
}

interface UserMark {
  pokedAt: number;
  pokedAtMs: number;
  proof: Proof | null;
}

export interface MarkerPoke {
  /** Accounts that were (or may have been) written. */
  users?: string[];
  /** A write whose account is unknown — void every proof. */
  all?: boolean;
  /** Credential hashes to forget (a sign-out). */
  dropCreds?: string[];
}

export type CheckAnswer = { quiet: true; user: string } | { quiet: false; ticket: Ticket };

export interface ProveInput {
  cred: string;
  user: string;
  ticket: Ticket;
  /** The cursor the client asked with — Neon found nothing of this account's above it. */
  since: string;
  /** The cursor Neon handed back. */
  cursor: string;
  /** When the verified session expires (ms), if known. */
  sessionUntil?: number | null;
  /** True when Neon's answer was an empty, non-reset delta. Otherwise only the credential is learned. */
  quiet: boolean;
}

export function parseCursor(raw: unknown): bigint | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim();
  if (!/^\d{1,19}$/.test(text)) return null;
  return BigInt(text);
}

// ---------------------------------------------------------------------------
// The state machine (pure; the DO below is a thin shell over it)
// ---------------------------------------------------------------------------

export class MarkerState {
  readonly inc: string;
  clock = 0;
  epoch = 0;
  readonly users = new Map<string, UserMark>();
  readonly creds = new Map<string, { user: string; until: number }>();
  /** Storage keys changed since the last `takeDirty()`: `meta`, `u:<user>`, `c:<cred>`. */
  private readonly dirty = new Set<string>();

  constructor(inc: string = crypto.randomUUID()) {
    this.inc = inc;
    this.dirty.add("meta");
  }

  /** What to write: each changed key with its value, or null to delete it. */
  takeDirty(): Map<string, unknown | null> {
    const out = new Map<string, unknown | null>();
    for (const key of this.dirty) {
      if (key === "meta") out.set(key, { inc: this.inc, clock: this.clock, epoch: this.epoch });
      else if (key.startsWith("u:")) {
        const mark = this.users.get(key.slice(2));
        out.set(
          key,
          mark
            ? {
                inc: this.inc,
                pokedAt: mark.pokedAt,
                pokedAtMs: mark.pokedAtMs,
                proof: mark.proof
                  ? { ...mark.proof, floor: mark.proof.floor.toString(), ceil: mark.proof.ceil.toString() }
                  : null,
              }
            : null,
        );
      } else if (key.startsWith("c:")) {
        const cred = this.creds.get(key.slice(2));
        out.set(key, cred ? { ...cred, inc: this.inc } : null);
      }
    }
    this.dirty.clear();
    return out;
  }

  /**
   * Rebuild from storage. No `meta` (or an unreadable one) → a fresh
   * incarnation that trusts nothing. Every record carries the incarnation that
   * wrote it, and one from another is ignored: its clock values mean nothing
   * against this one's.
   */
  static restore(entries: Map<string, unknown>): MarkerState {
    const meta = entries.get("meta") as { inc?: unknown; clock?: unknown; epoch?: unknown } | undefined;
    if (!meta || typeof meta.inc !== "string" || typeof meta.clock !== "number" || typeof meta.epoch !== "number") {
      return new MarkerState();
    }
    const s = new MarkerState(meta.inc);
    s.dirty.clear();
    s.clock = meta.clock;
    s.epoch = meta.epoch;
    try {
      for (const [key, raw] of entries) {
        if ((raw as { inc?: unknown } | null)?.inc !== s.inc) continue;
        if (key.startsWith("u:")) {
          const m = raw as { pokedAt: number; pokedAtMs: number; proof: { clock: number; at: number; floor: string; ceil: string } | null };
          s.users.set(key.slice(2), {
            pokedAt: m.pokedAt,
            pokedAtMs: m.pokedAtMs,
            proof: m.proof ? { clock: m.proof.clock, at: m.proof.at, floor: BigInt(m.proof.floor), ceil: BigInt(m.proof.ceil) } : null,
          });
        } else if (key.startsWith("c:")) {
          const c = raw as { user: string; until: number };
          if (typeof c?.user === "string" && typeof c.until === "number") s.creds.set(key.slice(2), { user: c.user, until: c.until });
        }
      }
    } catch {
      // Unreadable entries: trust nothing. Every old key is overwritten or swept in time.
      return new MarkerState();
    }
    return s;
  }

  private ticket(nowMs: number): Ticket {
    return { inc: this.inc, epoch: this.epoch, clock: this.clock, issued: nowMs };
  }

  private standing(mark: UserMark | undefined, nowMs: number): Proof | null {
    const proof = mark?.proof;
    if (!mark || !proof) return null;
    if (mark.pokedAt > proof.clock) return null;
    if (nowMs - proof.at >= PROOF_TTL_MS) return null;
    return proof;
  }

  check(cred: string | null, cursorRaw: unknown, nowMs: number, fresh = false): CheckAnswer {
    const cursor = parseCursor(cursorRaw);
    if (!fresh && cred && cursor != null) {
      const known = this.creds.get(cred);
      if (known && known.until > nowMs) {
        const proof = this.standing(this.users.get(known.user), nowMs);
        if (proof && cursor >= proof.floor && cursor <= proof.ceil) return { quiet: true, user: known.user };
      }
    }
    return { quiet: false, ticket: this.ticket(nowMs) };
  }

  /** True when a proof was recorded. The credential is learned either way. */
  prove(input: ProveInput, nowMs: number): boolean {
    this.sweep(nowMs);
    if (!input.cred || !input.user) return false;
    const until = Math.min(
      nowMs + CRED_TTL_MS,
      typeof input.sessionUntil === "number" && Number.isFinite(input.sessionUntil) ? input.sessionUntil : Infinity,
    );
    if (until > nowMs) {
      this.creds.set(input.cred, { user: input.user, until });
      this.dirty.add(`c:${input.cred}`);
    }

    const t = input.ticket;
    if (!input.quiet || !t || t.inc !== this.inc || t.epoch !== this.epoch) return false;
    if (typeof t.issued !== "number" || nowMs - t.issued > TICKET_TTL_MS || t.clock > this.clock) return false;
    const since = parseCursor(input.since);
    const cursor = parseCursor(input.cursor);
    if (since == null || cursor == null || cursor < since) return false;
    const mark = this.users.get(input.user) ?? { pokedAt: 0, pokedAtMs: 0, proof: null };
    // A poke after the ticket: the answer may predate that write.
    if (mark.pokedAt > t.clock) return false;
    const prior = this.standing(mark, nowMs);
    mark.proof = prior
      ? {
          // Both hold at once (no poke since either ticket), so their union does.
          clock: Math.max(prior.clock, t.clock),
          at: nowMs,
          floor: since < prior.floor ? since : prior.floor,
          ceil: cursor > prior.ceil ? cursor : prior.ceil,
        }
      : { clock: t.clock, at: nowMs, floor: since, ceil: cursor };
    this.users.set(input.user, mark);
    this.dirty.add(`u:${input.user}`);
    return true;
  }

  poke(p: MarkerPoke, nowMs: number): void {
    this.clock += 1;
    this.dirty.add("meta");
    if (this.clock % 256 === 0) this.sweep(nowMs);
    if (p.all) {
      this.epoch += 1;
      for (const [user, mark] of this.users) {
        if (!mark.proof) continue;
        mark.proof = null;
        this.dirty.add(`u:${user}`);
      }
    }
    for (const user of p.users ?? []) {
      if (typeof user !== "string" || !user) continue;
      const mark = this.users.get(user) ?? { pokedAt: 0, pokedAtMs: 0, proof: null };
      mark.pokedAt = this.clock;
      mark.pokedAtMs = nowMs;
      mark.proof = null;
      this.users.set(user, mark);
      this.dirty.add(`u:${user}`);
    }
    for (const cred of p.dropCreds ?? []) {
      this.creds.delete(cred);
      this.dirty.add(`c:${cred}`);
    }
  }

  /** Forget what can no longer matter. Never forgets a poke a live ticket could still be judged against. */
  sweep(nowMs: number): void {
    const dropCred = (cred: string) => {
      this.creds.delete(cred);
      this.dirty.add(`c:${cred}`);
    };
    const dropUser = (user: string) => {
      this.users.delete(user);
      this.dirty.add(`u:${user}`);
    };
    for (const [cred, entry] of this.creds) if (entry.until <= nowMs) dropCred(cred);
    for (const [user, mark] of this.users) {
      const proofLive = mark.proof && nowMs - mark.proof.at < PROOF_TTL_MS;
      if (!proofLive && nowMs - mark.pokedAtMs > TICKET_TTL_MS) dropUser(user);
    }
    if (this.creds.size > MAX_ENTRIES) for (const cred of [...this.creds.keys()]) dropCred(cred);
    if (this.users.size > MAX_ENTRIES) {
      // Dropping every proof is safe; dropping a recent poke is not, so void
      // in-flight tickets too.
      for (const user of [...this.users.keys()]) dropUser(user);
      this.epoch += 1;
      this.dirty.add("meta");
    }
  }
}

// ---------------------------------------------------------------------------
// The Durable Object
// ---------------------------------------------------------------------------

interface MarkerStorage {
  list<T>(): Promise<Map<string, T>>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
}

interface MarkerDoState {
  storage: MarkerStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * One instance (`MARKER_NAME`). The runtime serializes its requests, and its
 * output gate holds each response until that request's writes are durable — so
 * a poke is stored before the writer hears back.
 */
export class SyncMarker {
  private state = new MarkerState();
  private readonly ready: Promise<void>;
  private readonly storage: MarkerStorage;

  constructor(ctx: MarkerDoState, _env?: unknown) {
    this.storage = ctx.storage;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      try {
        this.state = MarkerState.restore(await ctx.storage.list());
      } catch {
        this.state = new MarkerState();
      }
    });
  }

  private async flush(): Promise<void> {
    const changes = this.state.takeDirty();
    if (!changes.size) return;
    const puts: Record<string, unknown> = {};
    const deletes: string[] = [];
    for (const [key, value] of changes) {
      if (value == null) deletes.push(key);
      else puts[key] = value;
    }
    // The storage API caps a batch at 128 keys.
    const putKeys = Object.keys(puts);
    for (let i = 0; i < putKeys.length; i += 128) {
      await this.storage.put(Object.fromEntries(putKeys.slice(i, i + 128).map((k) => [k, puts[k]])));
    }
    for (let i = 0; i < deletes.length; i += 128) await this.storage.delete(deletes.slice(i, i + 128));
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const res = await this.handle(request);
    await this.flush();
    return res;
  }

  private async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const nowMs = typeof body.now === "number" ? body.now : Date.now();
    if (path === "/check") {
      const cred = typeof body.cred === "string" ? body.cred : null;
      return Response.json(this.state.check(cred, body.cursor, nowMs, body.fresh === true));
    }
    if (path === "/prove") {
      return Response.json({ proven: this.state.prove(body as unknown as ProveInput, nowMs) });
    }
    if (path === "/poke") {
      this.state.poke(body as MarkerPoke, nowMs);
      return Response.json({ ok: true });
    }
    if (path === "/state") {
      return Response.json({
        inc: this.state.inc,
        clock: this.state.clock,
        epoch: this.state.epoch,
        users: this.state.users.size,
        creds: this.state.creds.size,
      });
    }
    return new Response("not found", { status: 404 });
  }
}

// ---------------------------------------------------------------------------
// Client half — what the Worker calls
// ---------------------------------------------------------------------------

export const MARKER_NAME = "sync-marker";

async function call<T>(env: Env, path: string, body: unknown): Promise<T | null> {
  const ns = env.SYNC_MARKER;
  if (!ns) return null;
  const stub = ns.get(ns.idFromName(MARKER_NAME));
  const res = await raceTimeout(
    stub.fetch(`https://sync-marker${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    MARKER_TIMEOUT_MS,
    "sync-marker timeout",
  );
  if (!res.ok) throw new Error(`sync-marker ${path} ${res.status}`);
  return (await res.json()) as T;
}

/** `/check`, or null when there is no marker (or it failed) — ask Neon, as before. */
export async function markerCheck(
  env: Env,
  q: { cred: string | null; cursor: unknown; fresh?: boolean },
): Promise<CheckAnswer | null> {
  try {
    return await call<CheckAnswer>(env, "/check", q);
  } catch (err) {
    console.error("[sync-marker] check failed", err instanceof Error ? err.name : "error");
    return null;
  }
}

export async function markerProve(env: Env, input: ProveInput): Promise<void> {
  try {
    await call(env, "/prove", input);
  } catch (err) {
    console.error("[sync-marker] prove failed", err instanceof Error ? err.name : "error");
  }
}

/**
 * Never throws. Retried once: a poke that never lands leaves a proof standing
 * over a write until `PROOF_TTL_MS`, which is the one way this can be late.
 */
export async function markerPoke(env: Env, poke: MarkerPoke): Promise<void> {
  if (!poke.all && !poke.users?.length && !poke.dropCreds?.length) return;
  // Always stamp the write epoch, even when the Durable Object is unbound —
  // REST GETs in this colo must not be served from Hyperdrive's pre-write
  // cache (D-249). dropCreds-only pokes are sign-outs, not row writes.
  if (poke.all || poke.users?.length) await persistWriteFreshness(poke);
  if (!env.SYNC_MARKER) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await call(env, "/poke", poke);
      return;
    } catch (err) {
      if (attempt === 1) console.error("[sync-marker] poke failed", err instanceof Error ? err.name : "error");
    }
  }
}

// ---------------------------------------------------------------------------
// Credentials and which requests poke
// ---------------------------------------------------------------------------

const SESSION_COOKIES = new Set(["better-auth.session_token", "__Secure-better-auth.session_token"]);

/**
 * A stable key for the credential a request carries — exactly what Better Auth
 * reads (the bearer header and the session cookie), hashed so the marker never
 * holds a token. Null when the request carries none.
 */
export async function credentialKey(headers: Headers): Promise<string | null> {
  const authorization = headers.get("authorization")?.trim() ?? "";
  let cookie = "";
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (SESSION_COOKIES.has(part.slice(0, eq).trim())) cookie += `${part.trim()};`;
  }
  if (!authorization && !cookie) return null;
  const bytes = new TextEncoder().encode(`a:${authorization}\nc:${cookie}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Requests that only read: they open the database and write nothing a feed carries. */
const PURE_READS: { methods: Set<string>; path: RegExp }[] = [
  { methods: new Set(["GET", "HEAD"]), path: /^\/api\/rest\/v1\/[a-z_][a-z0-9_]*$/ },
  { methods: new Set(["GET", "POST"]), path: /^\/api\/rest\/v1\/rpc\/(sync_changes|contacts)$/ },
];

export interface FeedPokeInput {
  method: string;
  path: string;
  status: number;
  touchedDb: boolean;
  user: string | null;
}

/**
 * Which requests poke the marker — decided once, here. Leans much harder to
 * over-poking than the cron gate's rule (gatePoke.ts): an extra poke costs one
 * feed query on a minute Neon is already awake for; a missed one hides a change
 * until `PROOF_TTL_MS`. So every request that opened the database pokes its
 * account unless it is a known pure read — GETs included, because an `app.all`
 * route writes on any method. Auth routes write only Better Auth's own tables.
 */
export function feedPokeFor(r: FeedPokeInput): MarkerPoke | null {
  if (!r.touchedDb) return null;
  if (r.path.startsWith("/api/auth/")) return null;
  const method = r.method.toUpperCase();
  if (method === "OPTIONS") return null;
  if (PURE_READS.some((p) => p.methods.has(method) && p.path.test(r.path))) return null;
  if (r.user) return { users: [r.user] };
  // Refused with no account known (bad session, bad secret): nothing was written for anyone.
  if (r.status >= 400 && r.status < 500) return null;
  return { all: true };
}

/** Better Auth routes that end a session: forget the credential they carried. */
export function endsSession(method: string, path: string): boolean {
  return method.toUpperCase() === "POST" && /^\/api\/auth\/(sign-out|revoke-session|revoke-sessions|revoke-other-sessions|delete-user)$/.test(path);
}
