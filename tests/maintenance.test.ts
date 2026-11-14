/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as backend from "../src/lib/backend";

const {
  writeFrozen,
  resetMaintenanceCacheForTests,
  maintenanceUrl,
  resolveLaunchBackend,
  resolveLaunchBackendCapped,
  launchBackendResolved,
  parseMaintenanceFlag,
  CUTOVER_FLIP_STORAGE_KEY,
  LAUNCH_TIMEOUT_MS,
  liveInboundMailDomain,
} = await import("../src/lib/maintenance");

// A baked build (the desktop release bakes https://api.nuvo.day/api) — not yet flipped.
beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", "https://nuvo-preview.example/api");
});

afterEach(() => {
  resetMaintenanceCacheForTests();
  vi.useRealTimers();
  setOnLine(true);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

/** A fetch that only ever settles by abort — the Worker never answers. */
const hangingFetch = () =>
  vi.fn((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  );

/** A relaunch: module memory gone (backend + resolved), disk (localStorage) kept. */
function relaunch() {
  const sticky = localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY);
  resetMaintenanceCacheForTests();
  if (sticky !== null) localStorage.setItem(CUTOVER_FLIP_STORAGE_KEY, sticky);
}

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

  it("launch timeout is ~3s", () => {
    expect(LAUNCH_TIMEOUT_MS).toBe(3_000);
  });

  it("(a) non-JSON body → Supabase, never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })));
    await expect(resolveLaunchBackend()).resolves.toBeUndefined();
    expect(launchBackendResolved()).toBe(true);
    expect(backend.workersEnabled).toBe(false);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBeNull();
  });

  it("(a) garbage JSON that doesn't allowlist-flip → Supabase", async () => {
    for (const body of [{ cutover_flipped: "maybe" }, [{ cutover_flipped: true }], ["true"], null, "true", 1]) {
      resetMaintenanceCacheForTests();
      vi.stubGlobal("fetch", vi.fn(async () => ok(body)));
      await resolveLaunchBackend();
      expect(backend.workersEnabled, JSON.stringify(body)).toBe(false);
      expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY), JSON.stringify(body)).toBeNull();
    }
  });

  it("(a) offline → no fetch, Supabase", async () => {
    setOnLine(false);
    const fetchMock = vi.fn(async () => ok({ cutover_flipped: true }));
    vi.stubGlobal("fetch", fetchMock);
    await resolveLaunchBackend();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(launchBackendResolved()).toBe(true);
    expect(backend.workersEnabled).toBe(false);
  });

  it("sticky: a device that saw the flip stays flipped when offline at launch", async () => {
    localStorage.setItem(CUTOVER_FLIP_STORAGE_KEY, "1");
    setOnLine(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await resolveLaunchBackend();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(backend.workersEnabled).toBe(true);
  });

  it("sticky: a device that saw the flip stays flipped on a launch timeout", async () => {
    localStorage.setItem(CUTOVER_FLIP_STORAGE_KEY, "1");
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const pending = resolveLaunchBackend();
    await vi.advanceTimersByTimeAsync(LAUNCH_TIMEOUT_MS);
    await pending;
    expect(backend.workersEnabled).toBe(true);
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

describe("later polls (writeFrozen) — next launch only", () => {
  // Flip / unflip takes effect on the next cold start only; a running session
  // keeps its backend. Polls update the freeze cache and the sticky key.
  // The launch read primes writeFrozen's cache; step past its TTL so the next write polls.
  const pastTtl = () => vi.advanceTimersByTime(6_000);
  beforeEach(() => vi.useFakeTimers());

  it("a flip seen mid-session only records sticky; the relaunch flips", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as Location);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ cutover_flipped: false })).mockResolvedValueOnce(ok({ cutover_flipped: true })));
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(false);
    pastTtl();
    await writeFrozen();
    expect(backend.workersEnabled).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBe("1");

    relaunch();
    vi.stubGlobal("fetch", hangingFetch());
    const pending = resolveLaunchBackend();
    await vi.advanceTimersByTimeAsync(LAUNCH_TIMEOUT_MS);
    await pending;
    expect(backend.workersEnabled).toBe(true);
  });

  it("a rollback seen mid-session only clears sticky; the relaunch rolls back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ cutover_flipped: true })).mockResolvedValueOnce(ok({ cutover_flipped: false })));
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(true);
    pastTtl();
    await writeFrozen();
    expect(backend.workersEnabled).toBe(true);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBeNull();

    relaunch();
    setOnLine(false);
    await resolveLaunchBackend();
    expect(backend.workersEnabled).toBe(false);
  });

  it("an omitted flag stays flipped", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ cutover_flipped: true })).mockResolvedValueOnce(ok({ write_freeze: false })));
    await resolveLaunchBackend();
    pastTtl();
    await writeFrozen();
    expect(backend.workersEnabled).toBe(true);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBe("1");
  });

  it("a garbage poll body changes nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ cutover_flipped: true })).mockResolvedValueOnce(new Response("not-json", { status: 200 })));
    await resolveLaunchBackend();
    pastTtl();
    await expect(writeFrozen()).resolves.toBe(false);
    expect(backend.workersEnabled).toBe(true);
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBe("1");
  });
});

describe("BackendGate's capped launch (resolveLaunchBackendCapped)", () => {
  it("settles by LAUNCH_TIMEOUT_MS even if the probe never does; a late answer can't switch", async () => {
    vi.useFakeTimers();
    let answer!: (r: Response) => void;
    // A fetch that ignores its abort signal — the hung promise the cap exists for.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
    let ready = false;
    void resolveLaunchBackendCapped().finally(() => { ready = true; });
    await vi.advanceTimersByTimeAsync(LAUNCH_TIMEOUT_MS - 1);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ready).toBe(true);
    expect(launchBackendResolved()).toBe(true);
    expect(backend.workersEnabled).toBe(false);

    answer(ok({ cutover_flipped: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.workersEnabled).toBe(false);
    // …but the next launch will pick it up.
    expect(localStorage.getItem(CUTOVER_FLIP_STORAGE_KEY)).toBe("1");
  });

  it("returns as soon as the probe answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ok({ cutover_flipped: true })));
    await resolveLaunchBackendCapped();
    expect(backend.workersEnabled).toBe(true);
  });

  it("App's BackendGate awaits the capped probe", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname, "..", "src/App.tsx"), "utf8");
    expect(src).toMatch(/resolveLaunchBackendCapped\(\)\.finally\(\(\) => setReady\(true\)\)/);
    expect(src).not.toMatch(/\bresolveLaunchBackend\(\)/);
  });
});

describe("downgrade to v1.2.794", () => {
  it("the only thing persisted is nuvo.cutover_flipped = \"1\" (or nothing)", async () => {
    expect(CUTOVER_FLIP_STORAGE_KEY).toBe("nuvo.cutover_flipped");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname, "..", "src/lib/maintenance.ts"), "utf8");
    const writes = src.match(/localStorage\??\.setItem\([^)]*\)/g) ?? [];
    expect(writes).toEqual(['localStorage?.setItem(CUTOVER_FLIP_STORAGE_KEY, "1")']);
    expect(src).not.toMatch(/indexedDB|sessionStorage/);
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

describe("inbound_mail_domain", () => {
  it("is null until the Worker answers", () => {
    expect(liveInboundMailDomain()).toBeNull();
  });

  it("takes a valid domain from /api/maintenance, lowercased", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ write_freeze: false, inbound_mail_domain: "Nuvo.Day" })));
    await resolveLaunchBackend();
    expect(liveInboundMailDomain()).toBe("nuvo.day");
  });

  it("ignores a malformed domain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ write_freeze: false, inbound_mail_domain: "evil@x" })));
    await resolveLaunchBackend();
    expect(liveInboundMailDomain()).toBeNull();
  });
});
