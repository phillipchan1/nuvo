/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import SettingsModal from "../src/components/SettingsModal";
import ReconnectBanner from "../src/components/ReconnectBanner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

beforeAll(() => {
  vi.stubGlobal("__APP_VERSION__", "0.1.0");
});

let mobile = false;

vi.mock("../src/hooks/useIsMobile", () => ({
  useIsMobile: () => mobile,
}));

vi.mock("../src/hooks/useAppNavigation", () => ({
  useAppNavigation: () => ({ setSettingsSection: vi.fn() }),
}));

vi.mock("../src/hooks/useVertical", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hooks/useVertical")>();
  return { ...actual, useVertical: () => ({ data: { domains: [] } }) };
});

vi.mock("../src/hooks/useOrientation", () => ({
  useOrientation: () => ({ open: vi.fn() }),
}));

vi.mock("../src/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/platform")>();
  return { ...actual, isDesktopTauri: () => false };
});

vi.mock("../src/components/SyncPanel", () => ({
  default: () => <div>Sync</div>,
}));

vi.mock("../src/lib/changelog", () => ({
  loadChangelog: async () => [],
  isMinor: () => false,
  notableNotes: (notes: string | null) => notes,
}));

vi.mock("../src/lib/devtools", () => ({
  useDeveloperMode: () => [false, vi.fn()],
  openDevTools: vi.fn(),
}));

vi.mock("../src/lib/appError", () => ({
  useErrorLog: () => [],
  clearErrorLog: vi.fn(),
  formatErrorLog: () => "",
}));

vi.mock("../src/lib/installPrompt", () => ({
  canPromptInstall: () => false,
  isIOS: () => false,
  isStandaloneDisplay: () => true,
  onInstallAvailabilityChange: () => () => {},
  promptInstall: vi.fn(),
}));

vi.mock("../src/components/mobile/Sheet", () => ({
  default: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
}));

import type { CalendarAccount, UserSettings } from "../src/lib/types";

// Microsoft 365 was removed as a calendar feature (the Azure app was never
// carried to Cloudflare). A leftover m365 account keeps its data and can be
// disconnected, but nothing offers to connect or reconnect one.
const m365: CalendarAccount = {
  id: "acc-m365",
  provider: "m365",
  email: "old@corp.example",
  sync_direction: "read_only",
  calendars: [],
  mirror_calendar_id: null,
  needs_reconnect: true,
};

function renderCalendars(accounts: CalendarAccount[]) {
  mobile = false;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsModal
        settings={{} as unknown as UserSettings}
        updateSettings={() => {}}
        accounts={accounts}
        section="connections"
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("Microsoft 365 is not offered", () => {
  it("Settings has no Connect Microsoft 365 button", () => {
    renderCalendars([]);
    expect(screen.getByRole("button", { name: "Connect Google" })).toBeTruthy();
    expect(screen.queryByText(/Connect Microsoft 365/)).toBeNull();
  });

  it("a leftover m365 account can be disconnected but not reconnected", () => {
    renderCalendars([m365]);
    expect(screen.getByText("old@corp.example")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(screen.queryByText(/Connect Microsoft 365/)).toBeNull();
  });

  it("the reconnect banner skips an m365 account", () => {
    const { container } = render(<ReconnectBanner accounts={[m365]} />);
    expect(container.textContent).toBe("");
    render(
      <ReconnectBanner
        accounts={[
          m365,
          { ...m365, id: "g", provider: "google", email: "me@g.example" },
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Reconnect Google" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Microsoft 365/)).toBeNull();
  });
});
