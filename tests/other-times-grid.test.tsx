// @vitest-environment jsdom
// Other times on the grid (R13, D-216): every option is drawn numbered, and a
// click on ANY of them — the solid one included — places the work there. The
// solid option used to do nothing and a ghost only re-lit the menu, so clicking
// the time you wanted, again and again, never placed it (2026-11-16).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { useOfferChoice, type OfferChoice } from "../src/lib/offerPreview";
import type { Task } from "../src/lib/types";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const TODAY = "2026-11-16";
const alt = { dayISO: "2026-11-17", startMin: 8 * 60, durationMin: 45 };
vi.mock("../src/hooks/useFindTime", () => ({
  useWeekComposer: () => ({ today: TODAY, laterDays: [2], now: new Date(2026, 10, 16, 8), busy: [], alternatives: () => [alt] }),
}));

const { OtherTimes } = await import("../src/components/nuvo/OtherTimes");

afterEach(cleanup);

let seen: OfferChoice | null = null;
function Probe() {
  seen = useOfferChoice();
  return null;
}

describe("Other times — the grid's numbers are choices", () => {
  const task = { id: "t1", title: "Decide on Defiant Law", duration_minutes: 45, status: "planned" } as Task;
  const first = { dayISO: TODAY, startMin: 9 * 60, durationMin: 45 };

  it("a click on the solid option and on a ghost each place the work, through the chip's own act", () => {
    const onHold = vi.fn();
    render(
      <>
        <Probe />
        <OtherTimes task={task} first={first} onHold={onHold} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Other times" }));
    expect(seen?.options.map((o) => o.num)).toEqual([1, 2]);
    // the solid one (the first answer, drawn as a block)
    act(() => seen!.onChoose(seen!.strong!));
    expect(onHold).toHaveBeenLastCalledWith(first, null);
    // reopen; the ghost
    fireEvent.click(screen.getByRole("button", { name: "Other times" }));
    const ghost = seen!.options.find((o) => o.key !== seen!.strong)!;
    act(() => seen!.onChoose(ghost.key));
    expect(onHold).toHaveBeenLastCalledWith(alt, null);
  });

  it("the Schedule hands both kinds of click to the choice", () => {
    const planner = readFileSync("src/components/Planner.tsx", "utf8");
    const block = planner.slice(planner.indexOf("offerChoice\n        ? {"), planner.indexOf(": offerPreview"));
    expect(block).toMatch(/onSelect: \(key\) => key && offerChoice\.onChoose\(/);
    expect(block).toMatch(/onPickGhost: \(id\) => offerChoice\.onChoose\(id\)/);
  });
});
