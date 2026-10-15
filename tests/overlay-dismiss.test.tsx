// @vitest-environment jsdom
/**
 * An overlay can always be dismissed — ⌘K was a trap that wasn't.
 *
 * Overlays are history-backed: closing one is `history.back()`. That assumed the
 * entry before the overlay is one step back. It isn't once anything navigates
 * while the overlay is up (⌘J opening the chat pushes an entry that still says
 * `overlay: "cmd"`): Esc stepped onto the overlay again, QuickAdd's close-once
 * latch had already fired, and from then on every Escape and every scrim click
 * was swallowed — an unclosable modal over the whole app.
 *
 * These drive the real navigation store and the real QuickAdd, not a mocked
 * `onClose` (capture-door.test.tsx mocks it, which is why this was never seen).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import QuickAdd from "../src/components/capture/QuickAdd";
import { AppNavigationProvider, useAppNavigation } from "../src/hooks/useAppNavigation";
import { TaskCaptureSinkContext, type TaskCaptureSink } from "../src/hooks/useTaskCapture";
import { NAV_STACK_INDEX_KEY } from "../src/lib/appNav";
import { nlpReady } from "../src/lib/nlp";

beforeAll(async () => {
  await nlpReady;
});

type Nav = ReturnType<typeof useAppNavigation>;
let nav: Nav;
function Probe() {
  nav = useAppNavigation();
  return null;
}

const stackIndex = () => (history.state as Record<string, number> | null)?.[NAV_STACK_INDEX_KEY];

beforeEach(() => {
  history.replaceState(null, "");
});

function mountNav() {
  return render(
    <AppNavigationProvider>
      <Probe />
    </AppNavigationProvider>,
  );
}

describe("closing an overlay that was navigated over", () => {
  it("lifts it, keeps what the user did meanwhile, and strands no entry showing it", async () => {
    mountNav();
    const base = stackIndex() ?? 0;
    const agentBefore = nav.nav.agentOpen;

    act(() => nav.openOverlay("cmd"));
    act(() => nav.toggleAgent());
    expect(nav.nav.overlay).toBe("cmd");
    expect(nav.nav.agentOpen).toBe(!agentBefore);

    act(() => nav.closeOverlay());
    await waitFor(() => expect(nav.nav.overlay).toBe("none"));
    // The chat they opened is theirs — closing ⌘K must not close it.
    expect(nav.nav.agentOpen).toBe(!agentBefore);
    expect(stackIndex()).toBe(base + 1);

    // …and Back from here is the page, not the overlay again.
    act(() => nav.back());
    await waitFor(() => expect(stackIndex()).toBe(base));
    expect(nav.nav.overlay).toBe("none");
    expect(nav.nav.agentOpen).toBe(agentBefore);
  });

  it("steps straight onto the page when nothing else changed", async () => {
    mountNav();
    const base = stackIndex() ?? 0;
    const agentBefore = nav.nav.agentOpen;

    act(() => nav.openOverlay("cmd"));
    act(() => nav.toggleAgent());
    act(() => nav.toggleAgent());
    expect(nav.nav.agentOpen).toBe(agentBefore);

    act(() => nav.closeOverlay());
    await waitFor(() => expect(nav.nav.overlay).toBe("none"));
    expect(stackIndex()).toBe(base);
  });

  it("is still one step back for an overlay nothing was pushed over", async () => {
    mountNav();
    const base = stackIndex() ?? 0;
    act(() => nav.openOverlay("settings"));
    act(() => nav.closeOverlay());
    await waitFor(() => expect(nav.nav.overlay).toBe("none"));
    expect(stackIndex()).toBe(base);
  });
});

describe("⌘K quick add, through the real navigation store", () => {
  const sink: TaskCaptureSink = {
    create: async () => {},
    createSeries: async () => {},
    createSlot: () => {},
    createSlotSeries: async () => {},
  };

  function mount(onClose?: () => void) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Door() {
      const { nav: n, closeOverlay } = useAppNavigation();
      return n.overlay === "cmd" ? <QuickAdd onClose={onClose ?? closeOverlay} /> : null;
    }
    render(
      <QueryClientProvider client={qc}>
        <TaskCaptureSinkContext.Provider value={sink}>
          <AppNavigationProvider>
            <Probe />
            <Door />
          </AppNavigationProvider>
        </TaskCaptureSinkContext.Provider>
      </QueryClientProvider>,
    );
  }
  const field = () => screen.getByLabelText("Capture a task, event or slot");

  it("Escape closes it after the chat was toggled over it", async () => {
    mount();
    act(() => nav.openOverlay("cmd"));
    await screen.findByRole("dialog");
    act(() => nav.toggleAgent());

    await act(async () => {
      fireEvent.keyDown(field(), { key: "Escape" });
    });
    await waitFor(() => expect(nav.nav.overlay).toBe("none"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a close that didn't take doesn't latch the door shut", async () => {
    const onClose = vi.fn(); // the host keeps it mounted — the failure we guard against
    mount(onClose);
    act(() => nav.openOverlay("cmd"));
    await screen.findByRole("dialog");

    await act(async () => {
      fireEvent.keyDown(field(), { key: "Escape" });
    });
    // Latched while the first close is in flight: an add + a stray Escape is one back().
    await act(async () => {
      fireEvent.keyDown(field(), { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Still here once the navigation has settled → the next Escape must be heard.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    await act(async () => {
      fireEvent.keyDown(field(), { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
