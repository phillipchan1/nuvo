// @vitest-environment jsdom
/**
 * Signing in with Google must ask WHICH Google.
 *
 * Reported from TestFlight 0.1.558 on an iPhone: open Nuvo signed out, tap
 * Continue with Google, and you land instantly back in the last Google user's
 * account. No chooser appears, so a second Google (a throwaway account, a
 * personal one beside a work one) is unreachable from the phone at all — the
 * only moment where the choice could be made never happens.
 *
 * The cause is not in the app's code path but in what it omits from the
 * authorize request: with no `prompt`, Google re-uses the session already in
 * the cookie jar and redirects back without drawing anything. In the iOS shell
 * that jar belongs to the app's own WKWebView and outlives a Nuvo sign-out,
 * which is why the phone shows it far more sharply than a browser tab.
 *
 * So the guard is in two halves: our two entry points ask for the chooser, and
 * — because "we passed an option the SDK quietly drops" looks identical to the
 * bug — the parameter is proven to survive supabase-js and land in the real
 * authorize URL as Google's own `prompt`.
 */
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type OAuthCredentials = {
  provider: string;
  options?: { redirectTo?: string; queryParams?: Record<string, string> };
};

const auth = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  linkIdentity: vi.fn(),
}));

vi.mock("../src/lib/supabase", () => ({ supabase: { auth } }));

const { linkGoogleIdentity, signInWithGoogle } = await import("../src/lib/googleAuth");

const sent = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls[0][0] as OAuthCredentials;

beforeEach(() => {
  auth.signInWithOAuth.mockReset().mockResolvedValue({ data: null, error: null });
  auth.linkIdentity.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("Google auth asks which Google", () => {
  it("sends prompt=select_account when signing in", async () => {
    await signInWithGoogle();
    expect(sent(auth.signInWithOAuth)).toMatchObject({
      provider: "google",
      options: { queryParams: { prompt: "select_account" } },
    });
  });

  it("sends it when attaching Google to the signed-in user too", async () => {
    await linkGoogleIdentity();
    expect(sent(auth.linkIdentity)).toMatchObject({
      provider: "google",
      options: { queryParams: { prompt: "select_account" } },
    });
  });

  it("still returns the browser to this origin", async () => {
    await signInWithGoogle();
    expect(sent(auth.signInWithOAuth).options?.redirectTo).toBe(window.location.origin);
  });

  it("reaches Google: the param survives supabase-js's authorize URL", async () => {
    // The real client, asked not to navigate — `data.url` is the URL the shell
    // would have opened, built by the shipped SDK rather than by this test.
    const client = createClient("https://stub.supabase.co", "stub-anon-key");
    auth.signInWithOAuth.mockImplementation((c: OAuthCredentials) =>
      client.auth.signInWithOAuth({
        provider: "google",
        options: { ...c.options, skipBrowserRedirect: true },
      }),
    );

    const { data } = await signInWithGoogle();
    const authorize = new URL(data.url!);
    expect(authorize.searchParams.get("prompt")).toBe("select_account");
    expect(authorize.searchParams.get("provider")).toBe("google");
  });
});
