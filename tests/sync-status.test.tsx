// @vitest-environment jsdom
/**
 * The "top header flash" regression: SyncStatus sits in normal flow above
 * everything else in the shell, so mounting/unmounting it shifts the whole
 * app. Every task/slot drag fires exactly one queued write, which drains
 * within a beat while online — showing the bar live for that blink was the
 * whole app shoving down and back up on every drag. Only a hold worth
 * telling the user about (parked, offline, or a sync still going after a
 * beat) should ever mount it.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockStatus {
  pending: number;
  parked: number;
  syncing: boolean;
  durable: boolean;
}

const outboxState: { status: MockStatus; online: boolean } = {
  status: { pending: 0, parked: 0, syncing: false, durable: true },
  online: true,
};

vi.mock("../src/hooks/useOnline", () => ({
  useOnline: () => outboxState.online,
}));
vi.mock("../src/hooks/useOutbox", async () => {
  const actual = await vi.importActual<typeof import("../src/hooks/useOutbox")>(
    "../src/hooks/useOutbox",
  );
  return { ...actual, useOutbox: () => outboxState.status };
});
vi.mock("../src/lib/sync", () => ({
  discard: vi.fn(),
  parkedOps: vi.fn(async () => []),
  syncNowIfConfigured: vi.fn(async () => {}),
  unpark: vi.fn(async () => {}),
}));

const { default: SyncStatus } = await import("../src/components/SyncStatus");

function setStatus(patch: Partial<MockStatus>) {
  outboxState.status = { ...outboxState.status, ...patch };
}

beforeEach(() => {
  outboxState.status = { pending: 0, parked: 0, syncing: false, durable: true };
  outboxState.online = true;
});

describe("SyncStatus — debounced so a fast drain never flashes the bar", () => {
  it("stays silent for a write that drains within the debounce window", async () => {
    const { rerender } = render(<SyncStatus />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => setStatus({ pending: 1 }));
    rerender(<SyncStatus />);
    // Not immediately — this is the exact call that used to shove the app down.
    expect(screen.queryByRole("status")).toBeNull();

    await new Promise((r) => setTimeout(r, 150)); // well inside the debounce window
    act(() => setStatus({ pending: 0 }));
    rerender(<SyncStatus />);

    await new Promise((r) => setTimeout(r, 350)); // past the window, drain already resolved
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a hold that outlasts the debounce window", async () => {
    const { rerender } = render(<SyncStatus />);
    act(() => setStatus({ pending: 1, syncing: true }));
    rerender(<SyncStatus />);
    expect(screen.queryByRole("status")).toBeNull();

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument(), {
      timeout: 1000,
    });
    expect(screen.getByRole("status").textContent).toContain("Syncing");
  });

  it("shows a parked op immediately — never worth debouncing", async () => {
    const { rerender } = render(<SyncStatus />);
    act(() => setStatus({ parked: 1 }));
    rerender(<SyncStatus />);

    expect(screen.getByRole("status").textContent).toContain("couldn't be saved");
  });

  it("shows the offline state immediately", async () => {
    const { rerender } = render(<SyncStatus />);
    act(() => {
      outboxState.online = false;
      setStatus({ pending: 1 });
    });
    rerender(<SyncStatus />);

    expect(screen.getByRole("status").textContent).toContain("Offline");
  });
});
