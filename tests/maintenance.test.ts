import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/backend", () => ({
  workersEnabled: true,
  apiBaseUrl: () => "https://nuvo-preview.example/api",
  apiConfigured: () => false,
  setWorkersEnabled: () => undefined,
  resetWorkersEnabledForTests: () => undefined,
}));

const { writeFrozen, resetMaintenanceCacheForTests, maintenanceUrl } = await import("../src/lib/maintenance");

afterEach(() => {
  resetMaintenanceCacheForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("maintenanceUrl", () => {
  it("reads /maintenance off the Worker API base", () => {
    expect(maintenanceUrl()).toBe("https://nuvo-preview.example/api/maintenance");
  });
});

describe("writeFrozen", () => {
  it("is true when the Worker says write_freeze", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ write_freeze: true }), { status: 200 })),
    );
    await expect(writeFrozen()).resolves.toBe(true);
  });

  it("fails open when the flag cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(writeFrozen()).resolves.toBe(false);
  });

  it("fails closed when cutover is armed and the flag cannot be reached", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ write_freeze: false, cutover_armed: true }), { status: 200 }),
        )
        .mockRejectedValueOnce(new Error("offline")),
    );
    await expect(writeFrozen()).resolves.toBe(false);
    vi.advanceTimersByTime(6_000);
    await expect(writeFrozen()).resolves.toBe(true);
    vi.useRealTimers();
  });

  it("reuses the cached flag within the TTL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ write_freeze: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(writeFrozen()).resolves.toBe(true);
    await expect(writeFrozen()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("assertWritable", () => {
  it("throws the freeze message when writes are frozen", async () => {
    const { assertWritable, WRITE_FROZEN_MESSAGE } = await import("../src/lib/maintenance");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ write_freeze: true }), { status: 200 })),
    );
    await expect(assertWritable()).rejects.toThrow(WRITE_FROZEN_MESSAGE);
  });
});

describe("agent callers", () => {
  it("route the four functions/v1/agent fetches through writeFrozen", async () => {
    const { readFileSync } = await import("node:fs");
    const files = [
      "src/hooks/useAgent.ts",
      "src/lib/judgeOKRs.ts",
      "src/lib/draftOKRs.ts",
      "src/lib/groomAI.ts",
    ];
    for (const file of files) {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(src, file).toMatch(/assertWritable\(\)/);
      expect(src, file).toMatch(/functions\/v1\/agent|functionUrl\("agent"\)/);
    }
  });
});
