// Billing proxy: Better Auth session → service-role acting-user → existing
// Supabase function. Never forwards a client-supplied id. Never logs secrets.
// Run: node --experimental-strip-types worker/src/billingProxy.check.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTING_EMAIL_HEADER,
  ACTING_USER_HEADER,
} from "../../supabase/functions/_shared/actingUser.ts";
import {
  BILLING_PROXY_FUNCTIONS,
  actingHeadersFor,
  billingEdgeUrl,
  isBillingProxyName,
} from "./billingProxy.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "billingProxy.ts"), "utf8");
const indexSrc = readFileSync(join(here, "index.ts"), "utf8");
const adminSrc = readFileSync(join(here, "../../supabase/functions/_shared/admin.ts"), "utf8");
const A = "11111111-1111-4111-8111-111111111111";

ok(BILLING_PROXY_FUNCTIONS.slice().sort().join(",") === "apple-iap,referral-code,stripe-checkout,stripe-portal", "proxy names are the four user-authenticated billing functions");
ok(!isBillingProxyName("apple-webhook") && !isBillingProxyName("stripe-webhook") && !isBillingProxyName("iap-catalog"), "webhooks and catalog are not proxied");
ok(isBillingProxyName("apple-iap") && isBillingProxyName("stripe-checkout"), "apple-iap and stripe-checkout are proxied");

ok(billingEdgeUrl("https://example.supabase.co/", "apple-iap") === "https://example.supabase.co/functions/v1/apple-iap", "edge URL is functions/v1/<name>");
ok(!/STRIPE_SECRET|sk_live|sk_test/.test(src), "billingProxy does not read a Stripe secret");
ok(!/console\.(log|info|debug|error|warn)\([^)]*(SERVICE_ROLE|SUPABASE_SERVICE|sk_)/.test(src), "billingProxy never logs secrets");
ok(/got\.user/.test(indexSrc) && /proxyBillingFunction\(c, name, got\.user\)/.test(indexSrc), "proxy owner is the verified session user");
ok(!/c\.req\.header\(["']x-nuvo-acting-user["']\)/.test(src), "proxy does not read the acting header from the client");
ok(!/body\.user_id|body\.actingUserId/.test(src), "proxy does not take user id from the body");

const headers = actingHeadersFor({ id: A, email: "a@example.test" });
ok(headers.get(ACTING_USER_HEADER) === A, "acting header is the session user id");
ok(headers.get(ACTING_EMAIL_HEADER) === "a@example.test", "acting email is the session email");

ok(adminSrc.includes("actingUserFromRequest"), "requireUser accepts the service-role acting-user header");
ok(adminSrc.includes("X-Nuvo-Acting-User") || adminSrc.includes("actingUserFromRequest"), "admin documents the acting-user path");
ok(!/getUserById/.test(src), "proxy does not look the user up in GoTrue");

ok(/handleBillingProxy/.test(indexSrc), "index mounts the billing proxy");
ok(/\/api\/\$\{name\}/.test(indexSrc) && /\/functions\/v1\/\$\{name\}/.test(indexSrc), "proxy is mounted on /api and /functions/v1");

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("billing proxy check: ok");
