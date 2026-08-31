// @vitest-environment jsdom
/**
 * Rung switches used to unmount FullCalendar (and the floor overlay), so ⌘1
 * back to Schedule rebuilt the grid — ~111ms to construct, plus event
 * reconcile, a lived-in week feeling like a second or two. KeepAlive keeps
 * the subtree mounted and hides it; skipWhenAsleep is the memo compare that
 * stops the hidden tree reconciling under the floor that's actually on screen.
 *
 * The wiring contract (Planner / AppShell) is read from source, same as the
 * empty-CTA and keyboard gates — a future unmount cannot ship as a silent
 * perf "win" that brings the hitch back.
 */
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import KeepAlive, { skipWhenAsleep } from "../src/components/KeepAlive";

const SRC = join(__dirname, "..", "src");
function read(relPath: string) {
  return readFileSync(join(SRC, relPath), "utf8");
}

describe("KeepAlive", () => {
  it("keeps children mounted while inactive, hidden and inert", () => {
    function Probe() {
      const [on, setOn] = useState(true);
      return (
        <div>
          <button onClick={() => setOn((v) => !v)}>toggle</button>
          <KeepAlive active={on}>
            <span>calendar</span>
          </KeepAlive>
        </div>
      );
    }
    const { container } = render(<Probe />);
    const wrap = container.querySelector("[data-keep-alive]") as HTMLElement;
    expect(screen.getByText("calendar")).toBeTruthy();
    expect(wrap.getAttribute("data-keep-alive")).toBe("on");
    expect(wrap.getAttribute("aria-hidden")).toBe("false");
    expect(wrap.inert).toBe(false);

    fireEvent.click(screen.getByText("toggle"));

    expect(screen.getByText("calendar")).toBeTruthy();
    expect(wrap.getAttribute("data-keep-alive")).toBe("off");
    expect(wrap.getAttribute("aria-hidden")).toBe("true");
    expect(wrap.className).toMatch(/invisible/);
    expect(wrap.className).toMatch(/pointer-events-none/);
    expect(wrap.inert).toBe(true);

    fireEvent.click(screen.getByText("toggle"));
    expect(wrap.getAttribute("data-keep-alive")).toBe("on");
    expect(wrap.inert).toBe(false);
    expect(wrap.className).not.toMatch(/invisible/);
  });
});

describe("skipWhenAsleep", () => {
  const a = { live: true as boolean | undefined, n: 1, fn: () => 1 };
  it("skips every update while both sides are asleep", () => {
    expect(skipWhenAsleep({ live: false, n: 1 }, { live: false, n: 99 })).toBe(true);
  });
  it("does not skip the wake or the sleep (one render each way)", () => {
    expect(skipWhenAsleep({ live: true, n: 1 }, { live: false, n: 1 })).toBe(false);
    expect(skipWhenAsleep({ live: false, n: 1 }, { live: true, n: 1 })).toBe(false);
  });
  it("shallow-compares while awake", () => {
    expect(skipWhenAsleep(a, { ...a })).toBe(true);
    expect(skipWhenAsleep(a, { ...a, n: 2 })).toBe(false);
    expect(skipWhenAsleep(a, { ...a, fn: () => 2 })).toBe(false);
  });
  it("treats a missing live as awake", () => {
    expect(skipWhenAsleep({ n: 1 }, { n: 1 })).toBe(true);
    expect(skipWhenAsleep({ n: 1 }, { n: 2 })).toBe(false);
  });
});

describe("rung switches keep both surfaces mounted", () => {
  it("Planner hides the Schedule rather than unmounting LeftRail / CalendarPane", () => {
    const planner = read("components/Planner.tsx");
    expect(planner, "Schedule must ride KeepAlive").toMatch(
      /<KeepAlive active=\{onSchedule\}/,
    );
    expect(planner, "LeftRail must not remount on a floor").not.toMatch(
      /\{onSchedule && \(\s*<LeftRail/,
    );
    expect(planner, "CalendarPane must sleep, not unmount").toMatch(/live=\{onSchedule\}/);
    expect(planner, "rail hotkeys must follow onSchedule").toMatch(
      /hotkeysEnabled=\{!anyModalOpen && !focusMode && onSchedule\}/,
    );
  });

  it("AppShell latches the floor overlay after first visit", () => {
    const shell = read("components/AppShell.tsx");
    expect(shell, "floors must ride KeepAlive").toMatch(
      /<KeepAlive\s+active=\{rung !== "day"\}/,
    );
    expect(shell, "must not unmount floors on ⌘1").not.toMatch(
      /\{rung !== "day" && \(/,
    );
    expect(shell, "hidden overlay keeps the last Build rung").toMatch(
      /rung=\{rung === "day" \? lastBuildRung\.current : rung\}/,
    );
    expect(shell, "face-switcher keys stand down while hidden").toMatch(
      /active=\{rung !== "day"\}/,
    );
  });

  it("FloorPane's 1–4 keys are gated on active", () => {
    const floor = read("components/FloorPane.tsx");
    expect(floor).toMatch(/active = true/);
    expect(floor).toMatch(/if \(!active\) return;/);
  });
});
