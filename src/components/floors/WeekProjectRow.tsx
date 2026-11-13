// One project on the week, at depth — the Week's Plan's working row.
//
// The rail crown answers "what am I on this week?" in a glance: name, a pip of
// progress, a tick. This row answers the question the crown can't hold — **is
// the week I committed to still true?** — and the thing that makes it answerable
// is the arithmetic line: how much of what's left actually has a time on the
// calendar, and how much is loose. A project with 4h remaining and nothing on
// the grid is not "in progress", it's a promise the week hasn't made room for.
//
// So every row that has a problem carries its remedy inline. One panel at a
// time, gaps before placement — a project that isn't defined can't meaningfully
// be given "another week."
//
// A sealed week renders this read-only: the verdict is history, and history has
// no acts. Instrument (D-189/D-190): a kit row — identity Dot, the name, the
// arithmetic in tabular figures, the round TaskCheck that ships, a PaceTrack.

import { useState } from "react";
import { carryMark, pushState, type PushState } from "../../lib/priorities";
import { fmtHours } from "../../lib/dates";
import { RemedyPanel } from "./RemedyPanel";
import { FindTimeProposal } from "./FindTimeProposal";
import { DeferPanel } from "./DeferPanel";
import { useProjectTimeCost } from "../../hooks/useProjectTime";
import { costPhrase } from "../../lib/projectTime";
import type { Project } from "../../lib/vertical";
import type { WeekPriority } from "../../lib/composeWeek";
import { Button, Chip, ChipButton, Dot, PaceTrack, TaskCheck } from "../kit";
import { Icon } from "../Icon";

/** "2h has a time · 4h loose" — the row's whole reason for existing. Silent when
 *  nothing is left open (there's no honest arithmetic to state). */
function placementLine(p: WeekPriority): string | null {
  if (p.placedMins === 0 && p.looseMins === 0) return null;
  if (p.looseMins === 0) return `all ${fmtHours(p.placedMins)}h has a time`;
  if (p.placedMins === 0) return `${fmtHours(p.looseMins)}h loose`;
  return `${fmtHours(p.placedMins)}h has a time · ${fmtHours(p.looseMins)}h loose`;
}

function StateChip({ p, state, onShip }: { p: WeekPriority; state: PushState; onShip: () => void }) {
  if (state === "shipped") {
    return (
      <Chip tone="ok" icon={<Icon name="check" size={11} />}>
        Shipped
      </Chip>
    );
  }
  if (state === "landed") {
    // Landing a week ≠ finishing the project — say so, so "landed" never reads
    // as "closed it" (Push verdict ≠ done).
    const continues = p.total > p.done;
    return <span className="shrink-0 text-caption text-[var(--faint)]">{continues ? "Landed · continues" : "Landed"}</span>;
  }
  if (state === "ready-to-ship") {
    return (
      <ChipButton icon={<Icon name="check" size={11} />} onClick={onShip} title="Every task is done — ship it" className="f-chip-on">
        Ship
      </ChipButton>
    );
  }
  if (p.total === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-2">
      <PaceTrack done={p.done} total={p.total} color={p.domainColor} width={48} />
      <span className="f-num text-caption text-[var(--faint)]">
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
  weekStartISO,
  project,
}: {
  p: WeekPriority;
  /** a sealed week is history — no acts */
  editable: boolean;
  onShip: () => void;
  onReopen: () => void;
  onSpan: () => void;
  onPushOut: () => void;
  onTakeOff: () => void;
  /** the week the row belongs to — the placement act needs a week to search */
  weekStartISO: string;
  /** the live project behind the row — what "can't get to it" defers */
  project?: Project | null;
  /** desktop only — the phone's shell doesn't mount the record overlay, so the
   *  gap sentence stands alone there rather than offering a dead button. */
  onOpenProject?: () => void;
}) {
  const state = pushState({ shipped: p.shipped, doneAt: p.rock.done_at, done: p.done, total: p.total });
  const line = editable ? placementLine(p) : null;
  const rolls = p.rock.roll_count ?? 0;
  // The placement act opens in place, under the row that named the problem —
  // not in a modal. This surface is already an overlay (a Sheet on the phone),
  // and a second layer over it is where tap paths go to die.
  const [finding, setFinding] = useState(false);

  // At most ONE panel, gaps first: a project that isn't defined can't be
  // sensibly given another week — fix what it means before you move it in time.
  const showGap = editable && !p.ready;
  const showLoose = editable && p.ready && p.looseMins > 0 && state !== "landed" && state !== "shipped";
  // A project whose work all has a time has no problem to name — and so, until
  // now, no panel and no way off the week. The door is yours to open instead.
  const canDefer = editable && !showGap && !showLoose && !!project && state !== "landed" && state !== "shipped";
  const [deferring, setDeferring] = useState(false);
  // What leaving the week would take off the calendar — said before the press.
  const cleared = costPhrase(useProjectTimeCost(p.projectId, "next_week", weekStartISO));
  const quiet = state === "landed" || state === "shipped";

  return (
    <div className="py-2.5" style={{ boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
      <div className="flex items-start gap-2.5 px-1">
        <span className="flex h-5 shrink-0 items-center">
          {p.ready ? (
            <Dot color={p.domainColor} />
          ) : (
            <span aria-hidden className="h-2 w-2 rounded-[2.5px]" style={{ boxShadow: "inset 0 0 0 1.5px var(--line-2)" }} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          {onOpenProject ? (
            <button type="button" onClick={onOpenProject} title={`Open ${p.name}`} className="block w-full text-left">
              <span className="text-body font-medium" style={{ color: quiet ? "var(--muted)" : "var(--ink)" }}>
                {p.name}
              </span>
            </button>
          ) : (
            <span className="block text-body font-medium" style={{ color: quiet ? "var(--muted)" : "var(--ink)" }}>
              {p.name}
            </span>
          )}
          {/* What done looks like — the record's lead line, restated where the
              week's judgment is being made (Q3). Old sealed snapshots predate
              this field — `outcome` isn't guaranteed on a stored row. */}
          {p.outcome?.trim() && <div className="mt-0.5 truncate text-caption text-muted">{p.outcome}</div>}
          {(line || p.total > 0 || rolls > 0) && (
            <div className="f-num mt-1 text-caption text-[var(--faint)]">
              {p.total > 0 && (
                <span>
                  {p.done} of {p.total} done
                </span>
              )}
              {p.total > 0 && line && <span> · </span>}
              {line}
              {rolls > 0 && <span title={carryMark(rolls).title}> · {carryMark(rolls).text}</span>}
            </div>
          )}
        </div>

        <span className="flex h-5 shrink-0 items-center gap-2.5">
          <StateChip p={p} state={state} onShip={onShip} />
          {editable && state !== "shipped" && (
            <TaskCheck
              checked={state === "landed"}
              onChange={() => (state === "landed" ? onReopen() : onShip())}
              label={state === "landed" ? "Reopen" : "Ship project"}
            />
          )}
        </span>
      </div>

      {showGap && (
        <div className="mt-2 pl-[22px]">
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

      {showLoose && finding && p.projectId && (
        <div className="mt-2 pl-[22px]">
          <FindTimeProposal
            projectId={p.projectId}
            weekStartISO={weekStartISO}
            looseMins={p.looseMins}
            onClose={() => setFinding(false)}
          />
        </div>
      )}

      {showLoose && !finding && (
        <div className="mt-2 pl-[22px]">
          <RemedyPanel
            problem={`${fmtHours(p.looseMins)}h of what's left has no time this week.`}
            why={cleared ? `Moving it or taking it off the week clears ${cleared} off the calendar.` : undefined}
            acts={[
              // Placement first. The acts after it are all ways to give up on the
              // work; a project that simply needs an hour found on Thursday
              // shouldn't only be deferrable.
              ...(p.projectId
                ? [
                    {
                      label: "Find it time this week",
                      title: "Look at what's left of the week and propose blocks for this work — nothing moves until you place them.",
                      onPress: () => setFinding(true),
                    },
                  ]
                : []),
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

      {canDefer && project && (
        <div className="mt-1 pl-[18px]">
          {deferring ? (
            <DeferPanel project={project} weekStartISO={weekStartISO} onDone={() => setDeferring(false)} />
          ) : (
            <Button size="xs" kind="ghost" onClick={() => setDeferring(true)} title="Move it to next week, or take it off the week">
              Can’t get to it…
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
