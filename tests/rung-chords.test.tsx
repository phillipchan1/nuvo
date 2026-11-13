// @vitest-environment jsdom
/**
 * ⌘1–4 are global — a modal is not a reason they stop working.
 *
 * The chord handler used to bail when the event target was a field (a modal
 * autofocuses one, so ⌘1/⌘2 died the moment it opened) and again whenever any
 * overlay or composer was up. `jumpToRung` is what the chord now calls: it goes
 * to the rung AND lifts whatever modal is on top, so the screen the user lands
 * on is the one they asked for, not the old floor hidden under a record.
 */
import { render, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { AppNavigationProvider, useAppNavigation } from "../src/hooks/useAppNavigation";

type Nav = ReturnType<typeof useAppNavigation>;
let nav: Nav;
function Probe() {
  nav = useAppNavigation();
  return null;
}

beforeEach(() => history.replaceState(null, ""));

const mount = () =>
  render(
    <AppNavigationProvider>
      <Probe />
    </AppNavigationProvider>,
  );

describe("jumpToRung", () => {
  it("lifts an open record and lands on the rung", () => {
    mount();
    act(() => nav.openOverlay("cmd"));
    expect(nav.nav.overlay).toBe("cmd");
    act(() => nav.jumpToRung("domain"));
    expect(nav.nav.overlay).toBe("none");
    expect(nav.nav.rung).toBe("domain");
  });

  it("lifts a create composer", () => {
    mount();
    act(() => nav.openFloorModal("new-project"));
    expect(nav.nav.floorModal).toBeTruthy();
    act(() => nav.jumpToRung("day"));
    expect(nav.nav.floorModal).toBeNull();
    expect(nav.nav.rung).toBe("day");
  });

  it("still gives a rung its front door", () => {
    mount();
    act(() => nav.jumpToRung("project"));
    expect(nav.nav.projectView).toBe("ondeck");
  });
});

describe("the chord handler (AppShell)", () => {
  const src = readFileSync("src/components/AppShell.tsx", "utf8");
  const handler = src.slice(src.indexOf("// ⌘1–4 jump to a rung"), src.indexOf("// ⌘. slides the side panels away"));

  it("jumps through jumpToRung, not the overlay-blind goRung", () => {
    expect(handler).toContain("jumpToRung(LADDER[num - 1])");
    expect(handler).not.toContain("goRung(");
  });

  it("has no text-field or modal guard ahead of the digit chords", () => {
    const digits = handler.slice(handler.indexOf("if (e.shiftKey) return;"), handler.indexOf("window.addEventListener"));
    expect(digits).not.toMatch(/typing|tagName|nav\.overlay|floorModal/);
  });
});
