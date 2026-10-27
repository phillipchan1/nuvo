export interface HyperdriveBinding {
  connectionString: string;
}

export interface QueueBinding<T = unknown> {
  send(message: T): Promise<void>;
}

export interface Env {
  ASSETS?: Fetcher;
  HYPERDRIVE?: HyperdriveBinding;
  DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  /**
   * Optional BA keyring: `2:<current>,1:<previous>`. First entry is the
   * write version. `BETTER_AUTH_SECRET` stays the legacy bare-hex key.
   */
  BETTER_AUTH_SECRETS?: string;
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
  /** Direct OpenAI — no AI Gateway. Unset → agent/route-events LLM paths 503; github theme falls back to null. */
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  /** Resend inbound-email Svix secret. Unset → inbound-email 500. */
  RESEND_WEBHOOK_SECRET?: string;
  /** Supabase origin for the billing read and the billing-function proxy. Subscriptions stay there. */
  SUPABASE_URL?: string;
  /**
   * Service-role key. Used to SELECT subscriptions by session user_id and
   * to call apple-iap / stripe-checkout / stripe-portal / referral-code
   * server-to-server with `X-Nuvo-Acting-User`. Never a Stripe secret.
   */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** AES-256-GCM key (32-byte hex or base64). Required to seal/open tokens. Unset → fail closed. */
  TOKEN_ENC_KEY_V1?: string;
  TOKEN_ENC_KEY_V2?: string;
  /** `1` (default) or `2`. Seal uses this version; open accepts any configured version. */
  TOKEN_ENC_CURRENT?: string;
  /** Any non-empty value other than 0/false/no/off freezes Worker writes. Unset/empty is off. */
  MAINTENANCE_WRITE_FREEZE?: string;
  /** Same fail-closed parse as the write freeze. Arms the copy window. */
  CUTOVER_ARMED?: string;
  /**
   * Allowlist only: `1` / `true` / `yes` / `on` (trimmed, case-insensitive).
   * Unset, empty, and anything else is not flipped — Worker crons and
   * CRON_SECRET github-activity `action: "sync"` skip with 200.
   */
  CUTOVER_FLIPPED?: string;
  /** Optional semver. Clients below this show the update prompt and refuse writes. */
  MIN_CLIENT_VERSION?: string;
  /** Calendar-dispatch fan-out. Optional on preview; required for the cron scaffold. */
  CALENDAR_SYNC_QUEUE?: QueueBinding;
  /** Same VAPID pair as today's Supabase function — a new pair breaks every sub. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  /** SPA origin for OAuth redirects after consent. */
  APP_URL?: string;
}

export function databaseUrl(env: Env): string | null {
  const fromHyperdrive = env.HYPERDRIVE?.connectionString?.trim() ?? "";
  if (fromHyperdrive && !fromHyperdrive.includes("00000000000000000000000000000000")) {
    return fromHyperdrive;
  }
  const fallback = env.DATABASE_URL?.trim() ?? "";
  return fallback || fromHyperdrive || null;
}
