import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { workersEnabled } from "../lib/backend";
import { supabase } from "../lib/supabase";
import { clearPersistedCache } from "../lib/sync/persist";
import { writeWasEntitled } from "../lib/subscription";
import { isSpotlightWindow, isTauri } from "../lib/platform";
import { rememberAuthProvider } from "../lib/authProviders";
import {
  AUTH_REQUEST_EVENT,
  AUTH_SESSION_EVENT,
  authStorageKey,
  broadcastAuthSession,
  payloadToSession,
  persistSessionIfAbsent,
  readPersistedSession,
  requestAuthSession,
  type AuthSessionPayload,
} from "../lib/authSync";

/** How long the ⌥Space panel will wait for main to hand over a session
 *  before it honestly says "Not signed in". Main is usually already up. */
const SPOTLIGHT_AUTH_WAIT_MS = 1_200;

/**
 * Two reads of the same session. `getSession()` parses storage afresh, so a
 * re-read hands back a new object for the same login — and `session` sits at
 * the very top of the tree (`Shell`), where a new identity re-renders every
 * screen in the app. Only a different login (or a refreshed token, or an
 * updated user) is a change.
 */
function sameSession(a: Session | null, b: Session | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.access_token === b.access_token &&
    a.refresh_token === b.refresh_token &&
    a.expires_at === b.expires_at &&
    a.user?.id === b.user?.id &&
    a.user?.updated_at === b.user?.updated_at
  );
}

function sessionFromBetterAuth(user: { id: string; email?: string | null; updatedAt?: Date | string }, token: string, expiresAt: Date | string): Session {
  const exp = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  const updated = user.updatedAt
    ? (typeof user.updatedAt === "string" ? user.updatedAt : user.updatedAt.toISOString())
    : new Date().toISOString();
  return {
    access_token: token,
    refresh_token: "",
    expires_in: Math.max(0, Math.floor((exp.getTime() - Date.now()) / 1000)),
    expires_at: Math.floor(exp.getTime() / 1000),
    token_type: "bearer",
    user: {
      id: user.id,
      email: user.email ?? undefined,
      app_metadata: { provider: "email" },
      user_metadata: {},
      aud: "authenticated",
      created_at: updated,
      updated_at: updated,
    },
  } as Session;
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (workersEnabled) {
      let cancelled = false;
      void import("../lib/authClient").then(async ({ createNuvoAuthClient, persistSignedBearer, signedBearerToken }) => {
        if (cancelled) return;
        const client = createNuvoAuthClient();
        const applyBa = (data: {
          user?: { id: string; email?: string | null; updatedAt?: Date | string } | null;
          session?: { token: string; expiresAt: Date | string } | null;
          token?: string;
        } | null) => {
          if (cancelled) return;
          const fromBody = data?.session?.token ?? data?.token;
          // Never send the raw DB session.token — requireSignature rejects it
          // and a new tab with empty sessionStorage would 401 everywhere.
          const signed = typeof fromBody === "string" && fromBody.includes(".") ? fromBody : null;
          const token = signedBearerToken() ?? signed;
          if (token) persistSignedBearer(token);
          if (!data?.user || !token) {
            setSession((prev) => {
              if (prev) writeWasEntitled(false);
              return null;
            });
            return;
          }
          const expiresAt = data.session?.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          setSession((prev) => {
            const next = sessionFromBetterAuth(data.user!, token, expiresAt);
            return sameSession(prev, next) ? prev : next;
          });
        };
        const { data } = await client.getSession();
        applyBa(data);
        if (import.meta.env.DEV && !data?.session) {
          const email = import.meta.env.VITE_DEV_EMAIL as string | undefined;
          const password = import.meta.env.VITE_DEV_PASSWORD as string | undefined;
          if (email && password) {
            const signed = await client.signIn.email({ email, password });
            applyBa(signed.data ?? null);
          }
        }
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }

    const spotlight = isSpotlightWindow();
    let cancelled = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const retryTimers: Array<ReturnType<typeof setTimeout>> = [];
    const unlistens: Array<() => void> = [];

    const apply = (next: Session | null) => {
      if (cancelled) return;
      setSession((prev) => (sameSession(prev, next) ? prev : next));
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
      // Remember HOW this device signed in — every path lands here (Google's
      // redirect, Apple's native sheet, an email code), so this is the one
      // place that sees them all. The login screen says it back next time,
      // because picking a different provider than last time is what quietly
      // creates a second, empty account. See src/lib/authProviders.ts.
      if (s) rememberAuthProvider(s.user.app_metadata?.provider);
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
    //
    // The session's own key only. `authLock` takes `nuvo.auth.lock:…-auth-token`
    // around every `getSession()` — the outbox reads one per drain — and the old
    // `includes("-auth-token")` matched that too: each write made in one tab
    // re-hydrated, and re-rendered from the top, every other tab of the app.
    const sessionKey = authStorageKey();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== sessionKey) return;
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
