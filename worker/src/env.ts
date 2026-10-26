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
  /** 32-byte AES-256-GCM key (base64). PR A interface; mirrors open calendar tokens. */
  TOKEN_ENC_KEY_V1?: string;
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
