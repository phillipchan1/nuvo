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

  return (
    <div className="mb-2 rounded-md px-2.5 py-2" style={{ background: "var(--accent-soft)" }}>
      <div className="text-caption" style={{ color: "var(--accent)" }}>
        {placements.length} block{placements.length === 1 ? "" : "s"} · {fmtHours(total)}h found
      </div>

      <ul className="mt-1.5 space-y-1">
        {placements.map((p) => (
          <li key={`${p.task.id}-${p.dayISO}-${p.startMin}`} className="flex items-baseline gap-2 text-meta">
            <span className="mono shrink-0 text-muted">
              {format(parseDateISO(p.dayISO), "EEE")} {fmtStart(p.startMin)}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink">
              {p.task.title}
              {p.parts && p.parts > 1 && (
                <span className="mono text-muted"> · {p.part}/{p.parts}</span>
              )}
            </span>
            <span className="mono shrink-0 text-muted">{p.durationMin}m</span>
          </li>
        ))}
      </ul>

      {unplaced.length > 0 && (
        // Never let the accepted half imply the whole thing landed.
        <div className="mt-1.5 text-meta text-muted">
          {unplaced.length} piece{unplaced.length === 1 ? "" : "s"} still won't fit — it stays loose.
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button
          onClick={() => {
            setPlacing(true);
            void place(placements)
              .then(onClose)
              .finally(() => setPlacing(false));
          }}
          disabled={placing}
          title="Write these blocks onto the week — the work joins the week and lands on the calendar"
          className="tap fast inline-flex min-h-[44px] items-center rounded-md border border-accent/50 px-2.5 py-1 text-caption text-accent hover:bg-accent-soft disabled:opacity-50"
        >
          {placing ? "Placing…" : `Place ${placements.length === 1 ? "it" : "them"}`}
        </button>
        <button
          onClick={onClose}
          title="Leave the week as it is"
          className="tap fast inline-flex min-h-[44px] items-center rounded-md border border-line px-2.5 py-1 text-caption text-muted hover:border-line-strong hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
