import { createClient } from "@supabase/supabase-js";
import { authLock } from "./authLock";
import { authBaseUrl, edgeFunctionUrl, workersEnabled } from "./backend";
import { WRITE_FROZEN_MESSAGE, writeFrozen } from "./maintenance";
import { isSpotlightWindow } from "./platform";
import { workerRoute } from "./workerRoute";
import { workerSession } from "./workerSession";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean((url && anonKey) || workersEnabled);

// Exported so callers that need to stream an edge function (the agent replies
// over SSE, which `functions.invoke` can't consume) can build the request URL
// and auth headers themselves.
export const supabaseUrl = url ?? "http://localhost:54321";
export const supabaseAnonKey = anonKey ?? "missing-anon-key";

/** Edge-function URL. Unchanged when `VITE_API_BASE_URL` is unset. */
export function functionUrl(name: string): string {
  return edgeFunctionUrl(supabaseUrl, name);
}

/**
 * Dev-only request timing.
 *
 * supabase-js captures `fetch` when the client is constructed, so patching
 * `window.fetch` afterwards never sees a single query — which is exactly how an
 * afternoon disappears trying to work out why the app takes seconds to catch up
 * with the server. Wrapping it here is the only place that observes the real
 * traffic. Records into `window.__nuvoTiming`; tree-shaken from production.
 */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL) && input.method) return input.method.toUpperCase();
  return "GET";
}

function isAuthUrl(url: string): boolean {
  return /\/auth\/v1\//i.test(url);
}

function isMutatingMethod(method: string): boolean {
  return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
}

/** PostgREST/Worker RPC reads travel as POST. Contacts must stay readable while frozen. */
function isRpcRead(url: string): boolean {
  return /\/(?:rest\/v1|api)\/rpc\/contacts(?:\?|$)/i.test(url);
}

const innerFetch: typeof fetch = import.meta.env.DEV
  ? async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const started = performance.now();
      const res = await fetch(input, init);
      const ms = performance.now() - started;
      const log = ((globalThis as Record<string, unknown>).__nuvoTiming ??= []) as unknown[];
      log.push({ url, ms: Math.round(ms), at: Math.round(started) });
      return res;
    }
  : fetch;

/**
 * The Worker path's one seam. The query builder, filters, upserts and
 * `.single()` stay supabase-js's own; only the wire changes — `/rest/v1/*` and
 * the edge functions go to the Worker (`workerRoute`), carrying the Better
 * Auth bearer instead of a GoTrue JWT. Never reached with the flag unset.
 */
async function toWorker(routed: string, input: RequestInfo | URL, init?: RequestInit): Promise<Request> {
  const req = new Request(routed, input instanceof Request ? input : init);
  const { signedBearerToken } = await import("./authClient");
  const token = signedBearerToken();
  if (token) req.headers.set("Authorization", `Bearer ${token}`);
  req.headers.delete("apikey");
  return req;
}

/** Freeze data writes on the live Supabase path. Auth refresh stays allowed. */
const guardedFetch: typeof fetch = async (input, init) => {
  const method = requestMethod(input, init);
  const url = requestUrl(input);
  if (isMutatingMethod(method) && !isAuthUrl(url) && !isRpcRead(url) && (await writeFrozen())) {
    return new Response(JSON.stringify({ error: "write_frozen", message: WRITE_FROZEN_MESSAGE }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (workersEnabled) {
    const routed = workerRoute(url, supabaseUrl, authBaseUrl());
    if (routed) return innerFetch(await toWorker(routed, input, init));
  }
  return innerFetch(input, init);
};

// Spotlight is a consumer of the session main writes, not a second refresher.
// Two heaps rotating one refresh token is `refresh_token_already_used`, and
// GoTrue revokes the family — that's the "booted to login" bug. The storage
// lock serializes any remaining refresh (getSession on an expired token still
// hits /token even with autoRefresh off).
const spotlight = isSpotlightWindow();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: guardedFetch },
  auth: {
    autoRefreshToken: !spotlight,
    detectSessionInUrl: !spotlight,
    lock: authLock,
  },
});

if (workersEnabled) {
  // GoTrue never holds a session on the Worker path — Better Auth does. Answer
  // the two questions every caller asks (`useAuth` publishes the answer), so the
  // outbox's owner key, push, the agent's bearer and the hooks need no fork.
  const auth = supabase.auth;
  auth.getSession = (async () => ({
    data: { session: await workerSession() },
    error: null,
  })) as typeof auth.getSession;
  auth.getUser = (async () => ({
    data: { user: (await workerSession())?.user ?? null },
    error: null,
  })) as unknown as typeof auth.getUser;
}

/** Invoke an edge function, fire-and-forget, logging failures to console. */
export function invokeQuiet(fn: string, body: Record<string, unknown>) {
  const report = (message: string) => {
    void import("./appError").then(({ reportAppError }) => {
      void reportAppError(new Error(message), { source: fn });
    });
    console.warn(`[nuvo] edge fn ${fn} failed:`, message);
  };
  // On the Worker path too: guardedFetch routes it, with the bearer.
  supabase.functions.invoke(fn, { body }).then(({ error }) => {
    if (!error) return;
    report(error.message);
  });
}

/**
 * Push a task's mirrored calendar block, carrying THIS device's zone.
 *
 * One helper rather than a bare `invokeQuiet` at each call site, because the
 * zone is the kind of argument every new call site forgets — and the last time
 * it was forgotten the edge function fell back to a hardcoded
 * `America/Los_Angeles`, stamping one operator's zone on every user's blocks
 * (Principle 16; see the device-zone-not-home-zone doctrine, D-082).
 *
 * Fire-and-forget by design: the mirror is a server-side echo of a block, not
 * user data. Offline it simply re-syncs after the drain, so there is nothing to
 * queue and nothing lost by skipping it.
 *
 * It waits for the task's own write to land. `task-mirror` reads the row from
 * Postgres, and every caller fires it right after queueing the edit — so it
 * used to mirror the block as it was *before* the drag (or 404 a task created
 * a moment earlier). A write the server refuses is never mirrored at all.
 */
export function mirrorTask(taskId: string) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  let tz = "UTC";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    /* keep UTC */
  }
  // Imported lazily: the sync layer's transport imports this module.
  void import("./sync")
    .then(({ whenRowDelivered }) => whenRowDelivered("tasks", taskId))
    .then((delivered) => {
      if (delivered) invokeQuiet("task-mirror", { taskId, tz });
    });
}
