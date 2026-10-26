// @vitest-environment jsdom
//
// The phone's detail sheets (event · task · block) share one kit — and the
// Repeat picker, which both of them open, has a phone face and a desktop face.
// These pin the behaviours that were each a real defect before the kit:
//
//   · Repeat was a 288px cursor-anchored popover on a phone (28px rows, a
//     builder wider than its own card). On a phone it is a bottom sheet now;
//     on a desktop it must stay the popover.
//   · Delete sat 8px under "Copy details" as an equal-weight bordered button.
//     It is quiet text that asks before it acts — and a repeating event, which
//     asks "which occurrences?" itself, must not be asked twice.
//   · "Going?" answers carry a verdict, and the control reports pressed state.
//   · Choosing a project was a chip per project; choosing one of many is a Sheet.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import RecurrencePicker from "../src/components/RecurrencePicker";
import {
  DestructiveRow,
  PickSheet,
  ResponseSegmented,
  dayWord,
  type ResponseOption,
} from "../src/components/mobile/sheetKit";
import { todayISO, tomorrowISO, parseDateISO } from "../src/lib/dates";

afterEach(() => cleanup());

function stubViewport(phone: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: phone,
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const rect = { top: 100, left: 16, bottom: 144, right: 359, width: 343, height: 44, x: 16, y: 100, toJSON: () => ({}) } as DOMRect;

describe("the Repeat picker — a sheet on a phone, a popover on a desktop", () => {
  beforeEach(() => stubViewport(false));

  it("is a bottom Sheet on a phone, with every preset a tappable row", () => {
    stubViewport(true);
    const onPick = vi.fn();
    render(<RecurrencePicker anchorISO="2026-10-14" current={null} anchor={rect} onPick={onPick} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Repeat")).toBeTruthy();
    // no floating card was mounted beside it
    expect(document.querySelector(".moment.fixed")).toBeNull();

    // A preset is one tap, and picks its rule.
    fireEvent.click(within(dialog).getByText("Every day"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ freq: "daily", interval: 1 }));
  });

  it("builds a custom weekly rule from the sheet, defaulting to the anchor's weekday", () => {
    stubViewport(true);
    const onPick = vi.fn();
    render(<RecurrencePicker anchorISO="2026-10-14" current={null} anchor={rect} onPick={onPick} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.click(within(dialog).getByText("Custom…"));
    // Wednesday (3) is pre-selected; adding Friday (5) is one tap on a 44px circle.
    const days = within(dialog).getAllByRole("button", { name: /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/ });
    expect(days).toHaveLength(7);
    fireEvent.click(days[5]);
    fireEvent.click(within(dialog).getByText("Done"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ freq: "weekly", interval: 1, byweekday: [3, 5] }));
  });

  it("stays the anchored popover on a desktop", () => {
    stubViewport(false);
    render(<RecurrencePicker anchorISO="2026-10-14" current={null} anchor={rect} onPick={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".moment.fixed")).not.toBeNull();
  });
});

describe("DestructiveRow — quiet text that asks before it acts", () => {
  it("arms on the first tap and only acts on the confirm", () => {
    const onConfirm = vi.fn();
    render(<DestructiveRow label="Delete event" confirmLabel="Delete event" onConfirm={onConfirm} />);

    fireEvent.click(screen.getByText("Delete event"));
    expect(onConfirm).not.toHaveBeenCalled();
    // The armed state offers a way back and the act itself.
    expect(screen.getByText("Cancel")).toBeTruthy();

    fireEvent.click(screen.getByText("Cancel"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Delete event")).toBeTruthy();

    fireEvent.click(screen.getByText("Delete event"));
    fireEvent.click(screen.getAllByText("Delete event").find((el) => el.tagName === "BUTTON")!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("hands straight to the caller when it asks its own question (a repeating event)", () => {
    const onConfirm = vi.fn();
    render(<DestructiveRow label="Delete event" confirm={false} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Delete event"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Cancel")).toBeNull();
  });
});

describe("ResponseSegmented — the RSVP", () => {
  const options: ResponseOption<"accepted" | "tentative" | "declined">[] = [
    { value: "accepted", label: "Yes", glyph: "✓", tone: "ok" },
    { value: "tentative", label: "Maybe", glyph: "?", tone: "warn" },
    { value: "declined", label: "No", glyph: "✕", tone: "signal" },
  ];

  it("reports the chosen answer as pressed, and nothing when unanswered", () => {
    const { rerender } = render(<ResponseSegmented options={options} value="tentative" onPick={() => {}} ariaLabel="Your response" />);
    expect(screen.getByRole("button", { name: /Maybe/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Yes/ }).getAttribute("aria-pressed")).toBe("false");

    rerender(<ResponseSegmented options={options} value={null} onPick={() => {}} ariaLabel="Your response" />);
    for (const b of screen.getAllByRole("button")) expect(b.getAttribute("aria-pressed")).toBe("false");
  });

  it("answers on one tap, and is inert while an answer is in flight", () => {
    const onPick = vi.fn();
    const { rerender } = render(<ResponseSegmented options={options} value={null} onPick={onPick} ariaLabel="Your response" />);
    fireEvent.click(screen.getByRole("button", { name: /No/ }));
    expect(onPick).toHaveBeenCalledWith("declined");

    onPick.mockClear();
    rerender(<ResponseSegmented options={options} value={null} onPick={onPick} disabled ariaLabel="Your response" />);
    fireEvent.click(screen.getByRole("button", { name: /Yes/ }));
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("PickSheet — choosing one of many", () => {
  const rows = [
    { id: "p1", name: "Marketing site v2", sub: "Studio" },
    { id: "p2", name: "Garage clean-out", sub: "Family" },
  ];

  it("picks a row, then closes", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<PickSheet title="Project" rows={rows} value="p1" noneLabel="No project" onPick={onPick} onClose={onClose} />);
    fireEvent.click(screen.getByText("Garage clean-out"));
    expect(onPick).toHaveBeenCalledWith("p2");
    expect(onClose).toHaveBeenCalled();
  });

  it("offers a way to clear, which picks the empty id", () => {
    const onPick = vi.fn();
    render(<PickSheet title="Project" rows={rows} value="p1" noneLabel="No project" onPick={onPick} onClose={() => {}} />);
    fireEvent.click(screen.getByText("No project"));
    expect(onPick).toHaveBeenCalledWith("");
  });

  it("scales past a screenful — every project is a row, not a chip", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `Project ${i}` }));
    render(<PickSheet title="Project" rows={many} value={null} onPick={() => {}} onClose={() => {}} />);
    expect(screen.getAllByRole("button").filter((b) => /^Project \d+$/.test(b.textContent ?? ""))).toHaveLength(40);
  });
});

describe("dayWord — the mast says what the day IS", () => {
  it("names today and tomorrow, and spells any other day", () => {
    expect(dayWord(parseDateISO(todayISO()))).toBe("Today");
    expect(dayWord(parseDateISO(tomorrowISO()))).toBe("Tomorrow");
    expect(dayWord(parseDateISO("2031-03-14"))).toMatch(/Mar/);
  });
});
