import { useState } from "react";
import { supabase, supabaseConfigured } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fn =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { error } = await fn;
    if (error) setError(error.message);
    setBusy(false);
  };

  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="w-80 border border-line bg-surface p-6">
        <div className="mb-1 text-lg font-semibold">Nuvo</div>
        <div className="mb-5 text-[12px] text-muted">Your day, on one surface.</div>
        {!supabaseConfigured && (
          <div className="mb-4 border border-signal bg-signal-soft p-2 text-[12px] text-signal">
            Supabase is not configured. Copy <span className="mono">.env.example</span> to{" "}
            <span className="mono">.env</span> and restart.
          </div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <input
            type="password"
            required
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          {error && <div className="text-[12px] text-signal">{error}</div>}
          <button
            type="submit"
            disabled={busy}
            className="fast w-full border border-accent bg-accent py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button
          className="mt-3 text-[12px] text-muted hover:text-ink"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "First run? Create the account" : "Back to sign in"}
        </button>
      </div>
    </div>
  );
}
