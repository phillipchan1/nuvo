import Stripe from "npm:stripe@18";
import { resolveReturnOriginFrom } from "./billingReturn.ts";
import { stripeStatusToPlan, type PlanState } from "./planRules.ts";

export const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2026-05-27.dahlia",
});

/** Where Stripe should send someone back to after checkout / the portal.
 *  One definition for both runtimes — see `billingReturn.ts`. */
export function resolveReturnOrigin(requested?: unknown): string {
  return resolveReturnOriginFrom(requested, Deno.env.get("APP_URL"));
}

export type OurStatus = PlanState;

// nuvo never sets `trial_period_days` on the Stripe subscription (trials are
// granted app-side, see handle_new_user), so Stripe's own "trialing" status
// should never occur for us — deliberately no case for it below.
export function stripeStatusToStatus(s: Stripe.Subscription.Status): OurStatus {
  return stripeStatusToPlan(s);
}
