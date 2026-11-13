// @vitest-environment jsdom
/**
 * The Mac app's collapsed sidebar and the traffic lights.
 *
 * AppKit draws the window buttons at fixed points over the sidebar; the
 * cluster ends at 76pt, which a 52px rail can't hold. A band over the panel
 * wasted the top of the window, a wider rail looked wrong, and moving them
 * into the panel's corner still read as odd. So the rail stays 52px and, with
 * the sidebar railed or hidden, the buttons are hidden (⌘W / ⌘M still work).
 * Open, they rest on the wordmark's edge.
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

const invoke = vi.fn(async () => undefined);

async function mountSpine(opts: { mac: boolean; railed?: boolean; zoom?: number; collapsed?: boolean; overlaid?: boolean }) {
  vi.resetModules();
  vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
  if (opts.railed ?? true) localStorage.setItem("nuvo-spine-rail", "1");
  if (opts.zoom) localStorage.setItem("nuvo.uiScale", String(opts.zoom));
  document.documentElement.classList.toggle("tauri-macos", opts.mac);
  if (opts.mac) (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  const { default: Spine } = await import("../src/components/Spine");
  const { VerticalStoreProvider } = await import("../src/hooks/useVertical");
  const { AppNavigationProvider } = await import("../src/hooks/useAppNavigation");
  const { AgentProvider } = await import("../src/hooks/useAgentContext");
  const store = { data: { domains: [], initiatives: [], projects: [], tasks: [], sprint: null } } as never;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <VerticalStoreProvider value={store}>
        <AppNavigationProvider>
          <AgentProvider>
            <Spine rung="day" setRung={() => {}} openSettings={() => {}} openShortcuts={() => {}} collapsed={opts.collapsed} overlaid={opts.overlaid} />
            <div className="app-panel" />
          </AgentProvider>
        </AppNavigationProvider>
      </VerticalStoreProvider>
    </QueryClientProvider>,
  );
  return view.container;
}

async function settled() {
  // the call goes through a dynamic import
  await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
}

// Each case re-imports the sidebar from scratch (vi.resetModules), which is slow
// cold on a busy machine.
describe("the collapsed sidebar and the Mac traffic lights", { timeout: 20_000 }, () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove("tauri-macos");
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    document.body.innerHTML = "";
  });

  it("stays 52px on the web", async () => {
    const c = await mountSpine({ mac: false });
    expect((c.querySelector(".spine") as HTMLElement).style.width).toBe("52px");
  });

  it("stays 52px in the Mac app too — the lights go instead", async () => {
    const c = await mountSpine({ mac: true });
    expect((c.querySelector(".spine") as HTMLElement).style.width).toBe("52px");
  });

  it("hides the lights while the sidebar is railed", async () => {
    await mountSpine({ mac: true });
    await settled();
    // Never measured (a cold start railed): AppKit's own 16pt, for when they return.
    expect(invoke).toHaveBeenLastCalledWith("align_traffic_lights", { x: 16, hidden: true });
  });

  it("hides them while focus mode has the sidebar shut", async () => {
    await mountSpine({ mac: true, railed: false, collapsed: true });
    await settled();
    expect(invoke).toHaveBeenLastCalledWith("align_traffic_lights", { x: 16, hidden: true });
  });

  it("shows them, at rest, under a full-screen flow even with the sidebar railed", async () => {
    await mountSpine({ mac: true, overlaid: true });
    await settled();
    expect(invoke).toHaveBeenLastCalledWith("align_traffic_lights", { x: 16, hidden: false });
  });

  it("rests them on the wordmark's edge with the sidebar open, in window points", async () => {
    // jsdom has no layout: the wordmark's glyphs start 16px in, as in the app.
    const measure = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => ({ left: 16 }) as DOMRect;
    try {
      await mountSpine({ mac: true, railed: false, zoom: 0.8 });
      await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith("align_traffic_lights", { x: 12.8, hidden: false }));
    } finally {
      Range.prototype.getBoundingClientRect = measure;
    }
  });
});
