/**
 * Auth copy contract: GoTrue identity → Better Auth `account`.
 *
 * The cutover job (`.github/workflows/cutover-migrate.yml`) and
 * `migration_tmp.auth_identities()` must stay in lock-step with this.
 * Apple's stable subject (`identity_data.sub`) becomes `account.accountId`;
 * the GoTrue `user_id` (preserved 1:1 as Better Auth `user.id`) becomes
 * `account.userId`. Better Auth's Apple provider looks users up by that pair.
 */

export type AuthIdentityRow = {
  user_id: string;
  provider: string;
  /** Already coalesced by the COPY (`sub` → `provider_id` column → fallback). */
  provider_id?: string | null;
  identity_data?: {
    sub?: string | null;
    provider_id?: string | null;
  } | null;
};

export type BetterAuthAccountMap = {
  accountId: string;
  providerId: string;
  userId: string;
};

/** Same CASE the copy hash and INSERT use. */
export function betterAuthProviderId(provider: string | null | undefined): string {
  const value = (provider ?? "").trim().toLowerCase();
  if (value === "email") return "credential";
  if (value === "google" || value === "apple") return value;
  return value || "credential";
}

/**
 * Apple (and Google) account id: `identity_data.sub` wins.
 * Matches `COALESCE(identity_data->>'sub', identity_data->>'provider_id', provider_id)`.
 */
export function identityAccountId(row: AuthIdentityRow): string {
  const fromData = row.identity_data?.sub || row.identity_data?.provider_id || "";
  const fromCol = row.provider_id || "";
  return (fromData || fromCol || "").trim();
}

/**
 * One GoTrue identity → one Better Auth `account` row.
 * Returns null when there is no user or no provider subject to attach.
 */
export function mapAuthIdentityToAccount(row: AuthIdentityRow): BetterAuthAccountMap | null {
  const userId = (row.user_id ?? "").trim();
  if (!userId) return null;
  const accountId = identityAccountId(row) || userId;
  if (!accountId) return null;
  return {
    accountId,
    providerId: betterAuthProviderId(row.provider),
    userId,
  };
}
