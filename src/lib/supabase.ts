import { createClient } from "@supabase/supabase-js";

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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: timedFetch ? { fetch: timedFetch } : {},
});

/** Invoke an edge function, fire-and-forget, logging failures to console. */
export function invokeQuiet(fn: string, body: Record<string, unknown>) {
  supabase.functions.invoke(fn, { body }).then(({ error }) => {
    if (error) console.warn(`[nuvo] edge fn ${fn} failed:`, error.message);
  });
}
