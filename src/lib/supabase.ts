import { createClient } from "@supabase/supabase-js";
import { authLock } from "./authLock";
import { isSpotlightWindow } from "./platform";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

// Exported so callers that need to stream an edge function (the agent replies
// over SSE, which `functions.invoke` can't consume) can build the request URL
// and auth headers themselves.
export const supabaseUrl = url ?? "http://localhost:54321";
export const supabaseAnonKey = anonKey ?? "missing-anon-key";

/**
 * Dev-only request timing.
 *
 * supabase-js captures `fetch` when the client is constructed, so patching
 * `window.fetch` afterwards never sees a single query — which is exactly how an
 * afternoon disappears trying to work out why the app takes seconds to catch up
 * with the server. Wrapping it here is the only place that observes the real
 * traffic. Records into `window.__nuvoTiming`; tree-shaken from production.
 */
const timedFetch: typeof fetch | undefined = import.meta.env.DEV
  ? async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const started = performance.now();
      const res = await fetch(input, init);
      const ms = performance.now() - started;
      const log = ((globalThis as Record<string, unknown>).__nuvoTiming ??= []) as unknown[];
      log.push({ url, ms: Math.round(ms), at: Math.round(started) });
      return res;
    }
  : undefined;

// Spotlight is a consumer of the session main writes, not a second refresher.
// Two heaps rotating one refresh token is `refresh_token_already_used`, and
// GoTrue revokes the family — that's the "booted to login" bug. The storage
// lock serializes any remaining refresh (getSession on an expired token still
// hits /token even with autoRefresh off).
const spotlight = isSpotlightWindow();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: timedFetch ? { fetch: timedFetch } : {},
  auth: {
    autoRefreshToken: !spotlight,
    detectSessionInUrl: !spotlight,
    lock: authLock,
  },
});

/** Invoke an edge function, fire-and-forget, logging failures to console. */
export function invokeQuiet(fn: string, body: Record<string, unknown>) {
  supabase.functions.invoke(fn, { body }).then(({ error }) => {
    if (error) console.warn(`[nuvo] edge fn ${fn} failed:`, error.message);
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
 */
export function mirrorTask(taskId: string) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  let tz = "UTC";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    /* keep UTC */
  }
  invokeQuiet("task-mirror", { taskId, tz });
}
