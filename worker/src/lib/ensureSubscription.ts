/**
 * Post-flip signup: write the default trial row to Supabase
 * `subscriptions` (option b). Idempotent — ON CONFLICT DO NOTHING.
 *
 * 409 / 23503 / any non-2xx is a FAILURE (the old 409-as-success path
 * hid the auth.users FK miss). Log status + pg code only — no user id,
 * email, or body. The caller sees the result and may retry.
 */
import {
  canInsertDefaultSubscription,
  defaultSubscriptionRow,
  subscriptionInsertHeaders,
  subscriptionInsertUrl,
} from "../../../supabase/functions/_shared/defaultSubscription.ts";
import type { Env } from "../env.ts";

type FetchFn = typeof fetch;
let testFetch: FetchFn | null = null;

export function installSubscriptionInsertFetchForTests(fn?: FetchFn): () => void {
  testFetch = fn ?? null;
  return () => {
    testFetch = null;
  };
}

function outboundFetch(): FetchFn {
  return testFetch ?? fetch;
}

export type EnsureSubscriptionResult =
  | { ok: true }
  | { ok: false; status?: number; code?: string; retry: true };

const ATTEMPTS = 3;

export function postgrestErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed.code === "string" && parsed.code.trim() ? parsed.code.trim() : undefined;
  } catch {
    return undefined;
  }
}

function logEnsureFailure(status: number, code: string | undefined, attempt: number): void {
  const pg = code ? ` code=${code}` : "";
  console.warn(`ensureDefaultSubscription failed status=${status}${pg} attempt=${attempt}`);
}

export async function ensureDefaultSubscription(
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">,
  userId: string,
): Promise<EnsureSubscriptionResult> {
  const base = env.SUPABASE_URL?.trim() ?? "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!canInsertDefaultSubscription(userId, base, key)) {
    return { ok: false, retry: true };
  }

  let last: { status?: number; code?: string } = {};
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await outboundFetch()(subscriptionInsertUrl(base), {
        method: "POST",
        headers: subscriptionInsertHeaders(key),
        body: JSON.stringify(defaultSubscriptionRow(userId)),
      });
      if (res.ok) return { ok: true };
      const code = postgrestErrorCode(await res.text().catch(() => ""));
      last = { status: res.status, code };
      logEnsureFailure(res.status, code, attempt);
    } catch {
      last = { status: 0 };
      logEnsureFailure(0, undefined, attempt);
    }
  }
  return { ok: false, status: last.status, code: last.code, retry: true };
}
