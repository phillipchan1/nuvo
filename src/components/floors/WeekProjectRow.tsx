// One project on the week, at depth — the Week's Plan's working row.
//
// The rail crown answers "what am I on this week?" in a glance: name, a pip of
// progress, a tick. This row answers the question the crown can't hold — **is
// the week I committed to still true?** — and the thing that makes it answerable
// is the arithmetic line: how much of what's left actually has a time on the
// calendar, and how much is loose. A project with 4h remaining and nothing on
// the grid is not "in progress", it's a promise the week hasn't made room for.
//
// So every row that has a problem carries its remedy inline. D-039 put those
// acts on the Sunday step, while you're still choosing; nothing offered them on
// a Wednesday, which is exactly when the week stops being true. One panel at a
// time, gaps before placement — a project that isn't defined can't meaningfully
// be given "another week."
//
// A sealed week renders this read-only: the verdict is history, and history has
// no acts.

import { pushState, type PushState } from "../../lib/priorities";
import { fmtHours } from "../../lib/dates";
import { RemedyPanel } from "./RemedyPanel";
import type { WeekPriority } from "../../lib/composeWeek";

/** "2h has a time · 4h loose" — the row's whole reason for existing. Silent when
 *  nothing is left open (there's no honest arithmetic to state). */
function placementLine(p: WeekPriority): string | null {
  if (p.placedMins === 0 && p.looseMins === 0) return null;
  if (p.looseMins === 0) return `all ${fmtHours(p.placedMins)}h has a time`;
  if (p.placedMins === 0) return `${fmtHours(p.looseMins)}h loose`;
  return `${fmtHours(p.placedMins)}h has a time · ${fmtHours(p.looseMins)}h loose`;
}

function StateChip({ p, state, onShip }: { p: WeekPriority; state: PushState; onShip: () => void }) {
  const color = p.domainColor;
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;

  if (state === "shipped") {
    return (
      <span
        className="mono shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium"
        style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
      >
        shipped
      </span>
    );
  }
  if (state === "landed") {
    // Landing a week ≠ finishing the project — say so, so "landed" never reads
    // as "closed it" (Push verdict ≠ done).
    const continues = p.total > p.done;
    return <span className="mono shrink-0 text-micro text-muted">{continues ? "landed · continues" : "landed"}</span>;
  }
  if (state === "ready-to-ship") {
    return (
      <button
        onClick={onShip}
        title="Every task is done — ship it"
        className="tap fast mono shrink-0 rounded-full border border-accent/50 px-2 py-0.5 text-micro font-medium text-accent hover:bg-accent-soft"
      >
        ship ✓
      </button>
    );
  }
  if (p.total === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="block h-1 w-10 overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="mono text-micro text-muted">
        {p.done}/{p.total}
      </span>
    </span>
  );
}

export function WeekProjectRow({
  p,
  editable,
  onShip,
  onReopen,
  onSpan,
  onPushOut,
  onTakeOff,
  onOpenProject,
}: {
  p: WeekPriority;
  /** a sealed week is history — no acts */
  editable: boolean;
  onShip: () => void;
  onReopen: () => void;
  onSpan: () => void;
  onPushOut: () => void;
  onTakeOff: () => void;
  /** desktop only — the phone's shell doesn't mount the record overlay, so the
   *  gap sentence stands alone there rather than offering a dead button. */
  onOpenProject?: () => void;
}) {
  const state = pushState({ shipped: p.shipped, doneAt: p.rock.done_at, done: p.done, total: p.total });
  const line = editable ? placementLine(p) : null;
  const rolls = p.rock.roll_count ?? 0;

  // At most ONE panel, gaps first: a project that isn't defined can't be
  // sensibly given another week — fix what it means before you move it in time.
  const showGap = editable && !p.ready;
  const showLoose = editable && p.ready && p.looseMins > 0 && state !== "landed" && state !== "shipped";

  return (
    <div className="border-b border-line py-2">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={p.ready ? { background: p.domainColor } : { border: "1.5px solid var(--line-strong)" }}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          {onOpenProject ? (
            <button onClick={onOpenProject} title={`Open ${p.name}`} className="fast block w-full text-left">
              <span className={`text-body ${state === "landed" || state === "shipped" ? "text-muted" : "text-ink"}`}>{p.name}</span>
            </button>
          ) : (
            <span className={`block text-body ${state === "landed" || state === "shipped" ? "text-muted" : "text-ink"}`}>{p.name}</span>
          )}
          {/* What done looks like — the record's lead line, restated where the
              week's judgment is being made (Q3). */}
          {p.outcome.trim() && <div className="mt-0.5 truncate text-meta text-muted">{p.outcome}</div>}
          {(line || p.total > 0 || rolls > 0) && (
            <div className="mono mt-1 text-micro text-muted">
              {p.total > 0 && <span>{p.done} of {p.total} done</span>}
              {p.total > 0 && line && <span> · </span>}
              {line}
              {rolls > 0 && <span title={`Carried into week ${rolls + 1}`}> · wk {rolls + 1}</span>}
            </div>
          )}
        </div>

        {editable && state !== "shipped" && (
          <button
            onClick={state === "landed" ? onReopen : onShip}
            title={state === "landed" ? "Landed — tap to reopen" : "Ship it — you'll see what's still open first"}
            aria-label={state === "landed" ? "Reopen" : "Ship project"}
            className="fast mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-micro"
            style={{
              borderColor: p.domainColor,
              background: state === "landed" ? p.domainColor : "transparent",
              color: state === "landed" ? "#fff" : p.domainColor,
            }}
          >
            <span style={{ lineHeight: 1 }}>{state === "landed" ? "✓" : ""}</span>
          </button>
        )}

        <span className="mt-0.5">
          <StateChip p={p} state={state} onShip={onShip} />
        </span>
      </div>

      {showGap && (
        <div className="mt-2">
          <RemedyPanel
            problem={`It's missing ${p.gapLabel}.`}
            acts={
              onOpenProject
                ? [{ label: "Open the project", title: "A definition gets fixed where the project lives", onPress: onOpenProject }]
                : []
            }
          />
        </div>
      )}

      {showLoose && (
        <div className="mt-2">
          <RemedyPanel
            problem={`${fmtHours(p.looseMins)}h of what's left has no time this week.`}
            acts={[
              ...(p.placedMins > 0
                ? [
                    {
                      label: "Give it another week",
                      title: "Give it another week — same project, longer run. This week takes what fits; the rest continues next week.",
                      onPress: onSpan,
                    },
                  ]
                : []),
              {
                label: "Move it to next week",
                title: "Move the whole project to next week, keeping how long it runs.",
                onPress: onPushOut,
                quiet: true,
              },
              { label: "Take it off this week", title: "Off the week entirely — it goes back to needing a week.", onPress: onTakeOff, quiet: true },
            ]}
          />
        </div>
      )}
    </div>
  );
}
