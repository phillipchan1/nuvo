// @vitest-environment jsdom
/**
 * Capture / chat / search all land the caret through one hook, and a sheet
 * must not steal that landing to ✕. The lock-screen ＋ opens the sheet with
 * no webview gesture; if focus starts on Close, iOS then ignores the input.
 */
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogFocus } from "../src/hooks/useDialogFocus";
import { useRaiseKeyboard } from "../src/hooks/useRaiseKeyboard";

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
