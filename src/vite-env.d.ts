/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by Vite's `define` (see vite.config.ts) — the running app version.
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_IAP_ONLY?: string;
  readonly VITE_NUVO_IAP_MONTHLY?: string;
  readonly VITE_NUVO_IAP_ANNUAL?: string;
  /** "1" offers Sign in with Apple on the web/desktop redirect path. Native
   *  iOS ignores it — the plugin is always there. See src/lib/appleAuth.ts. */
  readonly VITE_APPLE_AUTH?: string;
  /** Receiving domain for the inbox address shown in Settings → Inbox address.
   *  Defaults to inbox.nuvo.day — must match the domain Resend receives on. */
  readonly VITE_INBOUND_MAIL_DOMAIN?: string;
}
