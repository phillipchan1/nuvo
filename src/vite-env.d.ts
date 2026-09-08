/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by Vite's `define` (see vite.config.ts) — the running app version.
declare const __APP_VERSION__: string;
/** True only when Vite is invoked by `tauri ios` (TAURI_ENV_PLATFORM=ios). */
declare const __TAURI_IOS__: boolean;

interface ImportMetaEnv {
  readonly VITE_IAP_ONLY?: string;
  /** "1" forces the email+password review form on this build (native iOS
   *  already shows it). Never a password. See docs/app-store-review.md. */
  readonly VITE_REVIEW_LOGIN?: string;
  readonly VITE_NUVO_IAP_MONTHLY?: string;
  readonly VITE_NUVO_IAP_ANNUAL?: string;
  /** "1" offers Sign in with Apple on the web/desktop redirect path. Native
   *  iOS ignores it — the plugin is always there. See src/lib/appleAuth.ts. */
  readonly VITE_APPLE_AUTH?: string;
  /** Receiving domain for the inbox address shown in Settings → Inbox address.
   *  Defaults to inbox.nuvo.day — must match the domain Resend receives on. */
  readonly VITE_INBOUND_MAIL_DOMAIN?: string;
}
