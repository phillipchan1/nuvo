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
import { supabase, supabaseAnonKey, supabaseUrl } from "../lib/supabase";

/** The app key for the watch's own row in `connections`. One per account. */
const WATCH_APP = "apple_watch";
/** Where the raw token lives between mint and push. It is shown once and never
 *  stored server-side (only sha256), so if this is lost the watch needs a new
 *  one — hence keeping it, rather than minting a fresh row on every launch. */
const TOKEN_KEY = "nuvo.watch.connectionToken";

function mintToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Must match `sha256Hex` in supabase/functions/capture/index.ts. */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The watch's durable credential.
 *
 * A Supabase access token lasts about an hour, and the phone can only refresh
 * it while the app is running — so a watch holding one is dead most of the time,
 * which is exactly when you want to capture something. The refresh token can't
 * cross either: rotation plus reuse detection would revoke the whole family and
 * sign the user out on their phone.
 *
 * So the watch gets a `connections` bearer token — the same mechanism Settings →
 * Apps & devices mints by hand, and the one `/capture` authenticates. It never
 * expires, is revocable from that screen, and can't collide with the session.
 *
 * Minted once and reused: the raw token is unrecoverable after creation (only
 * its hash is stored), so it is kept locally and a new row is created only when
 * there isn't one.
 */
async function watchConnectionToken(userId: string): Promise<string | null> {
  try {
    const held = localStorage.getItem(TOKEN_KEY);
    const { data: rows } = await supabase
      .from("connections")
      .select("id")
      .eq("app", WATCH_APP)
      .is("revoked_at", null)
      .limit(1);

    // A held token is only good if its row is still live — revoking on the
    // Settings screen has to actually take the watch offline.
    if (held && rows && rows.length > 0) return held;
    if (!held && rows && rows.length > 0) {
      // The row outlived the token (reinstall, cleared storage). It can never be
      // recovered, so retire it and mint again rather than pushing nothing.
      await supabase
        .from("connections")
        .update({ revoked_at: new Date().toISOString() })
        .eq("app", WATCH_APP)
        .is("revoked_at", null);
    }

    const token = mintToken();
    const { error } = await supabase.from("connections").insert({
      user_id: userId,
      app: WATCH_APP,
      name: "Apple Watch",
      scopes: ["inbox:write"],
      token_hash: await sha256Hex(token),
      last_four: token.slice(-4),
    });
    if (error) return null;
    localStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch {
    return null;
  }
}

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

        // Both travel: the connection token is durable and carries capture; the
        // access token is what reaches the agent and /day, and is refreshed here
        // every time the phone renews it.
        const connectionToken = await watchConnectionToken(userId);
        if (cancelled) return;

        await invoke("plugin:nuvo-watch|push_session", {
          payload: {
            url: supabaseUrl,
            anonKey: supabaseAnonKey,
            // Shipped in the payload so the watch needs no build-time env
            // injection — VITE_* is a Vite-time substitution Swift can't see.
            accessToken,
            connectionToken,
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
