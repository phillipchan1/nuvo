/** Where Supabase sends the browser back after an OAuth provider — this
 *  origin, always. Shared by every provider (Google, Apple), because the trap
 *  below is per-project, not per-provider.
 *
 *  It MUST be in the project's redirect allow-list (Supabase → Authentication →
 *  URL Configuration). An unlisted value is not an error: Supabase silently
 *  falls back to the project's **Site URL**. In the Tauri shell that fallback is
 *  catastrophically quiet — the desktop webview lands on the hosted web app and
 *  signs in *there*, so the session is stored under `https://app.nuvo.day` while
 *  the bundled app (and the ⌥Space spotlight window, which loads the same
 *  `tauri://localhost` origin as main) stays signed out forever. The panel came
 *  up blank and nothing anywhere said why. Keep `tauri://localhost` allow-listed.
 *
 *  Non-special schemes can serialize `location.origin` as the string "null", so
 *  rebuild it from protocol + host rather than trusting `origin` in the shell. */
export function authReturnUrl(): string {
  const { origin, protocol, host } = window.location;
  return origin && origin !== "null" ? origin : `${protocol}//${host}`;
}
