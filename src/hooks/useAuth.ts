import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { clearPersistedCache } from "../lib/sync/persist";
import { writeWasEntitled } from "../lib/subscription";
import { isSpotlightWindow, isTauri } from "../lib/platform";
import {
  AUTH_REQUEST_EVENT,
  AUTH_SESSION_EVENT,
  broadcastAuthSession,
  payloadToSession,
  initialAuthState,
  persistSessionIfAbsent,
  readPersistedSession,
  requestAuthSession,
  type AuthSessionPayload,
} from "../lib/authSync";

/** How long the ⌥Space panel will wait for main to hand over a session
 *  before it honestly says "Not signed in". Main is usually already up. */
const SPOTLIGHT_AUTH_WAIT_MS = 1_200;

export function useAuth() {
  const [boot] = useState(initialAuthState);
  const [session, setSession] = useState<Session | null>(boot.session);
  const [loading, setLoading] = useState(boot.loading);

  useEffect(() => {
    const spotlight = isSpotlightWindow();
    let cancelled = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const retryTimers: Array<ReturnType<typeof setTimeout>> = [];
    const unlistens: Array<() => void> = [];

    const apply = (next: Session | null) => {
      if (cancelled) return;
      setSession(next);
    };

    const hydrateFromStorage = async (): Promise<Session | null> => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        apply(data.session);
        return data.session;
      }
      // Hidden WKWebViews sometimes report empty storage on first paint and
      // then have the token a tick later — read the slot ourselves before
      // giving up. Never rotate from here.
      const persisted = readPersistedSession();
      if (persisted) apply(persisted);
      return persisted;
    };

    const adoptPayload = (payload: AuthSessionPayload) => {
      const next = payloadToSession(payload);
      if (next) persistSessionIfAbsent(next);
      apply(next);
      // Hydrate GoTrue from the slot we just filled so captures carry a JWT.
      // No-op when storage already had a valid session (getSession reads it).
      if (next) void supabase.auth.getSession();
    };

    const pingMain = () => {
      void requestAuthSession();
      // Main's listener may not be up on the first tick of a cold launch.
      for (const ms of [250, 800]) {
        retryTimers.push(setTimeout(() => {
          if (!cancelled) void requestAuthSession();
        }, ms));
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // INITIAL_SESSION with null is "this heap hasn't recovered yet", not
      // "the account is signed out". The panel used to take that as gospel
      // and paint the signed-out card over a logged-in main window.
      if (spotlight && event === "INITIAL_SESSION" && !s) return;
      apply(s);
      if (!spotlight) void broadcastAuthSession(s);
      // Nuvo is multi-tenant and the offline read cache is written to disk, so
      // a sign-out has to take it with it. Otherwise the next account to sign in
      // on this device rehydrates the previous one's tasks, projects and
      // domains before its own first fetch lands — a cross-account leak that
      // looks exactly like a rendering bug.
      if (event === "SIGNED_OUT") {
        void clearPersistedCache();
        writeWasEntitled(false);
      }
    });

    // BroadcastChannel does not cross Tauri WKWebViews. localStorage *writes*
    // are shared; the `storage` event often is not. Keep the listener anyway
    // — when it does fire, it's a free hydrate — and don't treat it as the
    // path the panel actually relies on.
    const onStorage = (e: StorageEvent) => {
      if (!e.key?.includes("-auth-token")) return;
      void hydrateFromStorage();
    };
    window.addEventListener("storage", onStorage);

    void (async () => {
      // Listeners first, then hydrate. A ping that lands before either side
      // is listening is how a logged-in summon still showed "Not signed in".
      if (isTauri()) {
        try {
          const { listen } = await import("@tauri-apps/api/event");
          if (cancelled) return;
          if (spotlight) {
            const onSession = await listen<AuthSessionPayload>(AUTH_SESSION_EVENT, (e) => {
              adoptPayload(e.payload);
              if (!cancelled) setLoading(false);
            });
            const onShow = await listen("spotlight-show", () => {
              void hydrateFromStorage();
              void requestAuthSession();
            });
            if (cancelled) {
              onSession();
              onShow();
              return;
            }
            unlistens.push(onSession, onShow);
          } else {
            const onRequest = await listen(AUTH_REQUEST_EVENT, async () => {
              const { data } = await supabase.auth.getSession();
              await broadcastAuthSession(data.session);
            });
            if (cancelled) {
              onRequest();
              return;
            }
            unlistens.push(onRequest);
          }
        } catch {
          /* web / tests */
        }
      }
      if (cancelled) return;

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      // Dev-only convenience: skip the login wall by auto-signing-in a test
      // account from .env.local (gitignored). `import.meta.env.DEV` is false in
      // any production build, so Vite tree-shakes this out — it can never run in
      // the shipped app. Set VITE_DEV_EMAIL / VITE_DEV_PASSWORD to enable.
      // Spotlight never signs in on its own — two heaps rotating one refresh
      // token is `refresh_token_already_used`.
      if (!data.session && !spotlight && import.meta.env.DEV) {
        const email = import.meta.env.VITE_DEV_EMAIL as string | undefined;
        const password = import.meta.env.VITE_DEV_PASSWORD as string | undefined;
        if (email && password) {
          const { data: signedIn, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) console.warn("[nuvo] dev auto-login failed:", error.message);
          apply(signedIn?.session ?? null);
          if (!cancelled) setLoading(false);
          return;
        }
      }

      apply(data.session);
      if (!spotlight) {
        void broadcastAuthSession(data.session);
        if (!cancelled) setLoading(false);
        return;
      }

      // Panel: if storage already had it, we're done. If not, ask main and
      // hold the loader so a logged-in summon doesn't flash "Not signed in".
      if (data.session) {
        if (!cancelled) setLoading(false);
        return;
      }
      pingMain();
      settleTimer = setTimeout(() => {
        if (!cancelled) setLoading(false);
      }, SPOTLIGHT_AUTH_WAIT_MS);
    })();

    return () => {
      cancelled = true;
      if (settleTimer) clearTimeout(settleTimer);
      retryTimers.forEach(clearTimeout);
      sub.subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
      unlistens.forEach((u) => u());
    };
  }, []);

  return { session, loading };
}
