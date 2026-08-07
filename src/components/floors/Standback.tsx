// The Standback floor — the strategic face of the Today rung, read in Gain.
// It opens on how far you've come this week and what that progress *means*
// (the implication, not just the checkmark), holds the horizon quietly as a
// compass for where to point next, and frames a quiet domain as an open
// invitation rather than a failure. The whole posture is backward-looking by
// design: you leave it feeling progress, not pressure.

import { useMemo } from "react";
import type { VerticalData } from "../../lib/vertical";
import { readStandback, type Forward, type Pace, type Win } from "../../lib/standback";
import { BigRocksReckoning } from "./bigRocks";

const NAME = "Phil";

const WIN_GLYPH: Record<Win["kind"], string> = {
  shipped: "★",
  milestone: "◆",
  unblocked: "→",
  advanced: "↗",
  kept: "♢",
};

// Calm by intent — the compass uses accent for good and muted for neutral.
// There is no alarm red here; "ready for a pull" is an invitation, not a siren.
const PACE_COLOR: Record<Pace, string> = {
  ahead: "var(--accent)",
  on_track: "var(--muted)",
  needs_pull: "var(--line-strong)",
  untracked: "var(--line-strong)",
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
  const fmtH = (h: number) => `${h.toFixed(h % 1 === 0 ? 0 : 1)}h`;

  const { invitation } = read;

  return (
    <div>
      {/* The Gain — Nuvo reading how far you've come, not how far is left. */}
      <div className="border-b border-line pb-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="wordmark wordmark-grad text-body">Nuvo</span>
            <span className="mono text-meta text-muted">the gain</span>
          </div>
          <div className="mono text-caption text-muted">{weekday} · {clock}</div>
        </div>
        <h1 className="mt-2 text-lead masthead">{part}, {NAME}. Look how far you've come.</h1>
        <p className="mt-1 max-w-[680px] text-head leading-relaxed text-ink/90">{read.greeting}</p>

        <div className="mono mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-label">
          <span className="flex items-center gap-1.5 text-accent"><span>⏱</span>{fmtH(read.hoursThisWeek)} this week</span>
          {read.betsMoved > 0 && <span className="flex items-center gap-1.5 text-muted"><span>↗</span>{read.betsMoved} initiative{read.betsMoved === 1 ? "" : "s"} moved</span>}
          {read.wins.length > 0 && <span className="flex items-center gap-1.5 text-muted"><span>✓</span>{read.wins.length} win{read.wins.length === 1 ? "" : "s"}</span>}
        </div>
      </div>

      {/* Big rocks — the week's reckoning: which ones moved. */}
      <BigRocksReckoning data={data} />

      {/* The wins themselves — each gain with the intelligence of what it means. */}
      <div className="mt-7">
        <div className="section-label mb-2.5">The gain · this week</div>
        {read.wins.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface-2 p-6 text-center text-body text-muted">
            Nothing's crossed the line yet this week — the next pull starts the streak.
          </div>
        ) : (
          <div className="space-y-2">
            {read.wins.map((w) => <WinRow key={w.id} win={w} />)}
          </div>
        )}
      </div>

      {/* The compass — the horizon as direction, deliberately quiet and small. */}
      {read.compass.length > 0 && (
        <div className="mt-7 border-t border-line pt-4">
          <div className="section-label mb-2.5">Where to point next</div>
          <div className="space-y-1.5">
            {read.compass.map((f) => <CompassRow key={f.initiative.id} fwd={f} onOpen={() => onOpenInitiative(f.initiative.id)} />)}
          </div>
        </div>
      )}

      {/* When you're ready — the trade-off honored, the quiet domain invited
          back. A redirect, never an indictment. */}
      {(invitation.investedMost || invitation.readyForYou) && (
        <div className="mt-7 border-t border-line pt-4">
          <div className="section-label mb-2">When you're ready</div>
          <p className="max-w-[640px] text-body leading-relaxed text-ink/85">
            {invitation.investedMost && (
              <>You leaned into <span className="font-medium" style={{ color: invitation.investedMost.domain.color }}>{invitation.investedMost.domain.name}</span> this week — {fmtH(invitation.investedMost.hours)}, and that focus is what moved things. </>
            )}
            {invitation.readyForYou && (
              <>
                <button onClick={() => onOpenDomain(invitation.readyForYou!.id)} className="fast font-medium underline-offset-2 hover:underline" style={{ color: invitation.readyForYou.color }}>{invitation.readyForYou.name}</button>
                {invitation.readyForYou.lastTouchedDays == null
                  ? " is there whenever you want to begin its arc."
                  : ` has been quiet — it's there when you're ready, no rush.`}
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function WinRow({ win }: { win: Win }) {
  const accent = win.accent ?? "var(--accent)";
  return (
    <div className="rise rounded-lg border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-4 shrink-0 text-center text-body" style={{ color: accent }}>{WIN_GLYPH[win.kind]}</span>
        <div className="min-w-0">
          <div className="text-head font-medium leading-snug">{win.headline}</div>
          {win.implication && (
            <div className="mt-0.5 text-caption leading-relaxed text-muted">{win.implication}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function CompassRow({ fwd, onOpen }: { fwd: Forward; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="fast group flex w-full items-center gap-2.5 text-left">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: fwd.domain?.color ?? "var(--line-strong)" }} />
      <span className="truncate text-caption text-ink group-hover:underline">{fwd.initiative.name}</span>
      <span className="mono shrink-0 text-meta text-muted">{fwd.progress}%</span>
      <span className="mono ml-auto shrink-0 text-meta" style={{ color: PACE_COLOR[fwd.pace] }}>{fwd.line}</span>
    </button>
  );
}
