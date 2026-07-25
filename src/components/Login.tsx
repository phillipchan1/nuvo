import { useState } from "react";
import { supabaseConfigured } from "../lib/supabase";
import { signInWithGoogle } from "../lib/googleAuth";

export default function Login() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const withGoogle = async () => {
    setBusy(true);
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) {
      setError(error.message);
      setBusy(false);
    }
    // On success the browser redirects to Google — leave busy true.
  };

  return (
    <div className="atmosphere flex h-full items-center justify-center px-4">
      <div className="moment elev-3 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-7">
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

        <button
          type="button"
          disabled={busy || !supabaseConfigured}
          onClick={withGoogle}
          className="tap fast flex w-full items-center justify-center gap-2.5 rounded-md border border-line bg-surface-2 px-3 py-3 text-body font-medium text-ink hover:bg-surface active:translate-y-px disabled:opacity-50"
        >
          <GoogleMark />
          {busy ? "Redirecting…" : "Continue with Google"}
        </button>

        {error && <div className="mt-3 text-caption text-signal">{error}</div>}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
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
