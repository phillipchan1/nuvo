import { useState } from "react";
import { Icon } from "./Icon";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { signInWithGoogle } from "../lib/googleAuth";

/** True in an installed iOS/Android PWA. In iOS standalone mode a cross-origin
 *  OAuth redirect can strand the session in Safari (the standalone app and the
 *  browser keep separate storage), so an in-window sign-in path must exist. */
function isStandalone(): boolean {
  return (
    (navigator as { standalone?: boolean }).standalone === true ||
    (typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches)
  );
}

export default function Login() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The email-code fallback: never leaves this window, so the session always
  // lands in the standalone app. Offered up-front when installed; reachable
  // from the browser too (it's a link, not a mode).
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");

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

  const sendCode = async () => {
    const addr = email.trim();
    if (!addr) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: addr });
    setBusy(false);
    if (error) setError(error.message);
    else setCodeSent(true);
  };

  const verifyCode = async () => {
    const token = code.trim();
    if (!token) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" });
    setBusy(false);
    if (error) setError(error.message);
    // On success useAuth's onAuthStateChange takes over.
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

        {!emailMode ? (
          <>
            <button
              type="button"
              disabled={busy || !supabaseConfigured}
              onClick={withGoogle}
              className="tap fast flex w-full items-center justify-center gap-2.5 rounded-md border border-line bg-surface-2 px-3 py-3 text-body font-medium text-ink hover:bg-surface active:translate-y-px disabled:opacity-50"
            >
              <GoogleMark />
              {busy ? "Redirecting…" : "Continue with Google"}
            </button>
            {isStandalone() && (
              <button
                type="button"
                disabled={!supabaseConfigured}
                onClick={() => {
                  setEmailMode(true);
                  setError(null);
                }}
                className="tap fast mt-3 w-full text-center text-caption text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Sign in with an email code instead
              </button>
            )}
          </>
        ) : !codeSent ? (
          <>
            <label className="mb-1.5 block text-caption text-muted" htmlFor="login-email">
              Your email
            </label>
            <input
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              enterKeyHint="send"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void sendCode()}
              placeholder="you@example.com"
              className="field w-full"
            />
            <button
              type="button"
              disabled={busy || !email.trim()}
              onClick={() => void sendCode()}
              className="tap fast mt-3 w-full rounded-md border border-accent bg-accent px-3 py-3 text-body font-semibold text-on-accent active:translate-y-px disabled:border-line disabled:bg-surface-2 disabled:text-muted"
            >
              {busy ? "Sending…" : "Email me a code"}
            </button>
            <button
              type="button"
              onClick={() => setEmailMode(false)}
              className="tap fast mt-2 w-full text-center text-caption text-muted hover:text-ink"
            >
              ‹ Back
            </button>
          </>
        ) : (
          <>
            <div className="mb-2 text-caption leading-relaxed text-muted">
              We sent a 6-digit code to <span className="text-ink">{email.trim()}</span>. It signs
              you in right here — no need to leave the app.
            </div>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="done"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void verifyCode()}
              placeholder="123456"
              aria-label="Sign-in code"
              className="field mono w-full text-center tracking-[0.3em]"
            />
            <button
              type="button"
              disabled={busy || code.trim().length < 6}
              onClick={() => void verifyCode()}
              className="tap fast mt-3 w-full rounded-md border border-accent bg-accent px-3 py-3 text-body font-semibold text-on-accent active:translate-y-px disabled:border-line disabled:bg-surface-2 disabled:text-muted"
            >
              {busy ? "Checking…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCodeSent(false);
                setCode("");
              }}
              className="tap fast mt-2 w-full text-center text-caption text-muted hover:text-ink"
            >
              ‹ Different email
            </button>
          </>
        )}

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
      <Icon name="sun" size={18} />
    </span>
  );
}
