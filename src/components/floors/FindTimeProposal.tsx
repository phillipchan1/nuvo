// The placement proposal — "here is where the rest of this project could go this
// week." Opens in place under the Week's Plan row that named the problem.
//
// It is a proposal, and it stays one until pressed (P3): nothing is written on
// open, and what can't fit is stated rather than quietly dropped (P6). The
// blocks come from `composeWeek` — the same composer the weekly ritual uses —
// so the manual act and the automated one place work identically.

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useFindTime } from "../../hooks/useFindTime";
import { fmtHours, parseDateISO } from "../../lib/dates";
import { RemedyPanel } from "./RemedyPanel";
import { Button } from "../kit";

const fmtStart = (startMin: number) => {
  const h = Math.floor(startMin / 60);
  const m = startMin % 60;
  const ampm = h >= 12 ? "pm" : "am";
  const hh = ((h + 11) % 12) + 1;
  return m === 0 ? `${hh}${ampm}` : `${hh}:${String(m).padStart(2, "0")}${ampm}`;
};

export function FindTimeProposal({
  projectId,
  weekStartISO,
  looseMins,
  onClose,
}: {
  projectId: string;
  weekStartISO: string;
  looseMins: number;
  onClose: () => void;
}) {
  const { propose, place } = useFindTime(weekStartISO);
  const [placing, setPlacing] = useState(false);
  // Recomposes when its inputs actually change — `propose`'s identity tracks the
  // week's tasks, blocks and events. Freezing it on open would be steadier to
  // read, but the panel can open before those queries settle, and a proposal
  // computed against an empty week says "no open time left" about a week that
  // has plenty. A stale-but-calm lie is worse than a brief reshuffle.
  const proposal = useMemo(() => propose(projectId, new Date()), [propose, projectId]);

  const { placements, unplaced } = proposal;

  if (!placements.length) {
    // Honest empty state: the week really is full. Hand back to the acts that
    // can still resolve it rather than leaving a dead panel.
    return (
      <RemedyPanel
        problem={`No open time left this week for ${fmtHours(looseMins)}h.`}
        why="Every working day is spoken for. Giving it another week or moving it out is the honest answer."
        acts={[{ label: "Back", title: "Back to the acts that can move it", onPress: onClose }]}
      />
    );
  }

  const total = placements.reduce((s, p) => s + p.durationMin, 0);

  // A proposal is intent not yet landed: the accent wash, the blocks as the
  // grid would spell them (`Tue 9:30am`), and the one act that writes them.
  // Both acts keep `.tap` — this panel also opens in the phone's Week's Plan.
  return (
    <div className="mb-2 rounded-[var(--r-card)] px-3 py-2.5" style={{ background: "var(--accent-wash)" }}>
      <div className="text-caption font-semibold leading-tight tabular-nums" style={{ color: "var(--accent-ink)" }}>
        {placements.length} block{placements.length === 1 ? "" : "s"} · {fmtHours(total)}h found
      </div>

      <ul className="mt-2 grid gap-1">
        {placements.map((p) => (
          <li key={`${p.task.id}-${p.dayISO}-${p.startMin}`} className="flex items-baseline gap-2 text-caption leading-snug">
            <span className="w-[72px] shrink-0 text-label font-medium tabular-nums" style={{ color: "var(--muted)" }}>
              {format(parseDateISO(p.dayISO), "EEE")} {fmtStart(p.startMin)}
            </span>
            <span className="min-w-0 flex-1 truncate" style={{ color: "var(--ink)" }}>
              {p.task.title}
              {p.parts && p.parts > 1 && (
                <span className="tabular-nums" style={{ color: "var(--muted)" }}> · {p.part}/{p.parts}</span>
              )}
            </span>
            <span className="shrink-0 text-label tabular-nums" style={{ color: "var(--muted)" }}>{p.durationMin}m</span>
          </li>
        ))}
      </ul>

      {unplaced.length > 0 && (
        // Never let the accepted half imply the whole thing landed.
        <div className="mt-2 text-caption" style={{ color: "var(--muted)" }}>
          {unplaced.length} piece{unplaced.length === 1 ? "" : "s"} still won't fit — it stays loose.
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Button
          kind="primary"
          className="tap"
          onClick={() => {
            setPlacing(true);
            void place(placements)
              .then(onClose)
              .finally(() => setPlacing(false));
          }}
          disabled={placing}
          title="Write these blocks onto the week — the work joins the week and lands on the calendar"
        >
          {placing ? "Placing…" : `Place ${placements.length === 1 ? "it" : "them"}`}
        </Button>
        <Button kind="ghost" className="tap" onClick={onClose} title="Leave the week as it is">
          Cancel
        </Button>
      </div>
    </div>
  );
}
