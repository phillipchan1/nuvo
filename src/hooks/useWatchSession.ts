/**
 * Hand the wrist a credential.
 *
 * The Apple Watch app is native SwiftUI — watchOS has no web view, so it shares
 * nothing with this bundle, including the Supabase session. That session lives
 * in the iOS webview's localStorage, which Swift cannot read, so something has
 * to carry it across: the `nuvo-watch` Tauri plugin
 * (`src-tauri/plugins/nuvo-watch`) pushes it over WatchConnectivity.
 *
 * **iOS shell only.** `isTauriIOS()` is false in the browser, in the installed
 * PWA and in the macOS app, so this is a hard no-op everywhere else and the
 * Tauri import never even loads — same lazy-import shape MobileShell uses for
 * deep links, so the web bundle doesn't pull in a native module.
 *
 * **What crosses is not the refresh token.** Supabase rotates refresh tokens and
 * runs reuse detection: once the phone refreshes, a copy on the watch is
 * revoked, and presenting it later is treated as a compromised-token replay that
 * revokes the whole family — signing the user out *on their phone*. So the
 * durable credential is a `connections` bearer token (Settings → Apps &
 * devices), and until the watch mints one, a short-lived access token that it
 * never refreshes.
 */

import { useEffect } from "react";
import type { Session } from "@supabase/supabase-js";
import { isTauriIOS } from "../lib/platform";
import { supabaseAnonKey, supabaseUrl } from "../lib/supabase";

export interface WatchStatus {
  supported: boolean;
  paired: boolean;
  installed: boolean;
  reachable: boolean;
}

/** Push the current session to a paired watch, or clear it on sign-out. */
export function useWatchSession(session: Session | null): void {
  // Keyed on the token itself: `onAuthStateChange` fires TOKEN_REFRESHED with a
  // fresh object, so this runs once per real credential change and never on an
  // unrelated re-render.
  const accessToken = session?.access_token ?? null;
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!isTauriIOS()) return;
    let cancelled = false;

    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (cancelled) return;

        if (!accessToken || !userId) {
          // A tombstone, not silence — the OS persists the last context on both
          // devices, so a signed-out phone would otherwise leave a live
          // credential on the wrist. Nuvo is multi-tenant; that matters.
          await invoke("plugin:nuvo-watch|clear_session");
          return;
        }

        await invoke("plugin:nuvo-watch|push_session", {
          payload: {
            url: supabaseUrl,
            anonKey: supabaseAnonKey,
            // Shipped in the payload so the watch needs no build-time env
            // injection — VITE_* is a Vite-time substitution Swift can't see.
            accessToken,
            connectionToken: null,
            userId,
            issuedAt: Math.floor(Date.now() / 1000),
          },
        });
      } catch {
        // No watch, no plugin, or an older shell — the phone is unaffected and
        // this must never surface as an error the user has to think about.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, userId]);
}
