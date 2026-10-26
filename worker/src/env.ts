export interface HyperdriveBinding {
  connectionString: string;
}

export interface Env {
  ASSETS?: Fetcher;
  HYPERDRIVE?: HyperdriveBinding;
  DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  /** wrangler / `.dev.vars` only: `local` allows a localhost auth fallback. `preview` enables OTP log delivery. Never `local` on workers.dev. */
  ENVIRONMENT?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  /** Optional. `/api/cron/*` compares the bearer in constant time. Unset → 401. */
  CRON_SECRET?: string;
  /** Better Auth Apple provider (Services ID or bundle id) + client_secret JWT. */
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  APPLE_BUNDLE_ID?: string;
  APPLE_SIWA_CLIENT_ID?: string;
  APPLE_SIWA_TEAM_ID?: string;
  APPLE_SIWA_KEY_ID?: string;
  APPLE_SIWA_PRIVATE_KEY?: string;
  /** Read-only Supabase PostgREST for `subscriptions`. Never a Stripe secret. */
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** PR A seal key. Unset → Apple refresh token is not stored (fail closed). */
  TOKEN_ENC_KEY_V1?: string;
}

export function databaseUrl(env: Env): string | null {
  const fromHyperdrive = env.HYPERDRIVE?.connectionString?.trim() ?? "";
  if (fromHyperdrive && !fromHyperdrive.includes("00000000000000000000000000000000")) {
    return fromHyperdrive;
  }
  const fallback = env.DATABASE_URL?.trim() ?? "";
  return fallback || fromHyperdrive || null;
}
