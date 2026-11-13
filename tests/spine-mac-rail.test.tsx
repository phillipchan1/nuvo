// @vitest-environment jsdom
/**
 * The Mac app's collapsed sidebar holds the traffic lights.
 *
 * AppKit draws the window buttons at fixed points over the sidebar; the
 * cluster ends near 70pt. A 52px rail put the green light on the panel's
 * corner, and dropping the panel below a title-bar band wasted the top of the
 * window. So in the Mac app (html.tauri-macos) the rail is as wide as the
 * lights need — 84pt, converted for the app's zoom — and on the web, where
 * there are no lights, it stays 52px.
 */
import { render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// This jsdom build has no Storage; the sidebar and the zoom read localStorage.
const mem = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  },
});

async function railWidth(opts: { mac: boolean; zoom?: number }): Promise<string> {
  vi.resetModules();
  localStorage.setItem("nuvo-spine-rail", "1");
  if (opts.zoom) localStorage.setItem("nuvo.uiScale", String(opts.zoom));
  document.documentElement.classList.toggle("tauri-macos", opts.mac);
  const { default: Spine } = await import("../src/components/Spine");
  const { VerticalStoreProvider } = await import("../src/hooks/useVertical");
  const { AppNavigationProvider } = await import("../src/hooks/useAppNavigation");
  const { AgentProvider } = await import("../src/hooks/useAgentContext");
  const store = { data: { domains: [], initiatives: [], projects: [], tasks: [], sprint: null } } as never;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <VerticalStoreProvider value={store}>
        <AppNavigationProvider>
          <AgentProvider>
            <Spine rung="day" setRung={() => {}} openSettings={() => {}} openShortcuts={() => {}} />
          </AgentProvider>
        </AppNavigationProvider>
      </VerticalStoreProvider>
    </QueryClientProvider>,
  );
  return (container.querySelector(".spine") as HTMLElement).style.width;
}

describe("the collapsed sidebar and the Mac traffic lights", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => document.documentElement.classList.remove("tauri-macos"));

  it("stays 52px on the web", async () => {
    expect(await railWidth({ mac: false })).toBe("52px");
  });

  it("is wide enough for the lights in the Mac app", async () => {
    expect(await railWidth({ mac: true })).toBe("84px");
  });

  it("is sized in points, so it still holds them when the app is zoomed out", async () => {
    // 84pt at 80% zoom is 105 css px.
    expect(await railWidth({ mac: true, zoom: 0.8 })).toBe("105px");
  });
});
