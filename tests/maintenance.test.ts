/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as backend from "../src/lib/backend";

const {
  writeFrozen,
  resetMaintenanceCacheForTests,
  maintenanceUrl,
  resolveLaunchBackend,
  launchBackendResolved,
  parseMaintenanceFlag,
  CUTOVER_FLIP_STORAGE_KEY,
  LAUNCH_TIMEOUT_MS,
} = await import("../src/lib/maintenance");

// A baked build (the desktop release bakes https://api.nuvo.day/api) — not yet flipped.
beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", "https://nuvo-preview.example/api");
});

afterEach(() => {
  resetMaintenanceCacheForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("maintenanceUrl", () => {
  it("reads /maintenance off the baked API base, before any flip", () => {
    expect(backend.workersEnabled).toBe(false);
    expect(maintenanceUrl()).toBe("https://nuvo-preview.example/api/maintenance");
  });

  it("is empty with nothing baked (today's web/dev path)", () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    expect(maintenanceUrl()).toBe("");
  });
});

describe("parseMaintenanceFlag", () => {
  it("allowlists, never Boolean()", () => {
    for (const v of [true, 1, "true", "1", "yes", "on", " TRUE "]) expect(parseMaintenanceFlag(v), String(v)).toBe(true);
    for (const v of [false, 0, "false", "0", "no", "off", ""]) expect(parseMaintenanceFlag(v), String(v)).toBe(false);
    for (const v of [undefined, null, "maybe", 2, {}]) expect(parseMaintenanceFlag(v), String(v)).toBeUndefined();
  });
});

describe("resolveLaunchBackend", () => {
  it("(a) cutover_flipped: false → Supabase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ write_freeze: false, cutover_armed: false, cutover_flipped: false })));
    expect(launchBackendResolved()).toBe(false);
    await resolveLaunchBackend();
    expect(launchBackendResolved()).toBe(true);
    expect(backend.workersEnabled).toBe(false);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBeNull();
  });

  it("(a) unreachable → Supabase, nothing persisted, writes not frozen", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(false);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBeNull();
    await expect(writeFrozen()).resolves.toBe(false);
  });

  it("(a) non-OK → Supabase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(false);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBeNull();
  });

  it("(a) timeout → Supabase after LAUNCH_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
      ),
    );
    const pending = resolveLaunchBackend();
    await vi.advanceTimersByTimeAsync(LAUNCH_TIMEOUT_MS);
    await pending;
    expect(backend.workersEnabled).toBe(false);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBeNull();
  });

  it("(a) the string \"false\" is not a flip", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ cutover_flipped: "false" })));
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(false);
  });

  it("(a) no maintenance URL → Supabase without a fetch", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(b) cutover_flipped: true → Worker, persisted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ cutover_flipped: true })));
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(true);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBe("1");
  });

  it("a persisted flip survives a later launch timeout", async () => {
    localStorage.setItem(CUTOVER_FLIP_STORAGE_KEY, "1");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(true);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBe("1");
  });

  it("a persisted flip survives an omitted flag", async () => {
    localStorage.setItem(CUTOVER_FLIP_STORAGE_KEY, "1");
    vi.stubGlobal("fetch", vi.fn(async () => ok({ write_freeze: false })));
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(true);
  });

  it("explicit false clears a persisted flip (rollback)", async () => {
    localStorage.setItem(CUTOVER_FLIP_STORAGE_KEY, "1");
    vi.stubGlobal("fetch", vi.fn(async () => ok({ cutover_flipped: false })));
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(false);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBeNull();
  });

  it("never flips without a baked API base (explicit maintenance URL only)", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubEnv("VITE_MAINTENANCE_URL", "https://api.nuvo.day/api/maintenance");
    vi.stubGlobal("fetch", vi.fn(async () => ok({ cutover_flipped: true })));
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(false);
  });
});

describe("later polls (writeFrozen)", () => {
  // The launch read primes writeFrozen's cache; step past its TTL so the next write polls.
  const pastTtl = () => vi.advanceTimersByTime(6_000);
  beforeEach(() => vi.useFakeTimers());
  it("explicit false unflips mid-session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ cutover_flipped: true })).mockResolvedValueOnce(ok({ cutover_flipped: false })));
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(true);
    pastTtl();
    await writeFrozen();
    expect(backend.workersEnabled).toBe(false);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBeNull();
  });

  it("an omitted flag stays flipped", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ cutover_flipped: true })).mockResolvedValueOnce(ok({ write_freeze: false })));
    await resolveLaunchBackend();
    pastTtl();
    await writeFrozen();
    expect(backend.workersEnabled).toBe(true);
  });

  it("a flip seen mid-session reloads instead of half-switching", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as Location);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ cutover_flipped: false })).mockResolvedValueOnce(ok({ cutover_flipped: true })));
    await resolveLaunchBackend();
    pastTtl();
    await writeFrozen();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(backend.workersEnabled).toBe(false);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBe("1");
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
    const { join } = await import("node:path");
    const files = [
      "src/hooks/useAgent.ts",
      "src/lib/judgeOKRs.ts",
      "src/lib/draftOKRs.ts",
      "src/lib/groomAI.ts",
    ];
    for (const file of files) {
      const src = readFileSync(join(import.meta.dirname, "..", file), "utf8");
      expect(src, file).toMatch(/assertWritable\(\)/);
      expect(src, file).toMatch(/functions\/v1\/agent|functionUrl\("agent"\)/);
    }
  });
});
