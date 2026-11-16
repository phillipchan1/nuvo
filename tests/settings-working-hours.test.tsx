/** @vitest-environment jsdom */
/**
 * Working hours could be saved inverted — a start after the end — and every
 * surface that proposes blocks "inside" them then had no day at all. The
 * inverted half is refused and the field goes back to what was saved.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (m: string) => toastError(m), success: vi.fn() }) }));
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

describe("Settings → Schedule · Working hours", () => {
  const settings = { work_start_minutes: 540, work_end_minutes: 1020 } as unknown as UserSettings;
  const open = () => {
    mobile = false;
    const update = vi.fn();
    render(<SettingsModal settings={settings} updateSettings={update} accounts={[]} section="schedule" onClose={() => {}} />);
    return update;
  };
  const set = (label: string, hhmm: string) => {
    const field = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(field, { target: { value: hhmm } });
    fireEvent.blur(field);
    return field;
  };

  it("a start after the end is refused, and the field goes back", () => {
    const update = open();
    const start = set("Working hours start", "18:00");
    expect(update).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
    expect(start.value).toBe("09:00");
  });

  it("an end before the start is refused", () => {
    const update = open();
    const end = set("Working hours end", "08:30");
    expect(update).not.toHaveBeenCalled();
    expect(end.value).toBe("17:00");
  });

  it("a start equal to the end is refused — the day would be empty", () => {
    const update = open();
    set("Working hours start", "17:00");
    expect(update).not.toHaveBeenCalled();
  });

  it("a real range still saves", () => {
    const update = open();
    set("Working hours start", "08:00");
    expect(update).toHaveBeenCalledWith({ work_start_minutes: 480 });
    set("Working hours end", "18:30");
    expect(update).toHaveBeenCalledWith({ work_end_minutes: 1110 });
  });
});
