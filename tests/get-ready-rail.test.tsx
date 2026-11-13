// @vitest-environment jsdom
// Get ready — the rail mode (D-206). At most five cards; ↵ runs the focused
// card's act and the next card arrives; Esc hands the rail back; nothing left →
// "Ready." once, then the rail hands itself back. The Planner mounts it as a
// third mode, and the Schedule's Rhythm button is gone (Memory is the door).

import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import GetReadyRail, { READY_HOLD_MS } from "../src/components/plan/GetReadyRail";
import { ReadyStackSheet } from "../src/components/mobile/MobileGetReady";
import type { ReadyCard } from "../src/lib/readyCards";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const card = (i: number, run = vi.fn(), notNow = vi.fn()): ReadyCard => ({
  key: `hold:t${i}`,
  kind: "hold",
  title: `Task ${i}`,
  why: "Today · no time yet",
  primary: { verb: "Hold", name: `${i}–${i}:30pm`, run },
  secondary: { label: "Not now", run: notNow },
  projectId: null,
});

/** The live wiring in miniature: an act removes its card from the model. */
function Host({ initial, onClose }: { initial: ReadyCard[]; onClose: () => void }) {
  const [cards, setCards] = useState(initial);
  const wired = cards.map((c) => ({
    ...c,
    primary: { ...c.primary, run: (el: HTMLElement | null) => (c.primary.run(el), setCards((cs) => cs.filter((x) => x.key !== c.key))) },
  }));
  return <GetReadyRail cards={wired} onClose={onClose} crown={<span data-test-crown />} />;
}

const titles = (root: HTMLElement) => Array.from(root.querySelectorAll(".k-offer-card-title")).map((e) => e.textContent);

describe("Get ready — the rail mode", () => {
  it("shows at most five cards, and no count of the rest", () => {
    const { container } = render(<Host initial={Array.from({ length: 8 }, (_, i) => card(i + 1))} onClose={() => {}} />);
    expect(container.querySelector("[data-ready-rail]")).toBeTruthy();
    expect(screen.getByText("Get ready")).toBeTruthy();
    expect(container.querySelector("[data-test-crown]")).toBeTruthy();
    expect(titles(container)).toEqual(["Task 1", "Task 2", "Task 3", "Task 4", "Task 5"]);
    expect(container.textContent).not.toMatch(/\b[0-9]+ (more|left)\b/);
    // each act says where it goes
    expect(screen.getByRole("button", { name: /^Hold 1–1:30pm/ })).toBeTruthy();
  });

  it("↵ runs the focused card's act, and the next card arrives in its place", () => {
    const runs = Array.from({ length: 6 }, () => vi.fn());
    const { container } = render(<Host initial={runs.map((r, i) => card(i + 1, r))} onClose={() => {}} />);
    expect(container.querySelector('[data-focused] .k-offer-card-title')?.textContent).toBe("Task 1");
    act(() => void fireEvent.keyDown(window, { key: "Enter" }));
    expect(runs[0]).toHaveBeenCalledTimes(1);
    expect(titles(container)).toEqual(["Task 2", "Task 3", "Task 4", "Task 5", "Task 6"]);
    expect(container.querySelector('[data-focused] .k-offer-card-title')?.textContent).toBe("Task 2");
  });

  it("j / k move the focus; ⌫ says Not now on the focused card", () => {
    const notNow = vi.fn();
    const { container } = render(<Host initial={[card(1), card(2, vi.fn(), notNow), card(3)]} onClose={() => {}} />);
    act(() => void fireEvent.keyDown(window, { key: "j" }));
    expect(container.querySelector('[data-focused] .k-offer-card-title')?.textContent).toBe("Task 2");
    act(() => void fireEvent.keyDown(window, { key: "Backspace" }));
    expect(notNow).toHaveBeenCalledTimes(1);
    expect(titles(container)).toEqual(["Task 1", "Task 3"]);
    act(() => void fireEvent.keyDown(window, { key: "k" }));
    expect(container.querySelector('[data-focused] .k-offer-card-title')?.textContent).toBe("Task 1");
  });

  it("Esc hands the rail back without acting", () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(<Host initial={[card(1, run)]} onClose={onClose} />);
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("nothing left: says 'Ready.' once, then hands the rail back", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(<Host initial={[card(1)]} onClose={onClose} />);
    act(() => void fireEvent.keyDown(window, { key: "Enter" }));
    expect(container.querySelector("[data-ready-done]")?.textContent).toBe("Ready.");
    expect(onClose).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(READY_HOLD_MS));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a card that opens a mode runs and stays — the mode replaces this one", () => {
    const planWeek = vi.fn();
    const plan: ReadyCard = { key: "plan:w", kind: "plan", title: "Plan the whole week", why: "x", primary: { verb: "Plan the week", run: planWeek }, projectId: null, opensMode: "plan" };
    const { container } = render(<GetReadyRail cards={[plan]} onClose={() => {}} crown={<span />} />);
    act(() => void fireEvent.keyDown(window, { key: "Enter" }));
    expect(planWeek).toHaveBeenCalledTimes(1);
    expect(titles(container)).toEqual(["Plan the whole week"]);
  });
});

describe("Get ready — the phone's sheet", () => {
  it("the same cards, by tap, with Not now said as text", () => {
    const run = vi.fn();
    const notNow = vi.fn();
    render(<ReadyStackSheet cards={Array.from({ length: 7 }, (_, i) => card(i + 1, i === 0 ? run : vi.fn(), i === 0 ? notNow : vi.fn()))} onClose={() => {}} />);
    const sheet = document.querySelector("[data-ready-sheet]") as HTMLElement;
    expect(titles(sheet)).toHaveLength(5);
    const first = sheet.querySelector(".k-offer-card") as HTMLElement;
    expect(first.querySelector(".tap")).toBeTruthy();
    fireEvent.click(Array.from(first.querySelectorAll("button")).find((b) => b.textContent === "Not now")!);
    expect(notNow).toHaveBeenCalledTimes(1);
  });
});

describe("Get ready — the Planner's third mode, and Rhythm's new door", () => {
  const planner = readFileSync("src/components/Planner.tsx", "utf8");
  const pane = readFileSync("src/components/CalendarPane.tsx", "utf8");

  it("mounts GetReadyRail in the ready mode, in place of the rest rail, and only then", () => {
    expect(planner).toMatch(/gettingReady \? \([\s\S]{0,240}?<GetReadyRail/);
    expect(planner).toMatch(/const gettingReady = readyMode && !planning && !repairing/);
    expect(planner).toMatch(/onGetReady=\{openGetReady\}/);
  });

  it("the Schedule has no Rhythm button at rest — it shows only while the view is on, to take it off", () => {
    expect(pane).toMatch(/memory && rhythmOn && view !== "board" && !isYear && \(/);
    expect(planner).toMatch(/onShowOnSchedule=/);
    expect(readFileSync("src/components/memory/MemoryPage.tsx", "utf8")).toMatch(/Show on the Schedule/);
  });
});
