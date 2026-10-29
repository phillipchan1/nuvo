// A rotated VAPID key must heal every installed phone on its next launch.
//
// The original private key lived only in Supabase's secrets, which hand back a
// hash and never the value, so the Cloudflare cutover rotates the pair (D-173).
// A subscription made with the old key is refused by the push service for every
// send signed with the new one — and `subscribeToPush` used to reuse whatever
// subscription the browser already held, so a rotation would have silenced
// every phone until someone toggled reminders off and on. This pins the swap.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = {
  deleted: [] as string[],
  upserted: [] as string[],
};

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
      upsert: async (row: { endpoint: string }) => {
        calls.upserted.push(row.endpoint);
        return { error: null };
      },
    }),
  },
}));

function keyBytes(seed: number): Uint8Array {
  const out = new Uint8Array(65);
  out[0] = 4;
  for (let i = 1; i < out.length; i++) out[i] = (seed * 31 + i * 7) % 256;
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const OLD = keyBytes(1);
const NEW = keyBytes(2);

function fakeSubscription(endpoint: string, key: Uint8Array | null) {
  const sub = {
    endpoint,
    options: { applicationServerKey: key ? key.slice().buffer : null },
    unsubscribed: false,
    unsubscribe: async () => {
      sub.unsubscribed = true;
      return true;
    },
    toJSON: () => ({ keys: { p256dh: "p", auth: "a" } }),
    getKey: () => null,
  };
  return sub;
}

function installBrowser(existing: ReturnType<typeof fakeSubscription> | null) {
  const subscribed: Uint8Array[] = [];
  const pushManager = {
    getSubscription: async () => existing,
    subscribe: async (opts: { applicationServerKey: Uint8Array }) => {
      subscribed.push(opts.applicationServerKey);
      return fakeSubscription("https://push.example/new", opts.applicationServerKey);
    },
  };
  vi.stubGlobal("window", { PushManager: function PushManager() {}, isSecureContext: true });
  vi.stubGlobal("navigator", {
    userAgent: "iPhone Safari",
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal("Notification", { permission: "granted" });
  return { subscribed };
}

async function loadPush() {
  vi.resetModules();
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", toBase64Url(NEW));
  return import("../src/lib/push");
}

beforeEach(() => {
  calls.deleted = [];
  calls.upserted = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("subscribedWithOtherKey", () => {
  it("is false for the key this build carries, padded or not", async () => {
    const { subscribedWithOtherKey } = await loadPush();
    expect(subscribedWithOtherKey(NEW.slice().buffer, toBase64Url(NEW))).toBe(false);
    expect(subscribedWithOtherKey(NEW.slice().buffer, `${toBase64Url(NEW)}=`)).toBe(false);
  });

  it("is true for a subscription made with another key", async () => {
    const { subscribedWithOtherKey } = await loadPush();
    expect(subscribedWithOtherKey(OLD.slice().buffer, toBase64Url(NEW))).toBe(true);
  });

  it("keeps a subscription whose key the browser doesn't report", async () => {
    const { subscribedWithOtherKey } = await loadPush();
    expect(subscribedWithOtherKey(null, toBase64Url(NEW))).toBe(false);
    expect(subscribedWithOtherKey(undefined, toBase64Url(NEW))).toBe(false);
    expect(subscribedWithOtherKey(OLD.slice().buffer, "")).toBe(false);
  });
});

describe("subscribeToPush after a rotation", () => {
  it("replaces a subscription made with the old key and forgets its row", async () => {
    const stale = fakeSubscription("https://push.example/old", OLD);
    const { subscribed } = installBrowser(stale);
    const { subscribeToPush } = await loadPush();

    const out = await subscribeToPush();

    expect(out).toEqual({ ok: true, endpoint: "https://push.example/new" });
    expect(stale.unsubscribed).toBe(true);
    expect(calls.deleted).toEqual(["https://push.example/old"]);
    expect(subscribed.map(toBase64Url)).toEqual([toBase64Url(NEW)]);
    expect(calls.upserted).toEqual(["https://push.example/new"]);
  });

  it("reuses a subscription already made with this key", async () => {
    const current = fakeSubscription("https://push.example/current", NEW);
    const { subscribed } = installBrowser(current);
    const { subscribeToPush } = await loadPush();

    const out = await subscribeToPush();

    expect(out).toEqual({ ok: true, endpoint: "https://push.example/current" });
    expect(current.unsubscribed).toBe(false);
    expect(calls.deleted).toEqual([]);
    expect(subscribed).toEqual([]);
    expect(calls.upserted).toEqual(["https://push.example/current"]);
  });
});
