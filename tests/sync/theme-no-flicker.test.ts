/**
 * Light → dark must not bounce back to light on the way.
 *
 * The report: flip the theme and for a second it went back to the old one, then
 * settled. That is a read from before the flip landing over it — the same race
 * `holdFetchesBehindWrite` exists for on tasks and slots, which `patchSettings`
 * never called. The preference is also the one value the user's hand has just
 * chosen, so the page paints that choice itself until the cache agrees with it
 * (`chosenTheme`), whatever the cache does in between.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      throw new Error("no table reads in this suite");
    },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}));

const { resetIdbForTests } = await import("../../src/lib/sync/idb");
const { resetDeliveryForTests } = await import("../../src/lib/sync/outbox");
const coordinator = await import("../../src/lib/sync/coordinator");
const { patchSettings, SETTINGS_KEY, chosenTheme, settleChosenTheme, reconcileChosenTheme, effectiveTheme } = await import(
  "../../src/hooks/useSettings"
);
import type { UserSettings } from "../../src/lib/types";

const light = { user_id: "u", theme: "light" } as UserSettings;
const themeOf = (qc: QueryClient) => qc.getQueryData<UserSettings>(SETTINGS_KEY)?.theme;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetDeliveryForTests();
  coordinator.resetOwingForTests();
  await coordinator.refreshOwing();
  settleChosenTheme();
});

describe("a settings read already in flight when the theme is flipped", () => {
  it("does not put the old theme back", async () => {
    const qc = new QueryClient();
    coordinator.installOwingGuards(qc);
    qc.setQueryData(SETTINGS_KEY, light);

    // A focus catch-up reads settings (still "light")…
    const server = deferred<UserSettings>();
    const read = qc.fetchQuery({ queryKey: SETTINGS_KEY, queryFn: () => server.promise, staleTime: 0 });

    // …and the user flips to dark before it answers.
    patchSettings(qc, { theme: "dark" });
    expect(themeOf(qc)).toBe("dark");

    server.resolve(light);
    await read;

    expect(themeOf(qc)).toBe("dark");
  });
});

describe("the theme the page paints", () => {
  it("is the one just chosen, even if the cache is briefly handed the old one", () => {
    const qc = new QueryClient();
    coordinator.installOwingGuards(qc);
    qc.setQueryData(SETTINGS_KEY, light);

    patchSettings(qc, { theme: "dark" });
    // Something repaints the stale row (an echo of an earlier write, a replica
    // that has not caught up, a persisted snapshot):
    qc.setQueryData(SETTINGS_KEY, light);

    expect(effectiveTheme(themeOf(qc), false)).toBe("dark");
  });

  it("lets go once the cache agrees, so another device can change it", () => {
    const qc = new QueryClient();
    qc.setQueryData(SETTINGS_KEY, light);
    patchSettings(qc, { theme: "dark" });
    expect(chosenTheme()).toBe("dark");

    // The server row arrives saying dark: the choice is confirmed and retired.
    reconcileChosenTheme("dark");
    expect(effectiveTheme("dark", false)).toBe("dark");
    expect(chosenTheme()).toBeNull();

    // Now another device flips it to light: that one must show.
    expect(effectiveTheme("light", false)).toBe("light");
  });

  it("gives up on a choice the server never confirms", () => {
    vi.useFakeTimers();
    try {
      const qc = new QueryClient();
      qc.setQueryData(SETTINGS_KEY, light);
      patchSettings(qc, { theme: "dark" });
      vi.advanceTimersByTime(60_000);
      expect(effectiveTheme("light", false)).toBe("light");
    } finally {
      vi.useRealTimers();
    }
  });

  it("system still follows the OS", () => {
    expect(effectiveTheme("system", true)).toBe("dark");
    expect(effectiveTheme(undefined, false)).toBe("light");
  });
});
