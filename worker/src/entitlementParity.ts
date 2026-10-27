/**
 * Cutover entitlement proof. Auth ids must copy 1:1 (Better Auth
 * `user.id` = `auth.users.id`). Then every `subscriptions` row, looked
 * up by that preserved id, must yield the same Worker entitlement as
 * the source row. Counts only — never emails, tokens, or row payloads.
 */
import { entitlementOf, type Entitlement, type SubscriptionColumns } from "./entitlement.ts";

export interface AuthParity {
  sourceUsers: number;
  targetUsers: number;
  identical: number;
  missingOnTarget: number;
  extraOnTarget: number;
  remaps: number;
}

export interface EntitlementParityReport extends AuthParity {
  ok: boolean;
  subscriptions: number;
  orphanSubscriptions: number;
  entitlementMatches: number;
  entitlementMismatches: number;
  problems: string[];
}

export function compareAuthIds(sourceIds: readonly string[], targetIds: readonly string[]): AuthParity {
  const source = new Set(sourceIds.filter(Boolean));
  const target = new Set(targetIds.filter(Boolean));
  let identical = 0;
  let missingOnTarget = 0;
  for (const id of source) {
    if (target.has(id)) identical += 1;
    else missingOnTarget += 1;
  }
  let extraOnTarget = 0;
  for (const id of target) {
    if (!source.has(id)) extraOnTarget += 1;
  }
  return {
    sourceUsers: source.size,
    targetUsers: target.size,
    identical,
    missingOnTarget,
    extraOnTarget,
    remaps: missingOnTarget + extraOnTarget,
  };
}

export function formatParityCounts(report: EntitlementParityReport): string {
  return [
    `auth users ${report.identical}/${report.sourceUsers} identical, remaps ${report.remaps}`,
    `subscriptions ${report.subscriptions}, entitlement mismatches ${report.entitlementMismatches}`,
    `orphans ${report.orphanSubscriptions}`,
  ].join("; ");
}

function sameEntitlement(before: Entitlement, after: Entitlement): boolean {
  return (
    before.entitled === after.entitled &&
    before.plan === after.plan &&
    before.present === after.present &&
    before.planSource === after.planSource
  );
}

export function compareEntitlementParity(args: {
  sourceUserIds: readonly string[];
  targetUserIds: readonly string[];
  subscriptions: readonly SubscriptionColumns[];
  now?: Date;
  /** Worker check keyed by preserved user id. Defaults to the source row with that id. */
  readAfter?: (userId: string) => Entitlement;
}): EntitlementParityReport {
  const now = args.now ?? new Date();
  const auth = compareAuthIds(args.sourceUserIds, args.targetUserIds);
  const byId = new Map<string, SubscriptionColumns>();
  for (const row of args.subscriptions) {
    if (row.user_id) byId.set(row.user_id, row);
  }
  const mapped = new Set(args.sourceUserIds.filter((id) => args.targetUserIds.includes(id)));
  const readAfter =
    args.readAfter ??
    ((userId: string) => entitlementOf(byId.get(userId) ?? null, userId, now));

  let orphanSubscriptions = 0;
  let entitlementMatches = 0;
  let entitlementMismatches = 0;
  for (const row of byId.values()) {
    if (!mapped.has(row.user_id)) {
      orphanSubscriptions += 1;
      continue;
    }
    const before = entitlementOf(row, row.user_id, now);
    const after = readAfter(row.user_id);
    if (sameEntitlement(before, after)) entitlementMatches += 1;
    else entitlementMismatches += 1;
  }

  const problems: string[] = [];
  if (auth.remaps > 0) problems.push("auth ids are not 1:1 (billing would orphan)");
  if (auth.sourceUsers !== auth.targetUsers) problems.push("auth user counts differ");
  if (orphanSubscriptions > 0) problems.push("subscription rows whose user id is missing on the target");
  if (entitlementMismatches > 0) problems.push("entitlement changed for a preserved user id");
  if (byId.size === 0 && auth.sourceUsers > 0) {
    problems.push("no subscription rows readable (empty or RLS hid them)");
  }

  return {
    ...auth,
    ok: problems.length === 0,
    subscriptions: byId.size,
    orphanSubscriptions,
    entitlementMatches,
    entitlementMismatches,
    problems,
  };
}
