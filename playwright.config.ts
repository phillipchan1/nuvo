import { defineConfig, devices } from "@playwright/test";

// Native-feel interaction tests (docs/native-feel/05-verification.md).
//
// They drive the DEV-only fixture harnesses (?rail, ?rail=phone, ?sheets) — the
// real components over stubbed writes — so they need no login and can never
// touch an account's data. `npm run e2e`.
const PORT = Number(process.env.E2E_PORT ?? 5799);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/?rail`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] }, testMatch: /desktop\.spec\.ts|shared\.spec\.ts/ },
    { name: "desktop-webkit", use: { ...devices["Desktop Safari"] }, testMatch: /desktop\.spec\.ts|shared\.spec\.ts/ },
    // iPhone 13: WebKit, 390×844, touch, isMobile — coarse pointer, no hover.
    { name: "iphone", use: { ...devices["iPhone 13"] }, testMatch: /iphone\.spec\.ts|shared\.spec\.ts/ },
  ],
});
