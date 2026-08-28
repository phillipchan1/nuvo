// @vitest-environment jsdom
/**
 * Capture / chat / search all land the caret through one hook, and a sheet
 * must not steal that landing to ✕. The lock-screen ＋ opens the sheet with
 * no webview gesture; if focus starts on Close, iOS then ignores the input.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogFocus } from "../src/hooks/useDialogFocus";
import { useRaiseKeyboard } from "../src/hooks/useRaiseKeyboard";
import MobileCapture from "../src/components/mobile/MobileCapture";

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
    for (const file of ["MobileCapture.tsx", "ChatPane.tsx", "MobileSearch.tsx"]) {
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

  it("MobileCapture lands the caret in the field, not on ✕", () => {
    // Capture reads the writable calendars now — it is one door for both kinds,
    // and the Event face has to know whether there is anywhere to write.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MobileCapture labels={[]} onCreate={async () => {}} onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("Capture a task or event")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Close" })).not.toHaveFocus();
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
