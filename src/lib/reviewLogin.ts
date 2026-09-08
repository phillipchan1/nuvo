import { isTauriIOS } from "./platform";

/**
 * Whether the email + password form is on the login screen.
 *
 * App Review needs a demo account that signs in without waiting for an OTP
 * (Guideline 2.1). That form is a first-class door on native iOS — every
 * reviewer and every operator on the phone sees the same thing (P16). Review
 * mode (`?review` or `VITE_REVIEW_LOGIN=1`) is the listing-notes / screenshot
 * path so the same surface can be driven in a browser.
 *
 * The password is never baked in. Reviewers type the credentials from App
 * Store Connect → App Review Information. See docs/app-store-review.md.
 */
export function isReviewPasswordLogin(
  search = typeof window === "undefined" ? "" : window.location.search,
): boolean {
  if (isTauriIOS()) return true;
  if (import.meta.env.VITE_REVIEW_LOGIN === "1") return true;
  try {
    return new URLSearchParams(search).has("review");
  } catch {
    return false;
  }
}
