// "Block time to groom" — the one grooming-session action, shared by the Groom
// faces' heads, the decks' rail crowns and the phone's Groom header. Reports,
// never nags (Principle 4): it renders nothing until `needy.length > 0`, and it
// only speaks when the surface it's on is already open. Dissolve, don't frame —
// it opens in place under its trigger (a full-width row in its flex-wrap
// parent), never a modal or a popover.

import { useEffect, useState } from "react";
import { useGroomingSession } from "../../hooks/useGroomingSession";
import { Icon } from "../Icon";
import { Button, Switch } from "../kit";

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
      <Button
        kind="ghost"
        size="sm"
        className="tap"
        icon={<Icon name="clock" size={14} />}
        aria-expanded={expanded}
        title="Block time to groom"
        onClick={() => setExpanded((v) => !v)}
      >
        Block time
      </Button>

      {expanded && (
        <div className="fl-head-expand w-full basis-full">
          <div className="fl-panel pop-in [--pop-origin:top_right]">
            <div className="text-body font-semibold">
              Groom {needy.length} {noun}
              {needy.length === 1 ? "" : "s"}
            </div>
            <p className="fl-note">{needy.map((n) => `${n.name} — ${n.gapLabel}`).join(" · ")}</p>

            <label className="flex min-h-[var(--h-sm)] items-center gap-2.5 text-body">
              <Switch checked={scheduleOn} onChange={setScheduleOn} label="Also block time this week" />
              <span>Also block time this week</span>
            </label>

            {scheduleOn && (
              <p className="fl-note">
                {previewSlot ? (
                  <>
                    Found an open <span className="font-semibold tabular-nums text-ink">{previewSlot.label}</span>
                  </>
                ) : (
                  "No open time this week."
                )}
              </p>
            )}

            <div className="fl-work-row">
              <Button kind="primary" size="sm" className="tap" onClick={() => void commit()} disabled={committing}>
                {willSchedule ? "Add to inbox & schedule" : "Add to inbox"}
              </Button>
              <Button kind="ghost" size="sm" className="tap" onClick={() => setExpanded(false)}>
                Cancel
              </Button>
            </div>

            {result === "error" && (
              <p className="fl-note" style={{ color: "var(--danger)" }}>
                Couldn't add that — try again.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
