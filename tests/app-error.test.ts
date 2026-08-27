/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { formatAppError, formatAppErrorSync, readErrorLog, clearErrorLog, reportAppError, resetReportThrottle } from "../src/lib/appError";

describe("formatAppErrorSync", () => {
  it("keeps a real Error message", () => {
    expect(formatAppErrorSync(new Error("Not signed in")).message).toBe("Not signed in");
  });

  it("does not dump a generic 'Something went wrong' for a string", () => {
    expect(formatAppErrorSync("Calendar account not found").message).toBe("Calendar account not found");
  });

  it("surfaces PostgREST code and details", () => {
    const err = Object.assign(new Error("column domains.foo does not exist"), {
      code: "42703",
      details: null,
    });
    const out = formatAppErrorSync(err);
    expect(out.message).toContain("column domains.foo");
    expect(out.detail).toContain("42703");
  });

  it("names a missing edge function instead of the generic non-2xx line", () => {
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: { status: 404, url: "https://example.supabase.co/functions/v1/delete-account" },
    });
    const out = formatAppErrorSync(err);
    expect(out.message).toBe("delete-account isn't deployed on the server.");
  });
});

describe("formatAppError", () => {
  it("lifts the JSON body off a FunctionsHttpError", async () => {
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: {
        status: 400,
        url: "https://example.supabase.co/functions/v1/google-events",
        json: async () => ({ error: "start_at and end_at required" }),
      },
    });
    const out = await formatAppError(err);
    expect(out.message).toBe("start_at and end_at required");
    expect(out.detail).toContain("google-events");
  });
});

describe("reportAppError repeat throttle", () => {
  // Node 22 puts its own (here, unbacked) `localStorage` on globalThis, which
  // shadows jsdom's for a bare `localStorage.*` reference. Give the error log a
  // real store so this suite can assert on what it actually keeps.
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: () => null,
        length: 0,
      },
    });
    resetReportThrottle();
    clearErrorLog();
  });

  it("says a timer-driven failure once, not on every refetch", async () => {
    const said: string[] = [];
    const fail = () =>
      reportAppError(Object.assign(new Error("column subscriptions.plan does not exist"), { code: "42703" }), {
        source: "subscription",
        repeatAfterMs: 60_000,
        toast: (m) => said.push(m),
      });
    // What a 5s refetchInterval against a permanent fault actually does.
    for (let i = 0; i < 12; i += 1) await fail();
    expect(said).toHaveLength(1);
    // ...and one line in the log, not twelve copies evicting everything else.
    expect(readErrorLog()).toHaveLength(1);
  });

  it("still speaks the moment the failure changes", async () => {
    const said: string[] = [];
    const report = (message: string) =>
      reportAppError(new Error(message), {
        source: "subscription",
        repeatAfterMs: 60_000,
        toast: (m) => said.push(m),
      });
    await report("column subscriptions.plan does not exist");
    await report("column subscriptions.plan does not exist");
    await report("Couldn't verify your subscription");
    expect(said).toEqual([
      "column subscriptions.plan does not exist",
      "Couldn't verify your subscription",
    ]);
  });

  it("throttles per source, so one broken query never mutes another", async () => {
    const said: string[] = [];
    const report = (source: string) =>
      reportAppError(new Error("boom"), { source, repeatAfterMs: 60_000, toast: (m) => said.push(m) });
    await report("subscription");
    await report("subscription");
    await report("external_events");
    expect(said).toHaveLength(2);
  });

  it("does not throttle at all without repeatAfterMs — a tap deserves an answer every time", async () => {
    const said: string[] = [];
    const report = () =>
      reportAppError(new Error("Could not save"), { source: "task-update", toast: (m) => said.push(m) });
    await report();
    await report();
    expect(said).toHaveLength(2);
  });
});
