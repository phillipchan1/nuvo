// Grooming — the initiative altitude's second face (peer to On Deck), the initiative
// sibling of the projects' GroomFloor. Where On Deck answers WHEN (time-box initiatives
// onto quarters), this answers WHAT: every open initiative stands up as its own column
// you shape in place — define the objective, set the measurable key results, route
// it, finish it. Full width, no rail (that's a scheduling concern). Thinnest first.

import { useMemo } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { allOpenInitiativeLanes } from "../../lib/initiativeDeck";
import { initiativeReadinessAxes } from "../../lib/lenses";
import { PROJECT_STATUS_COLORS } from "./parts";
import { READY } from "./ReadinessBanner";
import InitiativeGroomWall from "../ondeck/InitiativeGroomWall";

const CAUTION = PROJECT_STATUS_COLORS.waiting;

export default function InitiativeGroomFloor() {
  const { data } = useVertical();
  const { openRecord } = useAppNavigation();
  const now = useMemo(() => new Date(), []);
  const lanes = useMemo(() => allOpenInitiativeLanes(data, now), [data, now]);

  // Groomed = defined AND measured (both axes met); the rest split by how far.
  const rollup = useMemo(() => {
    let groomed = 0, grooming = 0, raw = 0;
    for (const l of lanes) {
      if (l.state === "parked") continue;
      const a = initiativeReadinessAxes(data, l.initiative);
      const n = (a.defined ? 1 : 0) + (a.planned ? 1 : 0);
      if (n === 2) groomed++;
      else if (n === 1) grooming++;
      else raw++;
    }
    return { groomed, grooming, raw };
  }, [lanes, data]);

  const active = lanes.filter((l) => l.state !== "parked").length;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lead masthead leading-none">Grooming</h1>
          <p className="mt-1.5 text-caption text-muted">Shape the initiatives — define the objective, set the measures. Thinnest first.</p>
        </div>
        {active > 0 && (
          <div className="flex shrink-0 items-center gap-3 text-caption">
            <span className="flex items-center gap-1.5" title="Defined and measured — ready to run">
              <span className="h-2 w-2 rounded-full" style={{ background: READY }} />
              <span style={{ color: rollup.groomed ? "var(--ink)" : "var(--muted)" }}>{rollup.groomed} ready</span>
            </span>
            <span className="flex items-center gap-1.5" title="One axis met — mid-groom">
              <span className="h-2 w-2 rounded-full" style={{ background: CAUTION }} />
              <span style={{ color: rollup.grooming ? "var(--ink)" : "var(--muted)" }}>{rollup.grooming} grooming</span>
            </span>
            <span className="flex items-center gap-1.5" title="No objective or measures yet">
              <span className="h-2 w-2 rounded-full border" style={{ borderColor: "var(--line-strong)" }} />
              <span style={{ color: rollup.raw ? "var(--ink)" : "var(--muted)" }}>{rollup.raw} raw</span>
            </span>
          </div>
        )}
      </div>

      <InitiativeGroomWall lanes={lanes} onOpen={(id) => openRecord("initiative", id)} />
    </div>
  );
}
