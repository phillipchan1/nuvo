import Login from "./Login";

/** Dev-only: `?login` — the login surface without a session, with the iOS /
 *  review email+password door forced on. Drive it at 375 and at iPad width. */
export default function LoginHarness() {
  return (
    <div className="atmosphere min-h-dvh">
      <Login forcePasswordLogin forceApple />
    </div>
  );
}
