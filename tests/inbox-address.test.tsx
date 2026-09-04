/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

describe("Settings → Apps & devices", () => {
  it("does not bury the forwarding address under HTTP tokens", () => {
    const { container } = wrap(<AppsDevicesPane />);
    expect(container.textContent).not.toContain("@inbox.nuvo.day");
    expect(screen.getByText("Apps & devices")).toBeTruthy();
  });

  it("is an inventory, not a Grok tutorial — wiring sits behind Next steps", () => {
    wrap(<AppsDevicesPane />);
    expect(screen.getByText("Next steps")).toBeTruthy();
    expect(screen.queryByText("Wire Grok Bot")).toBeNull();
    expect(screen.getByRole("radio", { name: /Full account/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Inbox/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create token/i })).toBeTruthy();
  });
});
