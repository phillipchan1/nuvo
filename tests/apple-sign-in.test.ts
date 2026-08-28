/**
 * Sign in with Apple — the parts that fail silently.
 *
 * App Store guideline 4.8 makes this non-optional (Nuvo offers Google, which
 * forfeits the "own account system only" exemption), and every one of its
 * failure modes is quiet: a nonce sent to the wrong end is an opaque token
 * rejection, a name overwritten with null is gone forever, an unregistered
 * plugin command is a startup permission error, and a missing entitlement is a
 * signing failure that only CI sees. So each of those is pinned here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPrivateRelayEmail as isRelayInSpa,
  providerLabel,
  providerRowLabel,
  readSignInMethods,
} from "../src/lib/authProviders.ts";
import {
  appleDisplayName,
  isPrivateRelayEmail,
  mergeAppleProfile,
  pkcs8FromPem,
  readAppleAuthConfig,
} from "../supabase/functions/_shared/appleIdentity.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Assertions about what the CODE does must not trip over prose that mentions
 *  it — this file's comments say "SHA-256" and "no async/await" on purpose. */
const codeOnly = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("///"))
    .join("\n");

describe("mergeAppleProfile — what Apple says only once", () => {
  it("keeps the first authorization's name and email when later ones are null", () => {
    const stored = {
      apple_user_id: "001234.abc",
      email: "ada@example.com",
      given_name: "Ada",
      family_name: "Lovelace",
      is_private_relay: false,
    };
    // Sign-in #2: Apple returns the subject and nothing else, forever.
    const merged = mergeAppleProfile(stored, { appleUserId: "001234.abc" });
    expect(merged.email).toBe("ada@example.com");
    expect(merged.given_name).toBe("Ada");
    expect(merged.family_name).toBe("Lovelace");
  });

  it("takes the first authorization's values when nothing is stored", () => {
    const merged = mergeAppleProfile(null, {
      appleUserId: "001234.abc",
      email: "ada@example.com",
      givenName: "Ada",
      familyName: "Lovelace",
    });
    expect(merged).toEqual({
      apple_user_id: "001234.abc",
      email: "ada@example.com",
      given_name: "Ada",
      family_name: "Lovelace",
      is_private_relay: false,
    });
  });

  it("treats blank strings as absent, not as an erasure", () => {
    const merged = mergeAppleProfile(
      { email: "ada@example.com", given_name: "Ada" },
      { email: "   ", givenName: "" },
    );
    expect(merged.email).toBe("ada@example.com");
    expect(merged.given_name).toBe("Ada");
  });

  it("flags Apple's mail relay", () => {
    expect(isPrivateRelayEmail("abc123@privaterelay.appleid.com")).toBe(true);
    expect(isPrivateRelayEmail("ADA@PrivateRelay.AppleID.com")).toBe(true);
    expect(isPrivateRelayEmail("ada@example.com")).toBe(false);
    expect(isPrivateRelayEmail(null)).toBe(false);
    expect(mergeAppleProfile(null, { email: "x@privaterelay.appleid.com" }).is_private_relay).toBe(true);
  });

  it("builds a display name only when there is one", () => {
    expect(appleDisplayName({ given_name: "Ada", family_name: "Lovelace" })).toBe("Ada Lovelace");
    expect(appleDisplayName({ given_name: "Ada", family_name: null })).toBe("Ada");
    expect(appleDisplayName({ given_name: null, family_name: null })).toBeNull();
  });
});

describe("readAppleAuthConfig", () => {
  const full = {
    APPLE_SIWA_TEAM_ID: "TEAM123",
    APPLE_SIWA_KEY_ID: "KEY123",
    APPLE_SIWA_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
  };

  it("falls back to the StoreKit bundle id — native codes are issued against it", () => {
    const config = readAppleAuthConfig({ ...full, APPLE_BUNDLE_ID: "day.nuvo.app" });
    expect(config?.clientId).toBe("day.nuvo.app");
  });

  it("prefers an explicit client id (the Services ID, for the web flow)", () => {
    const config = readAppleAuthConfig({
      ...full,
      APPLE_BUNDLE_ID: "day.nuvo.app",
      APPLE_SIWA_CLIENT_ID: "day.nuvo.app.web",
    });
    expect(config?.clientId).toBe("day.nuvo.app.web");
  });

  it("returns null rather than a half-config — callers treat that as 'cannot revoke'", () => {
    expect(readAppleAuthConfig({})).toBeNull();
    expect(readAppleAuthConfig({ ...full })).toBeNull(); // no client id at all
    expect(readAppleAuthConfig({ ...full, APPLE_BUNDLE_ID: "  " })).toBeNull();
  });
});

describe("pkcs8FromPem", () => {
  it("strips the armour and whitespace Apple's .p8 arrives with", () => {
    const der = pkcs8FromPem("-----BEGIN PRIVATE KEY-----\nQUJD\n-----END PRIVATE KEY-----\n");
    expect(new TextDecoder().decode(der)).toBe("ABC");
  });
});

describe("the nonce is hashed in exactly one place", () => {
  const appleAuth = read("src/lib/appleAuth.ts");
  const swift = read("src-tauri/plugins/nuvo-siwa/ios/Sources/NuvoSiwaPlugin.swift");

  it("JS hashes the nonce for Apple and sends Supabase the raw one", () => {
    // The digest goes down to the plugin…
    expect(appleAuth).toMatch(/nativeCredential\(await sha256Hex\(rawNonce\)\)/);
    // …and the RAW value goes to Supabase, which hashes it and compares.
    expect(appleAuth).toMatch(/signInWithIdToken\(\{[\s\S]*?nonce: rawNonce,/);
  });

  it("Swift never hashes — one hasher, so the pair cannot drift", () => {
    expect(codeOnly(swift)).not.toMatch(/sha256|SHA256|SHA-256/i);
    // It passes JS's digest through verbatim.
    expect(swift).toContain("request.nonce = args.nonce");
  });

  it("keeps the cancel sentinel identical on both sides of the bridge", () => {
    const fromSwift = /let cancelledMessage = "([^"]+)"/.exec(swift)?.[1];
    const fromJs = /APPLE_SIGN_IN_CANCELLED = "([^"]+)"/.exec(appleAuth)?.[1];
    expect(fromSwift).toBeTruthy();
    expect(fromJs).toBe(fromSwift);
  });
});

describe("the plugin is wired end to end", () => {
  it("every command exists in build.rs, the invoke handler and the permission set", () => {
    const buildRs = read("src-tauri/plugins/nuvo-siwa/build.rs");
    const libRs = read("src-tauri/plugins/nuvo-siwa/src/lib.rs");
    const permissions = read("src-tauri/plugins/nuvo-siwa/permissions/default.toml");

    const declared = /const COMMANDS[^=]*=\s*&\[([^\]]*)\]/.exec(buildRs)?.[1] ?? "";
    const commands = [...declared.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(commands).toEqual(["sign_in"]);

    for (const command of commands) {
      expect(libRs).toContain(`commands::${command}`);
      // build.rs generates permissions/autogenerated/ from the same list; the
      // default set has to actually grant them or the webview gets "Permission
      // nuvo-siwa:allow-… not found" at runtime.
      expect(permissions).toContain(`allow-${command.replace(/_/g, "-")}`);
    }
  });

  it("never strands an old iOS shell on a provider error page", () => {
    // The plugin missing means an older TestFlight build. Redirecting there
    // navigates the app itself to Supabase's error JSON, in a shell with no
    // back button — so say what happened instead, unless the web flow is real.
    const lib = read("src/lib/appleAuth.ts");
    expect(lib).toContain("appleWebAuthConfigured()");
    expect(lib).toMatch(/isn't available in this version of the app/);
  });

  it("is registered once, unconditionally — the b165928 shape is what broke iOS", () => {
    const appLib = read("src-tauri/src/lib.rs");
    expect(appLib.split("tauri_plugin_nuvo_siwa::init()").length - 1).toBe(1);
    expect(read("src-tauri/Cargo.toml")).toContain('tauri-plugin-nuvo-siwa = { path = "plugins/nuvo-siwa" }');
    // Plugin commands ARE permission-gated in Tauri v2 (app commands are not).
    expect(read("src-tauri/capabilities/default.json")).toContain("nuvo-siwa:default");
  });

  it("no Swift concurrency in a swift-rs target (nuvo-watch's minos 13 trap)", () => {
    const swift = read("src-tauri/plugins/nuvo-siwa/ios/Sources/NuvoSiwaPlugin.swift");
    expect(codeOnly(swift)).not.toMatch(/\bawait\b|\bTask\s*\{/);
  });
});

describe("the entitlement reaches the build", () => {
  it("Nuvo.entitlements declares applesignin", () => {
    expect(read("src-tauri/ios/Nuvo.entitlements")).toContain("com.apple.developer.applesignin");
  });

  it("ios-postinit runs ios-siwa BEFORE the PlistBuddy patches", () => {
    // xcodegen rewrites nuvo_iOS/Info.plist from project.yml, so an injection
    // script running after PlistBuddy silently drops
    // ITSAppUsesNonExemptEncryption / CFBundleURLTypes / the orientation lock —
    // which is exactly why every build got flagged "Missing Compliance".
    const postinit = read("scripts/ios-postinit.sh");
    const siwa = postinit.indexOf("scripts/ios-siwa.rb");
    const firstPlistBuddy = postinit.indexOf("/usr/libexec/PlistBuddy");
    expect(siwa).toBeGreaterThan(-1);
    expect(firstPlistBuddy).toBeGreaterThan(-1);
    expect(siwa).toBeLessThan(firstPlistBuddy);
    expect(postinit).toContain('NUVO_IOS_SIWA:-1');
  });

  it("merges into entitlements.properties — the setting xcodegen actually renders", () => {
    // Setting settings.base.CODE_SIGN_ENTITLEMENTS looks like it works and does
    // not: xcodegen's `entitlements` key owns that build setting and overwrites
    // it, leaving Tauri's empty <dict/> in place. The build then signs cleanly
    // and is rejected under 4.8, with nothing saying why.
    const script = read("scripts/ios-siwa.rb");
    expect(script).toContain("entitlements['properties']");
    expect(script).not.toMatch(/\bsettings'\]\['base'\]\['CODE_SIGN_ENTITLEMENTS'\]\s*=/);
    // And it verifies what was rendered rather than trusting the generator.
    expect(script).toContain("rendered_path");
    expect(script).toContain("project.pbxproj");
  });

  it("points at docs that exist", () => {
    for (const file of ["scripts/ios-siwa.rb", "src-tauri/ios/Nuvo.entitlements"]) {
      for (const [, doc] of read(file).matchAll(/docs\/([a-z0-9-]+\.md)/g)) {
        expect(() => read(`docs/${doc}`), `${file} points at a missing docs/${doc}`).not.toThrow();
      }
    }
  });
});

describe("the surfaces", () => {
  it("Login offers Apple beside Google, in Apple's own button", () => {
    const login = read("src/components/Login.tsx");
    expect(login).toContain("signInWithApple");
    expect(login).toContain("Sign in with Apple");
    // Apple requires its button to be at least as prominent: same width, same
    // padding, same tap floor as Continue with Google.
    expect(login).toMatch(/apple-signin[^"]*\btap\b[^"]*w-full[^"]*px-3 py-3/);
    // …and rendered only where it works.
    expect(login).toContain("appleSignInAvailable");
  });

  it("Settings can attach Apple to an existing account — same auth UUID", () => {
    const settings = read("src/components/SettingsModal.tsx");
    expect(settings).toContain("linkAppleIdentity");
    expect(settings).toContain("linkGoogleIdentity");
  });

  it("the Apple button flips with the theme rather than hardcoding one fill", () => {
    const css = read("src/index.css");
    expect(css).toMatch(/\.apple-signin\s*\{[^}]*background: #000/);
    expect(css).toMatch(/\[data-theme="dark"\] \.apple-signin\s*\{[^}]*background: #fff/);
  });
});

describe("deleting the account revokes Apple's grant (guideline 5.1.1(v))", () => {
  it("delete-account calls /auth/revoke and still wipes when it cannot", () => {
    const fn = read("supabase/functions/delete-account/index.ts");
    expect(fn).toContain("revokeAppleToken");
    expect(fn).toContain("apple_identities");
    // The wipe proceeds regardless — the outcome is reported, not enforced.
    expect(fn).toContain("appleRevoked");
    expect(fn).toContain("admin.auth.admin.deleteUser");
  });

  it("apple-identity stores the refresh token so there is something to revoke", () => {
    const fn = read("supabase/functions/apple-identity/index.ts");
    expect(fn).toContain("exchangeAppleAuthorizationCode");
    expect(fn).toContain("storeSecret");
    expect(fn).toContain("mergeAppleProfile");
  });

  it("the migration creates apple_identities with owner-only reads", () => {
    const sql = read("supabase/migrations/00000000000076_apple_identities.sql");
    expect(sql).toContain("create table if not exists public.apple_identities");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("auth.uid() = user_id");
    // vault.secrets does not cascade off auth.users (migration 70).
    expect(sql).toContain("refresh_token_secret_id");
  });
});

describe("two accounts, one person — Apple and Google on the same email", () => {
  const google = { provider: "google", identity_data: { email: "ada@example.com" } };
  const apple = { provider: "apple", identity_data: { email: "ada@example.com" } };
  const relay = { provider: "apple", identity_data: { email: "abc123@privaterelay.appleid.com" } };

  it("shows every method with its state — not just the missing ones", () => {
    // A pane that lists only what you lack cannot answer "which did I use?".
    const rows = readSignInMethods([google], "google");
    expect(rows.map((r) => r.provider)).toEqual(["google", "apple"]);
    expect(rows[0]).toMatchObject({ linked: true, current: true, email: "ada@example.com" });
    expect(rows[1]).toMatchObject({ linked: false, current: false });
  });

  it("names the provider this session actually signed in with", () => {
    // app_metadata.provider is the MOST RECENT sign-in, which is the question
    // being asked — not the first identity in the list.
    const rows = readSignInMethods([google, apple], "apple");
    expect(rows.find((r) => r.current)?.provider).toBe("apple");
    expect(rows.every((r) => r.linked)).toBe(true);
  });

  it("shared verified email = one account with both identities attached", () => {
    const rows = readSignInMethods([google, apple], "apple");
    // Supabase folded them onto one user; both read as linked, same address.
    expect(rows.map((r) => r.email)).toEqual(["ada@example.com", "ada@example.com"]);
    expect(rows.some((r) => r.relay)).toBe(false);
  });

  it("flags Hide My Email — the case that CANNOT be reconciled afterwards", () => {
    const rows = readSignInMethods([relay], "apple");
    const appleRow = rows.find((r) => r.provider === "apple");
    expect(appleRow?.relay).toBe(true);
    expect(appleRow?.email).toBe("abc123@privaterelay.appleid.com");
    // Google is still offered, because linking it is the fix.
    expect(rows.find((r) => r.provider === "google")?.linked).toBe(false);
  });

  it("never hides an attached method, even one we would not offer to add", () => {
    // VITE_APPLE_AUTH off must not make an existing Apple identity invisible.
    const rows = readSignInMethods([relay], "apple", { apple: false });
    expect(rows.map((r) => r.provider)).toContain("apple");
    expect(rows.find((r) => r.provider === "apple")?.linked).toBe(true);
    // …but with nothing attached, an unoffered method stays out of the list.
    expect(readSignInMethods([google], "google", { apple: false }).map((r) => r.provider)).toEqual([
      "google",
    ]);
  });

  it("keeps one relay rule across the SPA and the edge function", () => {
    for (const email of [
      "abc@privaterelay.appleid.com",
      "ADA@PrivateRelay.AppleID.com",
      "ada@example.com",
      null,
    ]) {
      expect(isRelayInSpa(email)).toBe(isPrivateRelayEmail(email));
    }
  });

  it("labels providers in the app's own words — prose vs row title", () => {
    expect(providerLabel("google")).toBe("Google");
    expect(providerLabel("apple")).toBe("Apple");
    // "you used an email code" reads; "an email code | Linked" does not.
    expect(providerLabel("email")).toBe("an email code");
    expect(providerRowLabel("email")).toBe("Email code");
    expect(providerLabel(null)).toBe("another method");
  });

  it("shows the email identity when there is one, so the pane can always answer", () => {
    // The dev/OTP path signs in as `email`. Without this row nothing on the
    // pane is marked, and "which one did I use?" has no answer at all.
    const emailIdentity = { provider: "email", identity_data: { email: "ada@example.com" } };
    const rows = readSignInMethods([google, emailIdentity], "email");
    expect(rows.map((r) => r.provider)).toEqual(["google", "apple", "email"]);
    expect(rows.find((r) => r.provider === "email")).toMatchObject({
      label: "Email code",
      linked: true,
      current: true,
    });
  });

  it("never invents an email row for an account that has no email identity", () => {
    expect(readSignInMethods([google], "google").map((r) => r.provider)).toEqual(["google", "apple"]);
  });

  it("the login screen says what this device used last, and useAuth records it", () => {
    // Prevention, not repair: nothing can pair a relay account with a Google
    // one after the fact, so the only working guard is saying it beforehand.
    const login = read("src/components/Login.tsx");
    expect(login).toContain("lastAuthProvider");
    expect(login).toContain("Last time on this device you used");

    // One writer, on the path every sign-in takes.
    const useAuth = read("src/hooks/useAuth.ts");
    expect(useAuth).toContain("rememberAuthProvider(s.user.app_metadata?.provider)");
  });

  it("Settings tells the truth about what an unlinked method does", () => {
    const settings = read("src/components/SettingsModal.tsx");
    expect(settings).toContain("readSignInMethods");
    expect(settings).toContain("Signed in with this");
    expect(settings).toMatch(/separate, empty one/);
    // Apple's relay is explained where it is visible, not buried in a doc.
    expect(settings).toContain("Apple is hiding your address");
  });
});
