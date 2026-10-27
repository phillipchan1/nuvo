import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("launch-time backend switch", () => {
  it("App waits on resolveLaunchBackend before useAuth / SyncHost", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/function BackendGate/);
    expect(app).toMatch(/resolveLaunchBackend/);
    expect(app).toMatch(/<BackendGate>/);
    expect(app).toMatch(/currentUserId/);
    expect(app.indexOf("<BackendGate>")).toBeLessThan(app.indexOf("<SyncHost"));
    expect(app.indexOf("<BackendGate>")).toBeLessThan(app.indexOf("<Shell"));
  });

  it("workersEnabled is a runtime let, not a compile-time const", () => {
    const src = read("src/lib/backend.ts");
    expect(src).toMatch(/export let workersEnabled = false/);
    expect(src).toMatch(/export function setWorkersEnabled/);
    expect(src).toMatch(/workersEnabled \? apiBaseUrl\(\)/);
  });
});

describe("supabase wrap — every .from / .rpc / invoke after the flip", () => {
  it("rewrites table, rpc, and function calls, and leaves billing on Supabase", () => {
    const src = read("src/lib/supabase.ts");
    expect(src).toMatch(/workersEnabled \? workerFrom\(table\)/);
    expect(src).toMatch(/workersEnabled \? workerRpc\(fn/);
    expect(src).toMatch(/BILLING_FUNCTION_NAMES\.has\(fn\)/);
    expect(src).toMatch(/return workerInvoke\(fn/);
    expect(src).toMatch(/currentAccessToken\(\)/);
  });

  it("sync transport skips Worker apply_patch and PATCHes the row", () => {
    const src = read("src/lib/sync/transport.ts");
    expect(src).toMatch(/!workersEnabled/);
    expect(src).toMatch(/apply_patch/);
    expect(src).toMatch(/\.update\(op\.payload\)/);
  });
});

describe("direct fetch / session call sites", () => {
  const agentCallers = [
    "src/hooks/useAgent.ts",
    "src/lib/groomAI.ts",
    "src/lib/judgeOKRs.ts",
    "src/lib/draftOKRs.ts",
  ];

  it.each(agentCallers)("%s uses functionUrl(agent) + currentAccessToken", (file) => {
    const src = read(file);
    expect(src).toMatch(/functionUrl\("agent"\)/);
    expect(src).toMatch(/currentAccessToken/);
    expect(src).toMatch(/assertWritable\(\)/);
  });

  it("Settings calendar connect and ReconnectBanner use functionUrl + currentAccessToken", () => {
    const settings = read("src/components/SettingsModal.tsx");
    expect(settings).toMatch(/currentAccessToken/);
    expect(settings).toMatch(/functionUrl\(provider === "google" \? "google-oauth" : "m365-oauth"\)/);
    expect(settings).toMatch(/workersEnabled/);
    expect(settings).toMatch(/useAuth/);
    const banner = read("src/components/ReconnectBanner.tsx");
    expect(banner).toMatch(/currentAccessToken/);
    expect(banner).toMatch(/functionUrl\(fn\)/);
  });

  it("Apps & devices mints connections with currentUserId and functionUrl", () => {
    const src = read("src/components/AppsDevicesPane.tsx");
    expect(src).toMatch(/functionUrl\(fn\)/);
    expect(src).toMatch(/currentUserId/);
  });

  it("Google sign-in / link follow the Better Auth path after the flip", () => {
    const src = read("src/lib/googleAuth.ts");
    expect(src).toMatch(/if \(workersEnabled\)/);
    expect(src).toMatch(/signIn\.social/);
    expect(src).toMatch(/linkSocial/);
  });

  it("useAuth remembers the session for currentUserId / currentAccessToken", () => {
    const src = read("src/hooks/useAuth.ts");
    expect(src).toMatch(/rememberClientSession\(session\)/);
    expect(src).toMatch(/if \(workersEnabled\)/);
  });

  const userIdSites = [
    "src/hooks/useVertical.tsx",
    "src/hooks/useRecordLog.ts",
    "src/hooks/useSettings.ts",
    "src/hooks/useEventRouting.ts",
    "src/hooks/useActivity.ts",
    "src/lib/push.ts",
  ];

  it.each(userIdSites)("%s reads currentUserId instead of supabase.auth.getUser", (file) => {
    const src = read(file);
    expect(src).toMatch(/currentUserId/);
  });

  it("useRealtime polls pullSyncTables when the Worker is live", () => {
    const src = read("src/hooks/useRealtime.ts");
    expect(src).toMatch(/if \(workersEnabled\)/);
    expect(src).toMatch(/pullSyncTables\(qc\)/);
    expect(src).toMatch(/30_000/);
  });
});

describe("release binaries bake VITE_API_BASE_URL", () => {
  it("Mac release.yml and iOS ios-release.yml set https://api.nuvo.day", () => {
    const mac = read(".github/workflows/release.yml");
    const ios = read(".github/workflows/ios-release.yml");
    expect(mac).toMatch(/VITE_API_BASE_URL: https:\/\/api\.nuvo\.day/);
    expect(ios).toMatch(/VITE_API_BASE_URL: https:\/\/api\.nuvo\.day/);
    expect(ios).not.toMatch(/vars\.VITE_API_BASE_URL/);
  });
});
