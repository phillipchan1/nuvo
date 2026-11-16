// @vitest-environment jsdom
/**
 * "The edit didn't save / saved wrong" — the editors that lost or mangled what
 * you typed. Each case replays the failure:
 *
 *  - a NAME cleared and left saved "" (desktop InlineText, phone TextField);
 *  - a phone sheet closed by ✕ / Escape never blurred its field, so a blur-only
 *    save never ran (Safari fires no blur on a removed field, and React stops
 *    dispatching while it unmounts) — `flushFocus` blurs first;
 *  - a cleared number saved 0 (Number("") === 0) and hours went negative;
 *  - the repeat builder snapped "" to 1, so backspace-then-"5" read "15";
 *  - GuestsInput swallowed every Tab and dropped a typed address on blur;
 *  - an IME's Enter (composing) committed a half-typed word.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InlineText } from "../src/components/floors/parts";
import Sheet, { flushFocus } from "../src/components/mobile/Sheet";
import { NumberField, KeyResultRow, TextField } from "../src/components/mobile/detail/verticalDetail";
import { GuestsInput } from "../src/components/GuestsInput";
import { RepeatControl } from "../src/components/RecurrencePicker";
import type { KeyResult } from "../src/lib/types";

describe("InlineText — a name can't be saved empty", () => {
  it("clearing a name and leaving puts the old name back and saves nothing", () => {
    const onChange = vi.fn();
    render(<InlineText value="Ship the site" onChange={onChange} />);
    const el = screen.getByRole("textbox");
    el.focus();
    el.textContent = "   ";
    fireEvent.blur(el);
    expect(onChange).not.toHaveBeenCalled();
    expect(el.textContent).toBe("Ship the site");
  });

  it("an optional line (allowEmpty) may still be cleared", () => {
    const onChange = vi.fn();
    render(<InlineText value="An outcome" onChange={onChange} allowEmpty />);
    const el = screen.getByRole("textbox");
    el.focus();
    el.textContent = "";
    fireEvent.blur(el);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("a rename still saves, trimmed", () => {
    const onChange = vi.fn();
    render(<InlineText value="Old" onChange={onChange} />);
    const el = screen.getByRole("textbox");
    el.focus();
    el.textContent = " New name ";
    fireEvent.blur(el);
    expect(onChange).toHaveBeenCalledWith("New name");
  });

  it("an IME's Enter confirms the composition — it doesn't commit the field", () => {
    const onChange = vi.fn();
    render(<InlineText value="Old" onChange={onChange} />);
    const el = screen.getByRole("textbox");
    el.focus();
    el.textContent = "にほ";
    fireEvent.keyDown(el, { key: "Enter", isComposing: true });
    expect(document.activeElement).toBe(el);
    fireEvent.keyDown(el, { key: "Enter", keyCode: 229 });
    expect(document.activeElement).toBe(el);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("phone sheets flush the field on every way out", () => {
  it("✕ commits a blur-only field before the sheet goes", () => {
    vi.useFakeTimers();
    try {
      const onCommit = vi.fn();
      const onClose = vi.fn();
      render(
        <Sheet title="Project" onClose={onClose}>
          <TextField value="Old name" onCommit={onCommit} />
        </Sheet>,
      );
      const field = screen.getByDisplayValue("Old name");
      field.focus();
      fireEvent.change(field, { target: { value: "New name" } });
      // A tap on ✕ never takes focus in Safari — the field is still focused.
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      // Committed NOW, while the field is still mounted — not after the slide.
      expect(onCommit).toHaveBeenCalledWith("New name");
      expect(onClose).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(300));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Escape commits too", () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    render(
      <Sheet title="Project" onClose={onClose}>
        <TextField value="Old" onCommit={onCommit} />
      </Sheet>,
    );
    const field = screen.getByDisplayValue("Old");
    field.focus();
    fireEvent.change(field, { target: { value: "Typed" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCommit).toHaveBeenCalledWith("Typed");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("flushFocus leaves a field outside the root alone", () => {
    const outside = document.createElement("input");
    const root = document.createElement("div");
    document.body.append(outside, root);
    try {
      const blurred = vi.fn();
      outside.addEventListener("blur", blurred);
      outside.focus();
      flushFocus(root);
      expect(blurred).not.toHaveBeenCalled();
      flushFocus();
      expect(blurred).toHaveBeenCalledTimes(1);
    } finally {
      outside.remove();
      root.remove();
    }
  });

  it("an emptied phone name goes back to the saved one", () => {
    const onCommit = vi.fn();
    render(<TextField value="Keep me" onCommit={onCommit} />);
    const field = screen.getByDisplayValue("Keep me") as HTMLInputElement;
    field.focus();
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.blur(field);
    expect(onCommit).not.toHaveBeenCalled();
    expect(field.value).toBe("Keep me");
  });
});

describe("number fields: blank is not 0, hours are not negative", () => {
  it("weekly hours: cleared → the old value back, nothing saved", () => {
    const onCommit = vi.fn();
    render(<NumberField value={20} onCommit={onCommit} />);
    const field = screen.getByLabelText("Weekly target hours") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(onCommit).not.toHaveBeenCalled();
    expect(field.value).toBe("20");
  });

  it("weekly hours: a negative is clamped to 0", () => {
    const onCommit = vi.fn();
    render(<NumberField value={20} onCommit={onCommit} />);
    const field = screen.getByLabelText("Weekly target hours") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "-4" } });
    fireEvent.blur(field);
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it("a key result's number: cleared → the old value back, not 0", () => {
    const onPatch = vi.fn();
    const kr = { id: "k1", name: "Signups", baseline: 0, current: 12, target: 40, unit: "" } as KeyResult;
    render(<KeyResultRow kr={kr} accent="var(--accent)" onPatch={onPatch} onDelete={() => {}} />);
    const current = screen.getByDisplayValue("12") as HTMLInputElement;
    fireEvent.change(current, { target: { value: "" } });
    fireEvent.blur(current);
    expect(onPatch).not.toHaveBeenCalled();
    expect(current.value).toBe("12");
    fireEvent.change(current, { target: { value: "15" } });
    fireEvent.blur(current);
    expect(onPatch).toHaveBeenCalledWith({ current: 15 });
  });
});

describe("repeat builder keeps what you type", () => {
  it("a cleared interval stays empty until you type the next digit", () => {
    const onChange = vi.fn();
    // a custom rule (every 3 weeks) opens the builder straight away
    render(
      <RepeatControl
        anchorISO="2026-11-16"
        value={{ freq: "weekly", interval: 3, byweekday: [1] }}
        onChange={onChange}
        variant="block"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /every 3 weeks/i }));
    const every = screen.getByLabelText("Repeat every") as HTMLInputElement;
    fireEvent.change(every, { target: { value: "" } });
    expect(every.value).toBe("");
    fireEvent.change(every, { target: { value: "5" } });
    expect(every.value).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ interval: 5 }));
  });

  it("a blank interval builds as 1, and leaving the field says so", () => {
    const onChange = vi.fn();
    render(
      <RepeatControl
        anchorISO="2026-11-16"
        value={{ freq: "weekly", interval: 3, byweekday: [1] }}
        onChange={onChange}
        variant="block"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /every 3 weeks/i }));
    const every = screen.getByLabelText("Repeat every") as HTMLInputElement;
    fireEvent.change(every, { target: { value: "" } });
    fireEvent.blur(every);
    expect(every.value).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ interval: 1 }));
  });
});

describe("GuestsInput", () => {
  it("Tab in an empty field moves on — it isn't swallowed", () => {
    render(<GuestsInput value={[]} onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("Tab after a typed address takes it (and stays to take another)", () => {
    const onChange = vi.fn();
    render(<GuestsInput value={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "ana@example.com" } });
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(onChange).toHaveBeenCalledWith(["ana@example.com"]);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("a whole address typed and left is a guest", () => {
    const onChange = vi.fn();
    render(<GuestsInput value={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    input.focus();
    fireEvent.change(input, { target: { value: "Ana@Example.com " } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(["ana@example.com"]);
  });

  it("half an address left behind is not", () => {
    const onChange = vi.fn();
    render(<GuestsInput value={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    input.focus();
    fireEvent.change(input, { target: { value: "ana@exa" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
