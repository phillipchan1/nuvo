// Groom — the project altitude's second face (peer to On Deck). Where On Deck
// answers WHEN (time-box projects across weeks), Groom answers WHAT: every
// in-flight project stands up as its own column you shape in place — define the
// outcome, rattle off the steps, route it, finish it. No inbox here (that's a
// scheduling concern) and full width, so the cards get room to breathe.

import { useMemo } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { readOnDeck } from "../../lib/onDeck";
import { PROJECT_STATUS_COLORS } from "./parts";
import { READY } from "./ReadinessBanner";
import GroomWall from "../ondeck/GroomWall";

const CAUTION = PROJECT_STATUS_COLORS.waiting;
const HORIZON = 8;

export default function GroomFloor() {
  const { data } = useVertical();
  const { byWeek, weeklyAvgMins } = useCapacity();
  const { openRecord } = useAppNavigation();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(
    () => readOnDeck(data, byWeek, weeklyAvgMins, now, HORIZON),
    [data, byWeek, weeklyAvgMins, now],
  );

  const groomable = board.lanes.filter((l) => l.readyTier !== "done");
  const readyN = groomable.filter((l) => l.readyTier === "ready").length;
  const groomN = groomable.filter((l) => l.readyTier === "grooming").length;
  const rawN = groomable.filter((l) => l.readyTier === "raw").length;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lead masthead leading-none">Groom</h1>
          <p className="mt-1.5 text-caption text-muted">Shape the work — define it, break it down, route it. Thinnest first.</p>
        </div>
        {groomable.length > 0 && (
          <div className="flex shrink-0 items-center gap-3 text-caption">
            <span className="flex items-center gap-1.5" title="Ready to pull into a week (all 3 checks)">
              <span className="h-2 w-2 rounded-full" style={{ background: READY }} />
              <span style={{ color: readyN ? "var(--ink)" : "var(--muted)" }}>{readyN} ready</span>
            </span>
            <span className="flex items-center gap-1.5" title="Mid-groom (1–2 checks)">
              <span className="h-2 w-2 rounded-full" style={{ background: CAUTION }} />
              <span style={{ color: groomN ? "var(--ink)" : "var(--muted)" }}>{groomN} grooming</span>
            </span>
            <span className="flex items-center gap-1.5" title="Raw idea (no checks yet)">
              <span className="h-2 w-2 rounded-full border" style={{ borderColor: "var(--line-strong)" }} />
              <span style={{ color: rawN ? "var(--ink)" : "var(--muted)" }}>{rawN} raw</span>
            </span>
          </div>
        )}
      </div>

      {groomable.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {[
            { k: "⏎", label: "next step" },
            { k: "⇥", label: "next project" },
            { k: "⌘⏎", label: "add steps" },
          ].map((h) => (
            <span key={h.label} className="flex items-center gap-1.5 text-micro text-muted">
              <kbd className="mono rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink" style={{ borderBottomWidth: 2 }}>{h.k}</kbd>
              {h.label}
            </span>
          ))}
        </div>
      )}

      <GroomWall lanes={board.lanes} onOpen={(id) => openRecord("project", id)} />
    </div>
  );
}
