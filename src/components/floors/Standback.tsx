// The Standback floor — the strategic face of the Today rung. Where the Now
// view answers "what do I start in the next ninety minutes", this answers the
// questions that sit a level up and a horizon out: what are the big bets, am I
// behind on any of them, and which domain have I quietly let go cold. It reads
// the board and surfaces only what's *off* — exceptions, not a wall of metrics —
// because the whole point is to catch the thing you couldn't put your finger on.

import { useMemo } from "react";
import type { VerticalData } from "../../lib/vertical";
import {
  readStandback,
  type BetRead,
  type BlindSpot,
  type Pace,
} from "../../lib/standback";

const NAME = "Phil";

const PACE_COLOR: Record<Pace, string> = {
  ahead: "var(--accent)",
  on_track: "var(--muted)",
  at_risk: "var(--signal)",
  behind: "var(--signal)",
  untracked: "var(--line-strong)",
};
const PACE_LABEL: Record<Pace, string> = {
  ahead: "ahead",
  on_track: "on pace",
  at_risk: "drifting",
  behind: "behind",
  untracked: "no date",
};

export default function Standback({
  data,
  now,
  onOpenInitiative,
  onOpenDomain,
}: {
  data: VerticalData;
  now: Date;
  onOpenInitiative: (id: string) => void;
  onOpenDomain: (id: string) => void;
}) {
  const read = useMemo(() => readStandback(data, now), [data, now]);
  const weekday = now.toLocaleDateString([], { weekday: "long" });
  const clock = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const hour = now.getHours();
  const part = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

  return (
    <div>
      {/* The strategic brief — Nuvo reading the board, not the day. */}
      <div className="border-b border-line pb-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="wordmark wordmark-grad text-[13px]">Nuvo</span>
            <span className="mono text-[10px] text-muted">the standback</span>
          </div>
          <div className="mono text-[12px] text-muted">{weekday} · {clock}</div>
        </div>
        <h1 className="mt-2 text-[18px] font-semibold tracking-tight">{part}, {NAME}. Here's where things stand.</h1>
        <p className="mt-1 max-w-[680px] text-[14px] leading-relaxed text-ink/90">{read.headline}</p>
      </div>

      {/* Drift — the "am I behind?" callout. Only shows when something is off. */}
      {read.drifting.length > 0 && (
        <div className="mt-6 rounded-lg border bg-surface p-4" style={{ borderColor: "var(--signal)", borderWidth: 1.5 }}>
          <div className="section-label flex items-center gap-2" style={{ color: "var(--signal)" }}>
            <span>⚠</span> Needs attention
          </div>
          <div className="mt-2.5 space-y-2">
            {read.drifting.map((b) => (
              <button
                key={b.initiative.id}
                onClick={() => onOpenInitiative(b.initiative.id)}
                className="fast group flex w-full items-baseline gap-2.5 text-left"
              >
                <span className="h-1.5 w-1.5 shrink-0 translate-y-[4px] rounded-full" style={{ background: b.domain?.color ?? "var(--line-strong)" }} />
                <span className="truncate text-[13px] text-ink group-hover:underline">{b.initiative.name}</span>
                <span className="mono shrink-0 text-[11px]" style={{ color: PACE_COLOR[b.trajectory.pace] }}>{b.trajectory.note}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The big bets — the active board, loudest first. */}
      <div className="mt-7">
        <div className="section-label mb-2.5">The big bets {read.activeCount > 0 && <span className="text-line">· {read.activeCount} active</span>}</div>
        {read.bets.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface-2 p-6 text-center text-[13px] text-muted">
            No active initiatives — the board is clear.
          </div>
        ) : (
          <div className="space-y-2">
            {read.bets.map((b) => <BetCard key={b.initiative.id} bet={b} onOpen={() => onOpenInitiative(b.initiative.id)} />)}
          </div>
        )}
      </div>

      {/* Blind spots — the "did I neglect something?" read. */}
      {read.blindSpots.length > 0 && (
        <div className="mt-7 border-t border-line pt-4">
          <div className="section-label mb-2.5">Blind spots · going quiet</div>
          <div className="space-y-1.5">
            {read.blindSpots.map((s) => <BlindSpotRow key={s.domain.id} spot={s} onOpen={() => onOpenDomain(s.domain.id)} />)}
          </div>
          <div className="mono mt-3 flex items-center gap-1.5 text-[10.5px] text-muted">
            <span>⚖</span> A short task in a quiet domain is enough to start the arc again.
          </div>
        </div>
      )}
    </div>
  );
}

function BetCard({ bet, onOpen }: { bet: BetRead; onOpen: () => void }) {
  const { initiative, domain, progress, trajectory, lastTouchedDays } = bet;
  const accent = domain?.color ?? "var(--accent)";
  const expected = trajectory.expected;

  return (
    <button
      onClick={onOpen}
      className="rise fast block w-full rounded-lg border border-line bg-surface p-3.5 text-left hover:border-[color:var(--line-strong)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-medium leading-snug">{initiative.name}</div>
          {initiative.outcome && (
            <div className="mono mt-0.5 truncate text-[11px] text-muted">{initiative.outcome}</div>
          )}
        </div>
        <span
          className="mono shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{
            color: PACE_COLOR[trajectory.pace],
            background: `color-mix(in srgb, ${PACE_COLOR[trajectory.pace]} 12%, transparent)`,
          }}
        >
          {PACE_LABEL[trajectory.pace]}
        </span>
      </div>

      {/* progress, with a hairline marker for where the calendar says you'd be */}
      <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(progress, 2)}%`, background: accent }} />
        {expected != null && expected > 0 && expected < 100 && (
          <span
            className="absolute top-1/2 h-3 w-px -translate-y-1/2"
            title="where you'd be, on pace"
            style={{ left: `${expected}%`, background: "var(--text)", opacity: 0.5 }}
          />
        )}
      </div>

      <div className="mono mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px]">
        {domain && <span style={{ color: domain.color }}>{domain.name}</span>}
        <span className="text-line">·</span>
        <span className="text-muted">{progress}%</span>
        <span className="text-line">·</span>
        <span style={{ color: PACE_COLOR[trajectory.pace] }}>{trajectory.note}</span>
        {lastTouchedDays != null && lastTouchedDays >= 4 && (
          <>
            <span className="text-line">·</span>
            <span className="text-muted">last touched {lastTouchedDays}d ago</span>
          </>
        )}
        {lastTouchedDays == null && (
          <>
            <span className="text-line">·</span>
            <span className="text-muted">no work logged yet</span>
          </>
        )}
      </div>
    </button>
  );
}

function BlindSpotRow({ spot, onOpen }: { spot: BlindSpot; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="fast group flex w-full items-center gap-2.5 text-left" style={{ opacity: 0.9 }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: spot.domain.color }} />
      <span className="text-[12.5px] text-ink group-hover:underline">{spot.domain.name}</span>
      <span className="mono text-[10.5px] text-muted">{spot.note}</span>
      {spot.domain.intention && (
        <span className="mono ml-auto hidden truncate text-[10px] text-line sm:inline">{spot.domain.intention}</span>
      )}
    </button>
  );
}
