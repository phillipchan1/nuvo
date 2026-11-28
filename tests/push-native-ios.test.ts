/**
 * @vitest-environment jsdom
 */
// The native iPhone app registers for background reminders through APNs (D-260).
//
// It has no service worker, so before D-260 it could only remind you while it
// was open — and on a phone that is almost never. The `nuvo-push` plugin hands
// over a device token, stored as an `apns://<env>/<token>` endpoint in the same
// table Web Push uses, so the dispatcher needs no second path. This pins the
// client half: the endpoint shape the Worker parses, a rotated token replacing
// its row, and turning reminders off forgetting the device.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = { deleted: [] as string[], upserted: [] as { endpoint: string; p256dh: string; label: string }[] };

vi.mock("../src/lib/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({
      delete: () => ({
        eq: async (_col: string, endpoint: string) => {
          calls.deleted.push(endpoint);
          return { error: null };
        },
      }),
      upsert: async (row: { endpoint: string; p256dh: string; label: string }) => {
        calls.upserted.push(row);
        return { error: null };
      },
    }),
  },
}));

vi.mock("../src/lib/platform", () => ({ isTauriIOS: () => true, isTauri: () => true }));

const TOKEN_A = "a1".repeat(32);
const TOKEN_B = "b2".repeat(32);
let reply: { supported: boolean; token?: string; environment?: string; error?: string };
const invoked: string[] = [];

beforeEach(() => {
  calls.deleted.length = 0;
  calls.upserted.length = 0;
  invoked.length = 0;
  // Node 22's own unbacked `localStorage` shadows jsdom's; give push.ts a real one.
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  reply = { supported: true, token: TOKEN_A, environment: "production" };
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string) => {
      invoked.push(cmd);
      return reply;
    },
  };
  vi.stubGlobal("Notification", { permission: "granted" });
});

afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});

describe("native iPhone push (APNs)", () => {
  it("counts as supported and configured, though it has no service worker", async () => {
    const { pushSupported, pushConfigured } = await import("../src/lib/push");
    expect(pushSupported()).toBe(true);
    expect(pushConfigured()).toBe(true);
  });

  it("records the token as an apns:// endpoint the dispatcher can parse", async () => {
    const { subscribeToPush, hasPushSubscription } = await import("../src/lib/push");
    const out = await subscribeToPush();
    expect(out).toEqual({ ok: true, endpoint: `apns://production/${TOKEN_A}` });
    expect(invoked).toEqual(["plugin:nuvo-push|register"]);
    expect(calls.upserted[0]?.endpoint).toBe(`apns://production/${TOKEN_A}`);
    expect(calls.upserted[0]?.p256dh).toBe("");
    expect(await hasPushSubscription()).toBe(true);
  });

  it("a development build's token goes to the sandbox host", async () => {
    reply = { supported: true, token: TOKEN_A.toUpperCase(), environment: "sandbox" };
    const { subscribeToPush } = await import("../src/lib/push");
    expect(await subscribeToPush()).toEqual({ ok: true, endpoint: `apns://sandbox/${TOKEN_A}` });
  });

  it("a rotated token replaces the old row instead of leaving it to fail", async () => {
    const { subscribeToPush } = await import("../src/lib/push");
    await subscribeToPush();
    reply = { supported: true, token: TOKEN_B, environment: "production" };
    await subscribeToPush();
    expect(calls.deleted).toEqual([`apns://production/${TOKEN_A}`]);
    expect(calls.upserted.map((r) => r.endpoint)).toEqual([
      `apns://production/${TOKEN_A}`,
      `apns://production/${TOKEN_B}`,
    ]);
  });

  it("no token (no entitlement yet, or the simulator) is a failure, not a row", async () => {
    reply = { supported: true, error: "no valid aps-environment entitlement" };
    const { subscribeToPush, hasPushSubscription } = await import("../src/lib/push");
    const out = await subscribeToPush();
    expect(out.ok).toBe(false);
    expect(calls.upserted).toHaveLength(0);
    expect(await hasPushSubscription()).toBe(false);
  });

  it("without notification permission it never asks iOS for a token", async () => {
    vi.stubGlobal("Notification", { permission: "default" });
    const { subscribeToPush } = await import("../src/lib/push");
    expect(await subscribeToPush()).toEqual({ ok: false, reason: "denied" });
    expect(invoked).toHaveLength(0);
  });

  it("turning reminders off forgets this device", async () => {
    const { subscribeToPush, unsubscribeFromPush, hasPushSubscription } = await import("../src/lib/push");
    await subscribeToPush();
    await unsubscribeFromPush();
    expect(calls.deleted).toEqual([`apns://production/${TOKEN_A}`]);
    expect(await hasPushSubscription()).toBe(false);
  });
});
