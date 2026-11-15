// @vitest-environment jsdom
// D-216 (docs/offer-rules.md): an offer says its day (R2) and pointing at it
// draws where it lands (R3) — without writing anything (R7).
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { OfferChip } from "../src/components/kit";
import { whenLabel } from "../src/lib/readyCards";
import { clearOfferPreview, useOfferPreview } from "../src/lib/offerPreview";

function Probe() {
  const p = useOfferPreview();
  return <div data-testid="probe">{p ? `${p.label}@${p.start.getHours()}:${p.start.getMinutes()}` : "none"}</div>;
}

const start = new Date(2026, 10, 10, 16, 15);
const end = new Date(2026, 10, 10, 17, 0);

function setup(onPress = () => {}) {
  render(
    <>
      <OfferChip verb="Schedule" name="Today 4:15–5pm" whole preview={{ label: "Runbook", start, end }} onPress={onPress} />
      <Probe />
    </>,
  );
  return { chip: screen.getByRole("button", { name: /Schedule Today 4:15–5pm/ }), probe: screen.getByTestId("probe") };
}

describe("an offer shows where it lands (R3)", () => {
  it("a mouse over the chip previews it; leaving clears it", () => {
    const { chip, probe } = setup();
    expect(probe.textContent).toBe("none");
    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    expect(probe.textContent).toBe("Runbook@16:15");
    fireEvent.pointerLeave(chip, { pointerType: "mouse" });
    expect(probe.textContent).toBe("none");
  });

  it("a finger never previews — the phone shows the spot in the sheet instead", () => {
    const { chip, probe } = setup();
    fireEvent.pointerEnter(chip, { pointerType: "touch" });
    expect(probe.textContent).toBe("none");
  });

  it("pressing clears the picture before the act runs, and writes nothing itself", () => {
    let pressed = 0;
    const { chip, probe } = setup(() => pressed++);
    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    fireEvent.click(chip);
    expect(pressed).toBe(1);
    expect(probe.textContent).toBe("none");
  });

  it("one chip leaving can't wipe another chip's preview", () => {
    const { chip, probe } = setup();
    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    act(() => clearOfferPreview("someone-else"));
    expect(probe.textContent).toBe("Runbook@16:15");
    act(() => clearOfferPreview());
  });
});

describe("an offer says its day (R2)", () => {
  it("today's time says Today; another day says its weekday", () => {
    expect(whenLabel({ dayISO: "2026-11-10", startMin: 16 * 60 + 15, durationMin: 45 }, "2026-11-10")).toBe("Today 4:15–5pm");
    expect(whenLabel({ dayISO: "2026-11-11", startMin: 13 * 60, durationMin: 45 }, "2026-11-10")).toMatch(/^Wed /);
  });
});

describe("the wiring (D-216)", () => {
  const planner = readFileSync("src/components/Planner.tsx", "utf8");
  it("the Schedule draws the pointed-at offer when no mode owns the grid", () => {
    expect(planner).toMatch(/repairing \? repairOverlay : onSchedule \? previewOverlay : null/);
    expect(planner).toMatch(/dimCalendar: true/);
  });
  it("the card no longer stands under the crown at rest", () => {
    expect(planner).not.toMatch(/<RestDeck/);
    expect(planner).toMatch(/rowCards=\{onSchedule \? ready\.cards : undefined\}/);
  });
});
