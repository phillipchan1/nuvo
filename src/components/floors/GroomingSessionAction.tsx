// "Block time to groom" — the one grooming-session action, shared by both
// desktop readiness strips and the mobile Groom header. Reports, never nags
// (Principle 4): it renders nothing until `needy.length > 0`, and it only
// speaks when the surface it's on is already open. Dissolve, don't frame — an
// inline CSS-grid expand under the trigger, never a modal or a popover.

import { useEffect, useState } from "react";
import { Toggle } from "../form";
import { useGroomingSession } from "../../hooks/useGroomingSession";

export default function GroomingSessionAction({ kind }: { kind: "project" | "initiative" }) {
  const { needy, previewSlot, scheduleOn, setScheduleOn, commit, committing, result } =
    useGroomingSession(kind);
  const [expanded, setExpanded] = useState(false);

  // Collapse back closed once a commit lands — the confirm card's job is done,
  // and the trigger itself disappears next render if that was the last needy item.
  useEffect(() => {
    if (result === "done") setExpanded(false);
  }, [result]);

  if (needy.length === 0) return null;

  const noun = kind === "project" ? "project" : "initiative";
  const willSchedule = scheduleOn && previewSlot != null;

  return (
    <>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="tap fast inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-caption font-medium text-muted hover:text-ink"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 opacity-80">
          <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2 6.5H14" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5.5 2V4.5M10.5 2V4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        Block time to groom
      </button>

      <div
        className="grid w-full basis-full transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div
            className="mt-2 min-h-0 rounded-lg px-3.5 py-3"
            style={{ background: "var(--accent-soft)" }}
          >
            <p className="text-caption font-medium text-ink">
              Groom {needy.length} {noun}
              {needy.length === 1 ? "" : "s"}
            </p>
            <p className="mt-0.5 text-caption text-muted">
              {needy.map((n) => `${n.name} — ${n.gapLabel}`).join(", ")}
            </p>

            <div className="my-3 flex items-center gap-2.5 border-y border-dashed border-line py-2.5">
              <Toggle checked={scheduleOn} onChange={setScheduleOn} label="Also block time this week" />
              <span className="text-caption text-ink">Also block time this week</span>
            </div>

            {scheduleOn && (
              <p className="mb-3 text-caption text-muted">
                {previewSlot ? (
                  <>
                    found an open <span className="mono text-ink">{previewSlot.label}</span>
                  </>
                ) : (
                  "No open time found this week."
                )}
              </p>
            )}

            <div className="flex items-center gap-3.5">
              <button
                onClick={() => void commit()}
                disabled={committing}
                className="tap fast rounded-md px-3 py-1.5 text-caption font-semibold disabled:opacity-60"
                style={{ background: "var(--accent)", color: "var(--on-accent)" }}
              >
                {willSchedule ? "Add to inbox & schedule" : "Add to inbox"}
              </button>
              <button
                onClick={() => setExpanded(false)}
                className="text-caption text-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>

            {result === "error" && (
              <p className="mt-2 text-caption" style={{ color: "var(--warn)" }}>
                Couldn't add that — try again.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
