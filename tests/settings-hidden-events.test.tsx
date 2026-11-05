/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import SettingsModal from "../src/components/SettingsModal";

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

import type { UserSettings } from "../src/lib/types";

// The way back from Hide (D-176): the phone filters hidden events off every
// calendar it draws, so Settings → Schedule is where they're named and shown.
describe("Settings → Schedule · Hidden events", () => {
  const settings = {
    hidden_events: [
      { key: "acc:pe-1", title: "Thanksgiving" },
      { key: "acc:series:abc", title: "Weekly 1:1" },
    ],
  } as unknown as UserSettings;

  it("lists each hidden event and shows it again", () => {
    mobile = false;
    const update = vi.fn();
    render(
      <SettingsModal settings={settings} updateSettings={update} accounts={[]} section="schedule" onClose={() => {}} />,
    );
    expect(screen.getByText("Hidden events")).toBeTruthy();
    expect(screen.getByText("Thanksgiving")).toBeTruthy();
    expect(screen.getByText("Every event in the series")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Show" })[0]);
    expect(update).toHaveBeenCalledWith({ hidden_events: [{ key: "acc:series:abc", title: "Weekly 1:1" }] });
  });

  it("says nothing when nothing is hidden", () => {
    mobile = false;
    render(
      <SettingsModal
        settings={{ hidden_events: [] } as unknown as UserSettings}
        updateSettings={() => {}}
        accounts={[]}
        section="schedule"
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText("Hidden events")).toBeNull();
  });
});
