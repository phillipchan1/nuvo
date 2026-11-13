import { useEffect, useState } from "react";
import { requestEmailOtp, signInWithPassword, verifyEmailOtp } from "../lib/authActions";
import { supabaseConfigured } from "../lib/supabase";
import { signInWithGoogle } from "../lib/googleAuth";
import { appleSignInAvailable, isAppleSignInCancelled, signInWithApple } from "../lib/appleAuth";
import { lastAuthProvider, providerLabel } from "../lib/authProviders";
import { isMobileTauri } from "../lib/platform";
import { isReviewPasswordLogin } from "../lib/reviewLogin";
import { isOAuthCanceled, useTapAction } from "../lib/tapAction";
import { authReturnError, clearAuthReturnError } from "../lib/authReturn";
import { Button, Input } from "./kit";
import { Icon } from "./Icon";
import { FlowMark } from "./rituals/FlowShell";

/** True in an installed iOS/Android PWA. In iOS standalone mode a cross-origin
 *  OAuth redirect can strand the session in Safari (the standalone app and the
 *  browser keep separate storage), so an in-window sign-in path must exist. */
function isStandalone(): boolean {
  return (
    (navigator as { standalone?: boolean }).standalone === true ||
    (typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches)
  );
}

type EmailGate = false | "password" | "otp" | "code";
type Busy = "apple" | "google" | "password" | "otp" | null;

export default function Login({
  forcePasswordLogin = false,
  forceApple = false,
}: {
  /** Tests and the `?login` harness. Production reads `isReviewPasswordLogin`. */
  forcePasswordLogin?: boolean;
  /** Harness only — Apple is otherwise gated by `appleSignInAvailable`. */
  forceApple?: boolean;
}) {
  // A Google / Apple round trip through the Worker's door that came back
  // with an error lands here, signed out — say why (flag on only).
  const [error, setError] = useState<string | null>(() => authReturnError());
  useEffect(() => clearAuthReturnError(), []);
  const [busy, setBusy] = useState<Busy>(null);
  const nativePhone = isMobileTauri();
  const passwordLogin = forcePasswordLogin || isReviewPasswordLogin();
  // Email-code fallback: never leaves this window. Offered up-front on PWA /
  // native when the password form is not the review door; otherwise secondary.
  const otpOffered = isStandalone() || nativePhone || passwordLogin;
  const [emailGate, setEmailGate] = useState<EmailGate>(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  // Apple is required wherever we offer Google (App Store guideline 4.8) and
  // must be at least as prominent, so it sits first — same size, same weight.
  const appleAvailable = forceApple || appleSignInAvailable();
  // What this device used last. Read once, before signing in overwrites it.
  // Supabase folds two identities onto one account only when they share a
  // verified email — and Apple's "Hide My Email" asserts a relay address that
  // matches nothing, so a different provider quietly opens a second, empty
  // account. Saying it out loud here is the only prevention that works.
  const [previous] = useState(lastAuthProvider);

  const oauthBusy = busy === "apple" || busy === "google";

  const withApple = async () => {
    if (busy !== null) return;
    setBusy("apple");
    setError(null);
    const { error } = await signInWithApple();
    if (error) {
      // Backing out of Apple's sheet is not a failure to report.
      if (!isAppleSignInCancelled(error.message) && !isOAuthCanceled(error)) {
        setError(error.message);
      }
      setBusy(null);
      return;
    }
    // Native returns here already signed in (useAuth's onAuthStateChange takes
    // over); the web path has redirected. Either way, leave busy true.
  };

  const withGoogle = async () => {
    if (busy !== null) return;
    setBusy("google");
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) {
      if (!isOAuthCanceled(error)) setError(error.message);
      setBusy(null);
    }
    // On success the browser redirects to Google — leave busy true.
  };

  const withPassword = async () => {
    const addr = email.trim();
    if (!addr || !password || busy === "password") return;
    setBusy("password");
    setError(null);
    const { error } = await signInWithPassword(addr, password);
    setBusy(null);
    if (error) setError(error.message);
    // On success useAuth's onAuthStateChange takes over.
  };

  const sendCode = async () => {
    const addr = email.trim();
    if (!addr || busy === "otp") return;
    setBusy("otp");
    setError(null);
    const { error } = await requestEmailOtp(addr);
    setBusy(null);
    if (error) setError(error.message);
    else setEmailGate("code");
  };

  const verifyCode = async () => {
    const token = code.trim();
    if (!token || busy === "otp") return;
    setBusy("otp");
    setError(null);
    const { error } = await verifyEmailOtp(email.trim(), token);
    setBusy(null);
    if (error) setError(error.message);
    // On success useAuth's onAuthStateChange takes over.
  };

  const openPassword = () => {
    setEmailGate("password");
    setError(null);
  };
  const openOtp = () => {
    setEmailGate("otp");
    setError(null);
  };
  const closeEmail = () => {
    setEmailGate(false);
    setCode("");
    setPassword("");
    setError(null);
  };

  // Email stays tappable while OAuth is opening — a hung Apple sheet used to
  // disable every control (ASC 2.1 on iPad: first tap looks dead).
  const appleTap = useTapAction(() => void withApple(), busy === null);
  const googleTap = useTapAction(() => void withGoogle(), busy === null);
  const passwordDoorTap = useTapAction(openPassword, busy !== "password");
  const otpDoorTap = useTapAction(openOtp, busy !== "otp");
  const passwordSubmitTap = useTapAction(() => void withPassword(), busy !== "password");
  const sendCodeTap = useTapAction(() => void sendCode(), busy !== "otp");
  const verifyCodeTap = useTapAction(() => void verifyCode(), busy !== "otp");
  const backTap = useTapAction(closeEmail);
  const otpInsteadTap = useTapAction(openOtp);
  const differentEmailTap = useTapAction(() => {
    setEmailGate(passwordLogin ? "password" : "otp");
    setCode("");
  });

  return (
    // The window ground, one 12px raised card (D-190): the mark, one hero, the
    // doors as kit Buttons. Apple first and the same size and weight as Google
    // (App Store 4.8); email is the quiet third door.
    <div className={`login-screen h-full min-h-dvh overflow-y-auto ${nativePhone ? "pt-safe pb-safe" : ""}`} style={{ background: "var(--ground)" }}>
      <div className="f-ground">
        <div className="f-card">
          <div className="grid gap-5">
            <div className="f-brand">
              <FlowMark />
              <span>Nuvo</span>
            </div>
            <h1 className="text-display masthead text-[var(--ink)]">
              {emailGate === "code" ? "Check your email." : emailGate ? "Sign in with email." : "Sign in to Nuvo."}
            </h1>
          </div>

          <div className="mt-6 grid gap-2">
            {!supabaseConfigured && (
              <div className="f-note" data-tone="danger">
                Supabase is not configured. Copy <span className="mono">.env.example</span> to <span className="mono">.env</span> and restart.
              </div>
            )}

            {!emailGate ? (
              <>
                {previous && (
                  <div className="f-note">
                    Last time on this device you used <b>{providerLabel(previous)}</b>. Use the same one to land back in the same account.
                  </div>
                )}
                {appleAvailable && (
                  <Button
                    size="md"
                    full
                    className="apple-signin login-action"
                    disabled={oauthBusy || !supabaseConfigured}
                    aria-busy={busy === "apple"}
                    {...appleTap}
                    icon={<AppleMark />}
                  >
                    {busy === "apple" ? "Opening…" : "Sign in with Apple"}
                  </Button>
                )}
                <Button
                  size="md"
                  full
                  className="login-action"
                  disabled={oauthBusy || !supabaseConfigured}
                  aria-busy={busy === "google"}
                  {...googleTap}
                  icon={<GoogleMark />}
                >
                  {busy === "google" ? "Opening…" : "Continue with Google"}
                </Button>
                {passwordLogin ? (
                  <Button kind="ghost" size="md" full disabled={!supabaseConfigured || busy === "password"} {...passwordDoorTap} className="login-action">
                    Sign in with email
                  </Button>
                ) : otpOffered ? (
                  <Button kind="ghost" size="md" full disabled={!supabaseConfigured} {...otpDoorTap} className="login-action">
                    Sign in with an email code instead
                  </Button>
                ) : null}
              </>
            ) : emailGate === "password" ? (
              <>
                <label className="k-field-label" htmlFor="login-email">
                  Email
                  <Input
                    id="login-email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    enterKeyHint="next"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={busy === "password"}
                  />
                </label>
                <label className="k-field-label mt-1" htmlFor="login-password">
                  Password
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    enterKeyHint="done"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void withPassword()}
                    placeholder="Password"
                    disabled={busy === "password"}
                  />
                </label>
                <Button
                  kind="primary"
                  size="md"
                  full
                  disabled={busy === "password" || !email.trim() || !password}
                  {...passwordSubmitTap}
                  shortcut="↵"
                  className="login-action mt-2"
                >
                  {busy === "password" ? "Signing in…" : "Sign in"}
                </Button>
                {otpOffered && (
                  <Button kind="ghost" size="md" full {...otpInsteadTap} className="login-action">
                    Email me a code instead
                  </Button>
                )}
                <Button kind="ghost" size="md" full {...backTap} icon={<Icon name="chevron-left" size={14} />} className="login-action">
                  Back
                </Button>
              </>
            ) : emailGate === "otp" ? (
              <>
                <label className="k-field-label" htmlFor="login-email">
                  Your email
                  <Input
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
                  />
                </label>
                <Button
                  kind="primary"
                  size="md"
                  full
                  disabled={busy === "otp" || !email.trim()}
                  {...sendCodeTap}
                  shortcut="↵"
                  className="login-action mt-2"
                >
                  {busy === "otp" ? "Sending…" : "Email me a code"}
                </Button>
                <Button kind="ghost" size="md" full {...backTap} icon={<Icon name="chevron-left" size={14} />} className="login-action">
                  Back
                </Button>
              </>
            ) : (
              <>
                <p className="f-fact">
                  A 6-digit code went to <b>{email.trim()}</b>. It signs you in right here.
                </p>
                <Input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  enterKeyHint="done"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void verifyCode()}
                  placeholder="123456"
                  aria-label="Sign-in code"
                  frameClassName="f-code"
                />
                <Button
                  kind="primary"
                  size="md"
                  full
                  disabled={busy === "otp" || code.trim().length < 6}
                  {...verifyCodeTap}
                  shortcut="↵"
                  className="login-action mt-2"
                >
                  {busy === "otp" ? "Checking…" : "Sign in"}
                </Button>
                <Button kind="ghost" size="md" full {...differentEmailTap} icon={<Icon name="chevron-left" size={14} />} className="login-action">
                  Different email
                </Button>
              </>
            )}

            {oauthBusy && (
              <div className="f-fact mt-1" role="status" aria-live="polite">
                Opening {busy === "apple" ? "Apple" : "Google"}…
              </div>
            )}

            {error && <div className="f-error mt-1">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Apple's logotype. Like GoogleMark below, this is a third party's mark, so
 *  it is the one place raw colour beats a token: it inherits `currentColor`
 *  from `.apple-signin` (index.css), which flips black-on-white / white-on-black with the
 *  theme (Apple permits exactly those fills, and requires one of them). */
function AppleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 814 1000" fill="currentColor" aria-hidden>
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 98.9zM554.1 159.4c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
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

