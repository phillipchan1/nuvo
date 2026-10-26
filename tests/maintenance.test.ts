import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/backend", () => ({
  workersEnabled: true,
  apiBaseUrl: () => "https://nuvo-preview.example/api",
}));

const { writeFrozen, resetMaintenanceCacheForTests, maintenanceUrl } = await import("../src/lib/maintenance");

afterEach(() => {
  resetMaintenanceCacheForTests();
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
