/**
 * @vitest-environment jsdom
 *
 * The auth lock has to serialize two overlapping sections the way two Tauri
 * webviews would — if it doesn't, GoTrue sees `refresh_token_already_used`.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { authLock } from "../src/lib/authLock";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage(),
    configurable: true,
    writable: true,
  });
});

describe("authLock", () => {
  it("runs the critical section", async () => {
    const result = await authLock("t", 1000, async () => 7);
    expect(result).toBe(7);
  });

  it("serializes overlapping callers so they never overlap in the body", async () => {
    let concurrent = 0;
    let max = 0;
    const body = async () => {
      concurrent += 1;
      max = Math.max(max, concurrent);
      await new Promise((r) => setTimeout(r, 40));
      concurrent -= 1;
    };
    await Promise.all([authLock("t", 2000, body), authLock("t", 2000, body), authLock("t", 2000, body)]);
    expect(max).toBe(1);
  });

  it("steals a lock whose holder crashed (TTL expired)", async () => {
    localStorage.setItem("nuvo.auth.lock:t", `${Date.now() - 20_000}:dead`);
    const result = await authLock("t", 1000, async () => "ok");
    expect(result).toBe("ok");
    expect(localStorage.getItem("nuvo.auth.lock:t")).toBeNull();
  });
});
