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
  BETTER_AUTH_URL?: string;
  /** wrangler / `.dev.vars` only: `local` allows a localhost auth fallback. `preview` enables OTP log delivery. Never `local` on workers.dev. */
  ENVIRONMENT?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  /** Optional. `/api/cron/*` compares the bearer in constant time. Unset → 401. */
  CRON_SECRET?: string;
  /** Direct OpenAI — no AI Gateway. Unset → agent/route-events LLM paths 503. */
  OPENAI_API_KEY?: string;
  /** Resend inbound-email Svix secret. Unset → inbound-email 500. */
  RESEND_WEBHOOK_SECRET?: string;
  /** Supabase origin for the billing read. Subscriptions stay there. */
  SUPABASE_URL?: string;
  /** Service-role key used only to SELECT subscriptions by session user_id. Never a Stripe secret. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** AES-256-GCM key (32-byte hex or base64). Required to seal/open tokens. */
  TOKEN_ENC_KEY_V1?: string;
  TOKEN_ENC_KEY_V2?: string;
  /** `1` (default) or `2`. Seal uses this version; open accepts any configured version. */
  TOKEN_ENC_CURRENT?: string;
  /** `1` / `true` freezes Worker writes. The app reads GET /api/maintenance. */
  MAINTENANCE_WRITE_FREEZE?: string;
  /** `1` / `true` arms the copy window. The app fail-closes the freeze while armed. */
  CUTOVER_ARMED?: string;
  /**
   * `1` / `true` / `yes` / `on` lets Worker crons run. Unset / unknown is
   * fail-closed: every cron (HTTP + Cron Trigger) returns 200 `{ skipped: true }`.
   * Freeze is not a substitute — freeze 503s writes only.
   */
  CUTOVER_FLIPPED?: string;
  /** Calendar-dispatch fan-out. Optional on preview; required for the cron scaffold. */
  CALENDAR_SYNC_QUEUE?: QueueBinding;
  /** Same VAPID pair as today's Supabase function — a new pair breaks every sub. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** Google token refresh when an access token has expired. Optional until PR B. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export function databaseUrl(env: Env): string | null {
  const fromHyperdrive = env.HYPERDRIVE?.connectionString?.trim() ?? "";
  if (fromHyperdrive && !fromHyperdrive.includes("00000000000000000000000000000000")) {
    return fromHyperdrive;
  }
  const fallback = env.DATABASE_URL?.trim() ?? "";
  return fallback || fromHyperdrive || null;
}
