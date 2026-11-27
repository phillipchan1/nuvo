/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppsDevicesPane } from "../src/components/AppsDevicesPane";
import { InboxAddressPane } from "../src/components/InboxAddress";

vi.mock("../src/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { inbound_token: "a1b2c3d4e5f6" },
    isLoading: false,
    update: vi.fn(),
  }),
}));

vi.mock("../src/hooks/useNotion", () => ({
  useNotionSource: () => ({ data: null, isLoading: false }),
  useNotionActions: () => ({}),
  startNotionConnect: vi.fn(),
}));

vi.mock("../src/lib/supabase", () => ({
  supabaseUrl: "http://localhost",
  supabaseAnonKey: "anon",
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    rpc: vi.fn(),
  },
}));

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("Settings → Inbox address", () => {
  it("shows the forwarding address and does not invent a second inbox", () => {
    wrap(<InboxAddressPane />);
    expect(screen.getByText("Inbox address")).toBeTruthy();
    expect(screen.getByText("a1b2c3d4e5f6@inbox.nuvo.day")).toBeTruthy();
    expect(screen.getByText(/subject becomes an inbox task/i)).toBeTruthy();
    expect(screen.queryByText(/imperative action/i)).toBeNull();
  });
});

describe("Settings → Apps & devices (D-258)", () => {
  it("lists what's connected, grouped by what it can do — one line each", async () => {
    wrap(<AppsDevicesPane />);
    expect(screen.getByText("Apps & devices")).toBeTruthy();
    // The inbox address is a door into the inbox, so it lives here now — as a row.
    expect(await screen.findByText("a1b2c3d4e5f6@inbox.nuvo.day")).toBeTruthy();
    expect(screen.getByText("Inbox")).toBeTruthy();
    // An inventory, not a form: no key form or doorbell on the list.
    expect(screen.queryByRole("button", { name: /Create key/i })).toBeNull();
    expect(screen.queryByPlaceholderText(/Doorbell/i)).toBeNull();
    expect(screen.queryByText("Wire Grok Bot")).toBeNull();
  });

  it("adds through one door: an agent, a device, or Notion", async () => {
    wrap(<AppsDevicesPane />);
    fireEvent.click(await screen.findByText("Add"));
    expect(screen.getByText("An agent or app")).toBeTruthy();
    expect(screen.getByText("A device or shortcut")).toBeTruthy();
    expect(screen.getByText("Notion")).toBeTruthy();
    fireEvent.click(screen.getByText("An agent or app"));
    expect(screen.getByRole("button", { name: /Create key/i })).toBeTruthy();
  });

  it("opens straight on a page when a deep link names one", () => {
    wrap(<AppsDevicesPane start="address" />);
    expect(screen.getByText("Get a new address")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Apps & devices/i })).toBeTruthy();
  });
});
