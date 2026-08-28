/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const mount = () =>
  render(
    <SettingsModal
      settings={undefined}
      updateSettings={() => {}}
      accounts={[]}
      section="about"
      onClose={() => {}}
    />,
  );

describe("Settings → About · Download for Mac", () => {
  it("offers the DMG on a desktop browser", () => {
    mobile = false;
    mount();
    expect(screen.getByText("Download for Mac")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "https://github.com/phillipchan1/nuvo-releases/releases/latest/download/Nuvo.dmg",
    );
  });

  it("hides the DMG on the phone — About is version, not a Mac installer", async () => {
    mobile = true;
    const user = userEvent.setup();
    mount();
    // The phone starts on the section list even when seeded at About.
    expect(screen.queryByText("Download for Mac")).toBeNull();
    await user.click(screen.getByRole("button", { name: /About/ }));
    expect(screen.getByText(/held in one calm place/)).toBeTruthy();
    expect(screen.queryByText("Download for Mac")).toBeNull();
    expect(screen.queryByRole("link", { name: "Download" })).toBeNull();
  });
});
