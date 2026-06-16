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
    <div className="atmosphere flex h-full items-center justify-center">
      <div className="moment elev-3 w-80 rounded-lg border border-line bg-surface p-7">
        <div className="mb-5 flex items-center gap-2.5">
          <TwilightMark />
          <span className="wordmark wordmark-grad text-display leading-none">Nuvo</span>
        </div>
        <div className="mb-6 text-caption leading-relaxed text-muted">Your day, on one surface.</div>
        {!supabaseConfigured && (
          <div className="mb-4 rounded-md border border-signal bg-signal-soft p-2 text-caption text-signal">
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
            className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-body outline-none focus:border-accent"
          />
          <input
            type="password"
            required
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-body outline-none focus:border-accent"
          />
          {error && <div className="text-caption text-signal">{error}</div>}
          <button
            type="submit"
            disabled={busy}
            className="fast w-full rounded-md border border-accent bg-accent py-2 text-body font-medium text-white shadow-sm hover:brightness-110 hover:shadow-[0_8px_20px_-6px_var(--accent-glow)] active:translate-y-px disabled:opacity-50"
          >
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button
          className="fast mt-4 text-caption text-muted hover:text-ink"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "First run? Create the account" : "Back to sign in"}
        </button>
      </div>
    </div>
  );
}

/** The mark: a sun cresting the horizon — the arc of the day, Nuvo's metaphor. */
function TwilightMark() {
  return (
    <span
      className="flex h-8 w-8 items-center justify-center rounded-lg"
      style={{ background: "linear-gradient(140deg, var(--accent), var(--accent-2) 70%, var(--signal))" }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
        <circle cx="9" cy="10" r="3.4" stroke="#fff" strokeWidth="1.5" />
        <path d="M2.5 13.5h13" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M9 3.2v1.6M14 5l-1.1 1.1M4 5l1.1 1.1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
