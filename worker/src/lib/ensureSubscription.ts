/**
 * Post-flip signup: write the default trial row to Supabase
 * `subscriptions` (option b). Idempotent — ON CONFLICT DO NOTHING.
 * Must not throw; a miss is recovered by applyPlanUpdate's upsert.
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

export async function ensureDefaultSubscription(
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">,
  userId: string,
): Promise<boolean> {
  const base = env.SUPABASE_URL?.trim() ?? "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!canInsertDefaultSubscription(userId, base, key)) return false;
  try {
    const res = await outboundFetch()(subscriptionInsertUrl(base), {
      method: "POST",
      headers: subscriptionInsertHeaders(key),
      body: JSON.stringify(defaultSubscriptionRow(userId)),
    });
    return res.ok || res.status === 409;
  } catch {
    return false;
  }
}
