/**
 * The minute cron's gate — what lets Neon sleep (D-239).
 *
 * `* * * * *` runs calendar-dispatch and push-dispatch. Asking Postgres "is
 * anything due?" every minute is itself the thing that keeps Neon's compute
 * from ever suspending. So the answer lives here instead, in one Durable
 * Object, and the cron asks it first. A quiet minute is one DO call and no
 * SQL at all.
 *
 * What it holds:
 *   pushNext   — per account, the next instant push-dispatch must look at it
 *                (its earliest planned reminder, or the planning horizon)
 *   pushDirty  — accounts a write has touched since their last run
 *   pushAllAt  — when everyone is re-planned regardless (the safety cap)
 *   calNext    — earliest calendar `next_sync_at`, as of the last look
 *
 * Writers "poke" it: every write request through the Worker (catch-all
 * middleware in index.ts), calendar syncs, inbound mail and the daily crons.
 * A writer that is missed is caught by the cap: everyone is re-planned at
 * least every `FULL_RUN_CAP_MS`.
 *
 * Fail-open everywhere: no binding, a DO error, or an unreadable state means
 * the cron runs as it did before the gate — every minute.
 *
 * The DO is a plain fetch-style class (no `cloudflare:workers` import) so the
 * Node check scripts can import index.ts and this file's pure half.
 */
import type { Env } from "./env.ts";
import { REMINDER_WINDOW_MS } from "../../supabase/functions/_shared/reminderAnchors.ts";
import { REMINDER_MAX_LEAD_MINUTES } from "../../supabase/functions/_shared/reminderRules.ts";

/** Everyone is re-planned at least this often — the backstop for a writer that forgot to poke. */
export const FULL_RUN_CAP_MS = 60 * 60_000;

/**
 * push-dispatch loads anchors `REMINDER_WINDOW_MS` ahead and a lead reaches
 * back at most `REMINDER_MAX_LEAD_MINUTES`, so a run knows every fire up to
 * `window - maxLead` from now (one day). Past that it must look again.
 */
export const PUSH_HORIZON_MS = REMINDER_WINDOW_MS - REMINDER_MAX_LEAD_MINUTES * 60_000;

/**
 * A calendar account due within this window is polled on the same wake as
 * the one that is due now, so polls cluster instead of each account waking
 * Neon on its own offset. Smaller than the shortest claim lease (Google's
 * 10 min) so a just-claimed account is never claimed again by the next look.
 */
export const CAL_PULL_MS = 5 * 60_000;

/** What a planned run holds its accounts to until it reports: a lost report retries next minute. */
export const LEASE_MS = 60_000;

/**
 * The shared clock every background wake lands on (D-247): :00 and :30.
 * Neon suspends after five idle minutes, so what costs compute is not how
 * much the cron does but how many separate moments it does it at. Calendar
 * polls (google/owned.ts `nextSyncAt`) and the full run (`nextFullRunAt`) both
 * snap to it, so an idle hour wakes Neon twice instead of every few minutes.
 */
export const WAKE_GRID_MS = 30 * 60_000;

/**
 * When the next full run is due: the last grid point inside the cap, less the
 * pull window — the very minute the gate wakes for that grid point's calendar
 * polls — so the backstop shares their wake instead of adding its own.
 */
export function nextFullRunAt(nowMs: number): number {
  const at = Math.floor((nowMs + FULL_RUN_CAP_MS) / WAKE_GRID_MS) * WAKE_GRID_MS - CAL_PULL_MS;
  return at > nowMs + LEASE_MS ? at : at + WAKE_GRID_MS;
}

export interface GateState {
  v: 1;
  pushNext: Record<string, number>;
  pushDirty: string[];
  pushAllAt: number;
  calNext: number;
}

/** Fresh (or unreadable) state runs everything on the first tick. */
export function emptyGateState(): GateState {
  return { v: 1, pushNext: {}, pushDirty: [], pushAllAt: 0, calNext: 0 };
}

export interface TickPlan {
  /** `"all"` re-plans every account; a list re-plans only those; null skips push-dispatch. */
  push: "all" | string[] | null;
  /** Run calendar-dispatch this tick. */
  calendar: boolean;
  /** How far ahead calendar claims reach (clustering). */
  calendarPullMs: number;
}

export interface GatePoke {
  /** Accounts whose reminders may have changed. */
  users?: string[];
  /** A write whose account is unknown — re-plan everyone next tick. */
  all?: boolean;
  /** A calendar account was added, reconnected or synced — look at next_sync_at again. */
  calendar?: boolean;
}

export interface GateReport {
  push?: {
    scope: "all" | string[];
    /** Per account: next instant to look, or null when nothing can fire (no device / reminders off). */
    next: Record<string, number | null>;
  };
  /** Earliest `next_sync_at` (ms), or null when no account can be claimed. */
  calendar?: { next: number | null };
}

export function isQuiet(plan: TickPlan): boolean {
  return plan.push === null && !plan.calendar;
}

/** Decide one minute, and lease what it runs so a lost report retries rather than vanishes. */
export function planTick(state: GateState, nowMs: number): { plan: TickPlan; state: GateState } {
  const next: GateState = {
    ...state,
    pushNext: { ...state.pushNext },
    pushDirty: [],
  };
  let push: TickPlan["push"] = null;
  if (nowMs >= state.pushAllAt) {
    push = "all";
    next.pushAllAt = nowMs + LEASE_MS;
  } else {
    const users = new Set(state.pushDirty);
    for (const [user, at] of Object.entries(state.pushNext)) {
      if (at <= nowMs) users.add(user);
    }
    if (users.size) {
      push = [...users].sort();
      for (const user of push) next.pushNext[user] = nowMs + LEASE_MS;
    }
  }
  const calendar = nowMs >= state.calNext - CAL_PULL_MS;
  if (calendar) next.calNext = nowMs + LEASE_MS + CAL_PULL_MS;
  return { plan: { push, calendar, calendarPullMs: CAL_PULL_MS }, state: next };
}

export function applyPoke(state: GateState, poke: GatePoke): GateState {
  const next: GateState = { ...state, pushNext: { ...state.pushNext }, pushDirty: [...state.pushDirty] };
  if (poke.all) next.pushAllAt = 0;
  for (const user of poke.users ?? []) {
    if (typeof user === "string" && user && !next.pushDirty.includes(user)) next.pushDirty.push(user);
  }
  if (poke.calendar) next.calNext = 0;
  return next;
}

export function applyReport(state: GateState, report: GateReport, nowMs: number): GateState {
  const next: GateState = { ...state, pushNext: { ...state.pushNext }, pushDirty: [...state.pushDirty] };
  if (report.push) {
    const { scope, next: times } = report.push;
    if (scope === "all") {
      // Everyone the run did not return has nothing that can fire.
      next.pushNext = {};
      next.pushAllAt = nextFullRunAt(nowMs);
    } else {
      for (const user of scope) delete next.pushNext[user];
    }
    for (const [user, at] of Object.entries(times)) {
      if (typeof at === "number" && Number.isFinite(at)) next.pushNext[user] = at;
      else delete next.pushNext[user];
    }
  }
  if (report.calendar) {
    const at = report.calendar.next;
    // No claimable account: nothing to wake for until one is connected (a poke) or the cap.
    next.calNext = typeof at === "number" && Number.isFinite(at) ? at : nowMs + FULL_RUN_CAP_MS;
  }
  return next;
}

function parseState(raw: unknown): GateState {
  const s = raw as Partial<GateState> | null | undefined;
  if (!s || s.v !== 1 || typeof s.pushAllAt !== "number" || typeof s.calNext !== "number") return emptyGateState();
  return {
    v: 1,
    pushNext: s.pushNext && typeof s.pushNext === "object" ? { ...s.pushNext } : {},
    pushDirty: Array.isArray(s.pushDirty) ? s.pushDirty.filter((u) => typeof u === "string") : [],
    pushAllAt: s.pushAllAt,
    calNext: s.calNext,
  };
}

// ---------------------------------------------------------------------------
// The Durable Object
// ---------------------------------------------------------------------------

interface GateStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

interface GateDoState {
  storage: GateStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

const STATE_KEY = "state";

/** One instance (`GATE_NAME`). Requests are serialized by the runtime, so plan / poke / report never interleave. */
export class CronGate {
  private state: GateState = emptyGateState();
  private readonly ready: Promise<void>;
  private readonly ctx: GateDoState;

  constructor(ctx: GateDoState, _env?: unknown) {
    this.ctx = ctx;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.state = parseState(await ctx.storage.get(STATE_KEY));
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const path = new URL(request.url).pathname;
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const nowMs = typeof body.now === "number" ? body.now : Date.now();
    if (path === "/plan") {
      const out = planTick(this.state, nowMs);
      await this.save(out.state);
      return Response.json(out.plan);
    }
    if (path === "/poke") {
      await this.save(applyPoke(this.state, body as GatePoke));
      return Response.json({ ok: true });
    }
    if (path === "/report") {
      await this.save(applyReport(this.state, body as GateReport, nowMs));
      return Response.json({ ok: true });
    }
    if (path === "/state") return Response.json(this.state);
    return new Response("not found", { status: 404 });
  }

  private async save(next: GateState): Promise<void> {
    this.state = next;
    await this.ctx.storage.put(STATE_KEY, next);
  }
}

// ---------------------------------------------------------------------------
// Client half — what the Worker calls
// ---------------------------------------------------------------------------

export const GATE_NAME = "cron-gate";

function stub(env: Env) {
  const ns = env.CRON_GATE;
  if (!ns) return null;
  return ns.get(ns.idFromName(GATE_NAME));
}

async function call<T>(env: Env, path: string, body: unknown): Promise<T | null> {
  const s = stub(env);
  if (!s) return null;
  const res = await s.fetch(`https://cron-gate${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`cron-gate ${path} ${res.status}`);
  return (await res.json()) as T;
}

/** The minute's plan, or null when there is no gate (or it failed) — run everything, as before. */
export async function gatePlan(env: Env, nowMs: number): Promise<TickPlan | null> {
  try {
    return await call<TickPlan>(env, "/plan", { now: nowMs });
  } catch (err) {
    console.error("[cron-gate] plan failed; running ungated", err instanceof Error ? err.name : "error");
    return null;
  }
}

export async function gateReport(env: Env, report: GateReport, nowMs: number): Promise<void> {
  try {
    await call(env, "/report", { ...report, now: nowMs });
  } catch (err) {
    console.error("[cron-gate] report failed", err instanceof Error ? err.name : "error");
  }
}

/** Never throws, never blocks a response on failure: a lost poke is caught by the cap. */
export async function gatePoke(env: Env, poke: GatePoke): Promise<void> {
  if (!poke.all && !poke.calendar && !poke.users?.length) return;
  try {
    await call(env, "/poke", poke);
  } catch (err) {
    console.error("[cron-gate] poke failed", err instanceof Error ? err.name : "error");
  }
}

/** Test/inspection only. */
export async function gateState(env: Env): Promise<GateState | null> {
  const s = stub(env);
  if (!s) return null;
  const res = await s.fetch("https://cron-gate/state", { method: "GET" });
  return res.ok ? ((await res.json()) as GateState) : null;
}
