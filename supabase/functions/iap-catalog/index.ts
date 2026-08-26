// Product identifiers only — never prices. The iOS paywall asks StoreKit
// for the localized price of each id. Empty ids mean "not configured yet"
// and the client must stub, never fall back to Stripe.
import { handleOptions, json } from "../_shared/admin.ts";
import { readIapEnv } from "../_shared/apple.ts";
import { configuredIapProductIds } from "../_shared/planRules.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const ids = configuredIapProductIds(readIapEnv());
  return json({ monthly: ids.monthly, annual: ids.annual });
});
