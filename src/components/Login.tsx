import { useState } from "react";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { signInWithGoogle } from "../lib/googleAuth";
import { appleSignInAvailable, isAppleSignInCancelled, signInWithApple } from "../lib/appleAuth";
import { lastAuthProvider, providerLabel } from "../lib/authProviders";
import { isMobileTauri } from "../lib/platform";

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
  const nativePhone = isMobileTauri();
  // The email-code fallback: never leaves this window, so the session always
  // lands in the standalone app. Offered up-front when installed native or PWA.
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");

  // Apple is required wherever we offer Google (App Store guideline 4.8) and
  // must be at least as prominent, so it sits first — same size, same weight.
  const appleAvailable = appleSignInAvailable();
  // What this device used last. Read once, before signing in overwrites it.
  // Supabase folds two identities onto one account only when they share a
  // verified email — and Apple's "Hide My Email" asserts a relay address that
  // matches nothing, so a different provider quietly opens a second, empty
  // account. Saying it out loud here is the only prevention that works.
  const [previous] = useState(lastAuthProvider);

  const withApple = async () => {
    setBusy(true);
    setError(null);
    const { error } = await signInWithApple();
    if (error) {
      // Backing out of Apple's sheet is not a failure to report.
      if (!isAppleSignInCancelled(error.message)) setError(error.message);
      setBusy(false);
      return;
    }
    // Native returns here already signed in (useAuth's onAuthStateChange takes
    // over); the web path has redirected. Either way, leave busy true.
  };

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
    <div
      className={
        nativePhone
          ? "atmosphere flex min-h-dvh flex-col justify-center px-5 pt-safe pb-safe"
          : "atmosphere flex h-full items-center justify-center px-4"
      }
    >
      <div
        className={
          nativePhone
            ? "w-full max-w-md mx-auto"
            : "moment elev-3 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-7"
        }
      >
        <div className="mb-5 flex items-center gap-2.5">
          <AppMark />
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
            {previous && (
              <div className="mb-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-caption leading-relaxed text-muted">
                Last time on this device you used{" "}
                <span className="text-ink">{providerLabel(previous)}</span>. Use the same one to
                land back in the same account.
              </div>
            )}
            {appleAvailable && (
              <button
                type="button"
                disabled={busy || !supabaseConfigured}
                onClick={withApple}
                className="apple-signin tap fast mb-3 flex w-full items-center justify-center gap-2.5 rounded-md px-3 py-3 text-body font-medium active:translate-y-px disabled:opacity-50"
              >
                <AppleMark />
                Sign in with Apple
              </button>
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
            {isStandalone() || nativePhone ? (
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
            ) : null}
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

/** Apple's logotype. Like GoogleMark below, this is a third party's mark, so
 *  it is the one place raw colour beats a token: it inherits `currentColor`
 *  from `.apple-signin`, which flips black-on-white / white-on-black with the
 *  theme (Apple permits exactly those fills, and requires one of them). */
function AppleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 814 1000" fill="currentColor" aria-hidden>
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 98.9zM554.1 159.4c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
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

/** The mark: the app icon's Fraunces N on the twilight field. Same path as
 *  `src-tauri/app-icon.svg` — a derivation, not a sun. */
function AppMark() {
  return (
    <span
      className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg"
      style={{ background: "linear-gradient(140deg, var(--accent), var(--accent-2) 70%, var(--signal))" }}
      aria-hidden
    >
      <svg viewBox="0 0 1024 1024" width="32" height="32">
        <path
          fill="var(--on-accent)"
          d="M418.40 758.48Q418.40 770.57 410.40 777.59Q402.41 784.61 385.25 785L263.96 785Q246.80 784.61 238.61 777.59Q230.42 770.57 230.42 758.48Q230.42 738.20 253.04 728.45L261.62 724.55Q279.17 716.36 286.38 705.83Q293.60 695.30 293.60 672.68L293.60 381.74Q293.60 366.92 290.87 358.93Q288.14 350.93 278 337.67L247.97 297.50Q239.39 285.41 236.07 278.58Q232.76 271.76 232.76 264.35Q232.76 252.26 240.95 245.63Q249.14 239 262.40 239L393.83 239Q409.43 239 419.38 244.26Q429.32 249.53 439.46 263.96L691.79 618.47L668.39 687.50L668.39 351.32Q668.39 329.48 662.15 318.95Q655.91 308.42 636.41 299.45L628.22 295.55Q605.60 284.63 605.60 265.52Q605.60 253.04 613.79 246.02Q621.98 239 638.75 239L760.04 239Q777.20 239 785.39 246.02Q793.58 253.04 793.58 265.52Q793.58 285.41 770.96 295.55L762.38 299.45Q744.83 307.25 737.62 317.78Q730.40 328.31 730.40 351.32L730.40 641.48Q730.40 657.08 732.93 669.17Q735.47 681.26 742.49 691.01L766.67 724.16Q776.81 737.42 778.76 744.25Q780.71 751.07 780.71 758.48Q780.71 770.57 772.52 777.78Q764.33 785 750.68 785L598.58 785Q572.84 785 572.84 764.33Q572.84 757.31 569.91 750.49Q566.99 743.66 553.73 725.33L300.23 370.04L355.61 335.33L355.61 673.07Q355.61 694.13 362.04 704.66Q368.48 715.19 387.59 724.55L395.78 728.45Q418.40 738.59 418.40 758.48"
        />
      </svg>
    </span>
  );
}
