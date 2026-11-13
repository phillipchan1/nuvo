// @vitest-environment jsdom
/**
 * The Mac app's collapsed sidebar and the traffic lights.
 *
 * AppKit draws the window buttons at fixed points over the sidebar; the
 * cluster ends at 76pt, which a 52px rail can't hold. Dropping the panel
 * below a title-bar band wasted the top of the window, and widening the rail
 * for them looked wrong. So the rail stays 52px everywhere, and with the
 * sidebar shut the lights move into the panel's top-left corner — 16px in,
 * centred on its 48px top row — where the page bar (or the Schedule's rail)
 * starts after them (frame.css, --lights-room).
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

async function mountSpine(opts: { mac: boolean; railed?: boolean; zoom?: number }) {
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
            <Spine rung="day" setRung={() => {}} openSettings={() => {}} openShortcuts={() => {}} />
            <div className="app-panel" />
          </AgentProvider>
        </AppNavigationProvider>
      </VerticalStoreProvider>
    </QueryClientProvider>,
  );
  return view.container;
}

/** jsdom has no layout: hand the rail and the panel the rects the app has —
 *  the rail at `railW` (mid-slide if it isn't 52 yet), the panel right after
 *  it, 8px down. */
function layout(railW: number) {
  const rect = (left: number, top: number, width: number) =>
    ({ left, top, width, height: 800, right: left + width, bottom: top + 800, x: left, y: top, toJSON() {} }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("spine")) return rect(0, 0, railW);
    if (this.classList.contains("app-panel")) return rect(railW, 8, 1148);
    return rect(0, 0, 0);
  });
}

async function settled() {
  // the call goes through a dynamic import
  await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
}

describe("the collapsed sidebar and the Mac traffic lights", () => {
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

  it("stays 52px in the Mac app too — the lights move instead", async () => {
    const c = await mountSpine({ mac: true });
    expect((c.querySelector(".spine") as HTMLElement).style.width).toBe("52px");
  });

  it("puts the lights in the panel's corner, centred on its top row", async () => {
    layout(52);
    await mountSpine({ mac: true });
    await settled();
    // 16px into the panel; the 48px row's middle, 24px below its top.
    expect(invoke).toHaveBeenLastCalledWith("align_traffic_lights", { x: 68, centerY: 32 });
  });

  it("aims at where the panel ends up, not where it is mid-slide", async () => {
    // The rail is still 220px wide when the toggle lands (a window behind
    // others doesn't run the transition): the corner is still 68.
    layout(220);
    await mountSpine({ mac: true });
    await settled();
    expect(invoke).toHaveBeenLastCalledWith("align_traffic_lights", { x: 68, centerY: 32 });
  });

  it("converts to window points when the app is zoomed", async () => {
    layout(52);
    await mountSpine({ mac: true, zoom: 0.8 });
    await settled();
    const [, args] = invoke.mock.lastCall as unknown as [string, { x: number; centerY: number }];
    expect(args.x).toBeCloseTo(68 * 0.8);
    expect(args.centerY).toBeCloseTo(32 * 0.8);
  });

  it("leaves them at rest, on the wordmark's line, with the sidebar open", async () => {
    // jsdom has no layout: the wordmark's glyphs start 16px in, as in the app.
    const measure = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => ({ left: 16 }) as DOMRect;
    try {
      await mountSpine({ mac: true, railed: false });
      await settled();
      expect(invoke).toHaveBeenLastCalledWith("align_traffic_lights", { x: 16, centerY: null });
    } finally {
      Range.prototype.getBoundingClientRect = measure;
    }
  });
});
