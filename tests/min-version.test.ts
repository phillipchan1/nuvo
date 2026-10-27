import { afterEach, describe, expect, it, vi } from "vitest";
import { isBelowMinVersion, parseVersion, readMinVersion } from "../src/lib/minVersion";
import {
  UPDATE_REQUIRED_MESSAGE,
  assertWritable,
  clientBelowMinVersion,
  resetMaintenanceCacheForTests,
} from "../src/lib/maintenance";

afterEach(() => {
  resetMaintenanceCacheForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseVersion / isBelowMinVersion", () => {
  it("reads major.minor.patch and ignores a suffix", () => {
    expect(parseVersion("0.1.558")).toEqual([0, 1, 558]);
    expect(parseVersion(" 1.2.3-beta ")).toEqual([1, 2, 3]);
    expect(parseVersion("nope")).toBeNull();
  });

  it("compares component-wise", () => {
    expect(isBelowMinVersion("0.1.0", "0.1.1")).toBe(true);
    expect(isBelowMinVersion("0.1.1", "0.1.1")).toBe(false);
    expect(isBelowMinVersion("0.2.0", "0.1.99")).toBe(false);
    expect(isBelowMinVersion("1.0.0", "2.0.0")).toBe(true);
    expect(isBelowMinVersion("bad", "1.0.0")).toBe(false);
  });

  it("reads min_version first, then the aliases", () => {
    expect(readMinVersion({ min_version: "1.0.0", minimum_version: "9.0.0" })).toBe("1.0.0");
    expect(readMinVersion({ min_client_version: "2.0.0" })).toBe("2.0.0");
    expect(readMinVersion({ minimum_version: "3.0.0" })).toBe("3.0.0");
    expect(readMinVersion({})).toBeNull();
  });
});

describe("maintenance min_version gate", () => {
  it("assertWritable throws UPDATE_REQUIRED when the flag is above this build", async () => {
    vi.stubEnv("VITE_MAINTENANCE_URL", "https://api.nuvo.day/api/maintenance");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ write_freeze: false, min_version: "99.0.0" }), { status: 200 }),
      ),
    );
    const { resolveLaunchBackend } = await import("../src/lib/maintenance");
    await resolveLaunchBackend();
    expect(clientBelowMinVersion()).toBe(true);
    await expect(assertWritable()).rejects.toThrow(UPDATE_REQUIRED_MESSAGE);
  });

  it("does not block writes when min_version is at or below this build", async () => {
    vi.stubEnv("VITE_MAINTENANCE_URL", "https://api.nuvo.day/api/maintenance");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ write_freeze: false, min_version: "0.0.1" }), { status: 200 }),
      ),
    );
    const { resolveLaunchBackend, writeFrozen } = await import("../src/lib/maintenance");
    await resolveLaunchBackend();
    expect(clientBelowMinVersion()).toBe(false);
    await expect(writeFrozen()).resolves.toBe(false);
  });
});

describe("MinVersionPrompt", () => {
  it("is the full-screen update copy, not a toast", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/components/MinVersionPrompt.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/Update Nuvo to continue/);
    expect(src).toMatch(/UPDATE_REQUIRED_MESSAGE/);
    expect(src).toMatch(/location\.reload/);
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/clientBelowMinVersion\(\)/);
    expect(app).toMatch(/<MinVersionPrompt/);
  });
});
