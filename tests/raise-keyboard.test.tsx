// @vitest-environment jsdom
/**
 * Capture / chat / search all land the caret through one hook, and a sheet
 * must not steal that landing to ✕. The lock-screen ＋ opens the sheet with
 * no webview gesture; if focus starts on Close, iOS then ignores the input.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogFocus } from "../src/hooks/useDialogFocus";
import { useRaiseKeyboard } from "../src/hooks/useRaiseKeyboard";
import { todayISO } from "../src/lib/dates";
import QuickTaskSheet from "../src/components/mobile/QuickTaskSheet";

function RaiseHost() {
  const ref = useRef<HTMLInputElement>(null);
  useRaiseKeyboard(ref);
  return <input ref={ref} aria-label="field" />;
}

function DialogHost({ withField = true }: { withField?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef);
  return (
    <div ref={panelRef} role="dialog" tabIndex={-1}>
      <button type="button">Close</button>
      {withField && <input aria-label="field" />}
    </div>
  );
}

describe("one hook, not three timers", () => {
  it("capture, chat, and search all call useRaiseKeyboard", () => {
    const src = join(__dirname, "..", "src", "components", "mobile");
    for (const file of ["QuickTaskSheet.tsx", "ChatPane.tsx", "MobileSearch.tsx"]) {
      const text = readFileSync(join(src, file), "utf8");
      expect(text, file).toContain("useRaiseKeyboard");
      expect(text, file).not.toMatch(/setTimeout\(\(\) => \w+\.current\?\.focus/);
    }
  });
});

describe("useRaiseKeyboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("focuses immediately so a parent dialog cannot steal to ✕ first", () => {
    render(<RaiseHost />);
    expect(screen.getByLabelText("field")).toHaveFocus();
  });

  it("retries at 120ms after the sheet has started to rise", () => {
    render(<RaiseHost />);
    screen.getByLabelText("field").blur();
    expect(screen.getByLabelText("field")).not.toHaveFocus();
    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(screen.getByLabelText("field")).not.toHaveFocus();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByLabelText("field")).toHaveFocus();
  });

  it("lingers after 120ms so a late webview first-responder still lands", () => {
    render(<RaiseHost />);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    screen.getByLabelText("field").blur();
    act(() => {
      vi.advanceTimersByTime(280);
    });
    expect(screen.getByLabelText("field")).toHaveFocus();
  });

  it("does not steal focus the user has already moved to another control", () => {
    function SheetHost() {
      const ref = useRef<HTMLInputElement>(null);
      useRaiseKeyboard(ref);
      return (
        <div role="dialog">
          <input ref={ref} aria-label="field" />
          <button type="button">Today</button>
        </div>
      );
    }
    render(<SheetHost />);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    screen.getByRole("button", { name: "Today" }).focus();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("button", { name: "Today" })).toHaveFocus();
  });

  it("retries once when the page becomes visible, then stops", () => {
    render(<RaiseHost />);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    screen.getByLabelText("field").blur();

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByLabelText("field")).toHaveFocus();

    screen.getByLabelText("field").blur();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByLabelText("field")).not.toHaveFocus();
  });

  it("does not spend the resume retry while the document is hidden", () => {
    render(<RaiseHost />);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    screen.getByLabelText("field").blur();

    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByLabelText("field")).not.toHaveFocus();

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByLabelText("field")).toHaveFocus();

    if (hidden) Object.defineProperty(Document.prototype, "visibilityState", hidden);
    else delete (document as { visibilityState?: unknown }).visibilityState;
  });
});

describe("useDialogFocus", () => {
  it("prefers a text field over the close button on open", () => {
    render(<DialogHost />);
    expect(screen.getByLabelText("field")).toHaveFocus();
  });

  it("still focuses the first control when there is no field", () => {
    render(<DialogHost withField={false} />);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("QuickTaskSheet lands the caret in the field, not on ✕", () => {
    render(
      <QuickTaskSheet labels={[]} onCreate={async () => {}} onClose={() => {}} />,
    );
    expect(screen.getByLabelText("New task")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Close" })).not.toHaveFocus();
  });

  it("defaults the day chip to Inbox when no date is passed", () => {
    render(
      <QuickTaskSheet labels={[]} onCreate={async () => {}} onClose={() => {}} />,
    );
    const inbox = screen.getByRole("button", { name: "Inbox" });
    expect(inbox.className).toMatch(/bg-accent/);
    expect(screen.getByRole("button", { name: "Today" }).className).not.toMatch(/bg-accent/);
  });

  it("selects Today only when a date is passed in", () => {
    render(
      <QuickTaskSheet
        labels={[]}
        onCreate={async () => {}}
        onClose={() => {}}
        defaultDoDate={todayISO()}
      />,
    );
    expect(screen.getByRole("button", { name: "Today" }).className).toMatch(/bg-accent/);
    expect(screen.getByRole("button", { name: "Inbox" }).className).not.toMatch(/bg-accent/);
  });

  it("does not steal focus already inside the panel", () => {
    function PreFocused() {
      const panelRef = useRef<HTMLDivElement>(null);
      const other = useRef<HTMLInputElement>(null);
      useDialogFocus(panelRef);
      return (
        <div ref={panelRef} role="dialog" tabIndex={-1}>
          <button type="button">Close</button>
          <input aria-label="first" />
          <input ref={other} aria-label="already" autoFocus />
        </div>
      );
    }
    render(<PreFocused />);
    expect(screen.getByLabelText("already")).toHaveFocus();
  });
});
