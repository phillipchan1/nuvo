import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { clearPersistedCache } from "../lib/sync/persist";
import { writeWasEntitled } from "../lib/subscription";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      // Dev-only convenience: skip the login wall by auto-signing-in a test
      // account from .env.local (gitignored). `import.meta.env.DEV` is false in
      // any production build, so Vite tree-shakes this out — it can never run in
      // the shipped app. Set VITE_DEV_EMAIL / VITE_DEV_PASSWORD to enable.
      if (!data.session && import.meta.env.DEV) {
        const email = import.meta.env.VITE_DEV_EMAIL as string | undefined;
        const password = import.meta.env.VITE_DEV_PASSWORD as string | undefined;
        if (email && password) {
          const { data: signedIn, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) console.warn("[nuvo] dev auto-login failed:", error.message);
          setSession(signedIn?.session ?? null);
          setLoading(false);
          return;
        }
      }
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
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
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}
