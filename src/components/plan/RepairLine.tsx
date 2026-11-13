// The crown's line when the week broke (docs/rail-modes.md §3, D-204):
// "Tue 10am broke: a meeting landed · Repair ›". A fact, in --warn (never
// --signal, which is *now*), present only while it is true. It never opens
// repair by itself; the press does (P4, P9). Mounted through WeekPanel's
// `crownLine`, where it replaces the "N with no time" line — so it wears the
// crown's own line grammar (`crown-fact`, `data-warn`, `crown-fact-link`).

import type { RepairState } from "./repairActs";
import { parseDateISO } from "../../lib/dates";
import { at } from "../mobile/dayPlan";
import { instantOf } from "./repairActs";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type LineState = Pick<RepairState, "open" | "applied" | "dial">;

/** The line's words, or null when nothing is broken. */
export function repairLineText(state: LineState): { text: string; act: string } | null {
  const first = state.open[0];
  if (first) {
    const when = `${DAY[parseDateISO(first.from.dayISO).getDay()]} ${at(instantOf(first.from.dayISO, first.from.startMin))}`;
    const more = state.open.length - 1;
    const why = first.why === "missed" ? "it was missed" : "a meeting landed";
    return { text: more > 0 ? `${when} and ${more} more broke` : `${when} broke: ${why}`, act: "Repair" };
  }
  // Handle moved things on its own: the line is where you review (and undo) them
  if (state.dial === "handle" && state.applied.length) return { text: `Nuvo moved ${state.applied.length} for you`, act: "Review" };
  return null;
}

export default function RepairLine({ state, onOpen }: { state: LineState; onOpen: () => void }) {
  const line = repairLineText(state);
  if (!line) return null;
  return (
    <p className="crown-fact crown-line" data-repair-line="">
      <span data-warn="">{line.text}</span>
      {" · "}
      <button type="button" className="crown-fact-link" onClick={onOpen}>
        {line.act} ›
      </button>
    </p>
  );
}
