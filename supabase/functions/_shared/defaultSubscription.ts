/**
 * Default `subscriptions` row — the 14-day trial `handle_new_user` grants
 * on GoTrue signup. After the flip, Better Auth `user.create.after` writes
 * the same row to Supabase (option b) with ON CONFLICT DO NOTHING.
 *
 * `applyPlanUpdate` upserts this row when a purchase/webhook has a user id
 * but no existing entitlement (fresh signup, or the hook missed).
 */
import { UUID_RE } from "./actingUser.ts";

export const TRIAL_DAYS = 14;

export type DefaultSubscriptionRow = {
  user_id: string;
  status: "trialing";
  trial_ends_at: string;
};

export function defaultSubscriptionRow(
  userId: string,
  now: Date = new Date(),
): DefaultSubscriptionRow {
  return {
    user_id: userId,
    status: "trialing",
    trial_ends_at: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function subscriptionInsertUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/subscriptions?on_conflict=user_id`;
}

export function subscriptionInsertHeaders(serviceRole: string): Record<string, string> {
  return {
    Authorization: `Bearer ${serviceRole}`,
    apikey: serviceRole,
    "Content-Type": "application/json",
    Prefer: "resolution=ignore-duplicates,return=minimal",
  };
}

export function canInsertDefaultSubscription(userId: string, supabaseUrl: string, serviceRole: string): boolean {
  return Boolean(UUID_RE.test(userId) && supabaseUrl.trim() && serviceRole.trim());
}
