// Plan the week, on a phone — the same act the desktop runs, laid out for a thumb.
//
// The desktop lays the week out as one wide board (sources left, a seven-column
// grid you drag on). A phone can't hold that board, but the *act* isn't the board:
// it's deciding what the week carries, by source, and then when each piece happens.
//
//   1 · Projects   — the projects you're moving, and the work that moves them
//   2 · Leftovers  — what you already owed: carried over, due, or going quiet
//   3 · Inbox      — raw captures, grouped into named runs
//   4 · The week   — where it all lands, day by day, and whether it fits. Commit.
//
// The steps are named after the thing itself, never after a verb we invented.
//
// The desktop keeps its week grid on screen beside every source, so a keep or a
// drop re-shapes the week under your cursor. A 375px phone has no room for that,
// so it carries the same fact in the one line that matters: `CapacityMeter` sits
// under the step rail on **every** step, and it reports both what the week is
// being asked to carry and — the part that used to arrive too late — how much of
// it found no room. You learn "the week is full" while you can still act on it.
//
// Everything that decides *what* the week is comes from `useWeekDraft` — the same
// hook the desktop uses. This file only lays it out and offers taps: no drag,
// every move has a tap path (mobile golden rule #4), 44px targets, safe areas.

import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useWeekDraft } from "../../hooks/useWeekDraft";
import { projectsOnDeck, weekPushes } from "../../lib/priorities";
import { lensGaps } from "../../lib/lenses";
import { domainById, taskDomainColor, type Project, type VerticalData } from "../../lib/vertical";
import { fmtHours as hrs, parseDateISO, planningWeekStartISO } from "../../lib/dates";
import { bringIntoWeekPatch, takeOffWeekPatch } from "../../../supabase/functions/_shared/planningRules.ts";
import { sprintLabel } from "../../lib/sprint";
import { LANE_QUESTION, REVEALED_BY_LANE, workBadge } from "../../lib/intake";
import type { Batch } from "../../lib/batch";
import type { Placement } from "../../lib/compose";
import { toBusyBlocks, type BusyBlock } from "../../lib/now";
import SourceSwitch, { CapacityMeter, WEEK_STEPS, type WeekStep } from "../rituals/WeekIntake";
import DurationSelect from "../DurationSelect";

/** The forward beat — named after the ACT, not the destination. "Leftovers →"
 *  said where you'd land and nothing about what pressing it does; each press
 *  pours one more source into the week. */
const NEXT: Partial<Record<WeekStep, { to: WeekStep; label: string }>> = {
  projects: { to: "loose", label: "Add what's left over →" },
  loose: { to: "inbox", label: "Add the inbox →" },
  inbox: { to: "week", label: "See the week →" },
};

const fmtMinShort = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "pm" : "am", hh = ((h + 11) % 12) + 1;
  return mm === 0 ? `${hh}${ap}` : `${hh}:${String(mm).padStart(2, "0")}${ap}`;
};

export default function MobilePlanWeek({ onClose }: { onClose: () => void }) {
  const draft = useWeekDraft();
  const { updateProject, updateTask } = useVertical();
  const [step, setStep] = useState<WeekStep>("projects");

  const {
    data,
    weekStartISO,
    planningAhead,
    gridDays,
    byLane,
    intake,
    kept,
    setKept,
    keptTasks,
    dropBlock,
    routedCount,
    slotById,
    runs,
    visibleEvents,
    onCalBlocks,
    workStart,
    workEnd,
    result,
    placements,
    gain,
    inboxCount,
    themeInbox,
    theming,
    themeErr,
    themeCarried,
    themingCarried,
    carriedErr,
    goal,
    commit,
    applying,
    committed,
  } = draft;

  // The week's projects — derived from the On Deck spans, never stored. Bringing a
  // project in / taking it off IS the placement write, same as the deck's drop.
  const pushes = useMemo(() => weekPushes(data, weekStartISO), [data, weekStartISO]);
  const bringIn = (p: Project) => {
    const patch = bringIntoWeekPatch(p, weekStartISO);
    if (patch) updateProject(p.id, patch);
  };
  const takeOff = (p: Project) => updateProject(p.id, takeOffWeekPatch());
  const setDuration = (taskId: string, mins: number) => updateTask(taskId, { durationMins: mins });

  // the one "what counts as busy" rule (lib/now.ts) — the day strips draw what the
  // week already owes, so an empty-looking day full of meetings can't read as free
  const busy = useMemo(() => toBusyBlocks(visibleEvents, onCalBlocks), [visibleEvents, onCalBlocks]);

  const weekLabel = format(parseDateISO(weekStartISO), "MMMM d");
  const spanLabel = `${format(parseDateISO(weekStartISO), "MMM d")}–${format(addDays(parseDateISO(weekStartISO), 6), "MMM d")}`;

  if (committed) {
    return (
      <Overlay>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="section-label">{sprintLabel(weekStartISO)}</div>
          <h1 className="mt-2 text-display masthead leading-tight">The week is set</h1>
          <p className="mono mt-3 text-body text-muted">
            {placements.length} scheduled · {keptTasks.length} committed
            {routedCount > 0 && ` · ${routedCount} standing`}
          </p>
          {goal.trim() && <p className="mt-2 text-body text-ink">“{goal.trim()}”</p>}
        </div>
        <Footer>
          <PrimaryButton onClick={onClose}>Done</PrimaryButton>
        </Footer>
      </Overlay>
    );
  }

  const next = NEXT[step];

  return (
    <Overlay>
      {/* Header — transparent over the atmosphere, hairline only */}
      <header className="shrink-0 border-b border-line px-4 pb-2 pt-safe">
        <div className="flex items-start gap-2 pt-2">
          <div className="min-w-0 flex-1">
            <div className="section-label !p-0">
              <span style={{ color: "var(--accent)" }}>{sprintLabel(weekStartISO)}</span> · {spanLabel} ·{" "}
              {planningAhead ? "the week ahead" : "this week"}
            </div>
            <h1 className="masthead truncate text-head text-ink">Week of {weekLabel}</h1>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="tap fast -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2"
          >
            ✕
          </button>
        </div>
        <div className="mt-2.5">
          <SourceSwitch
            step={step}
            onStep={setStep}
            steps={WEEK_STEPS}
            dense
          />
        </div>
        {/* the week's one honest read, on every step — the phone's stand-in for
            the desktop's always-visible grid. It reveals by source the same way
            the desktop grid does: sources you haven't reached yet ghost, so the
            meter fills in as you go without ever misstating the total. */}
        <div className="mt-2.5">
          <CapacityMeter
            intake={intake}
            fit={{ placed: placements.length, unplaced: result.unplaced.length }}
            revealed={step === "week" ? undefined : REVEALED_BY_LANE[step]}
            compact
            dense
          />
        </div>
      </header>

      <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {step === "projects" && (
          <ProjectsStep
            data={data}
            weekStartISO={weekStartISO}
            pushes={pushes}
            gain={gain}
            suggestions={byLane.projects}
            kept={kept}
            setKept={setKept}
            onDuration={setDuration}
            onBringIn={bringIn}
            onTakeOff={takeOff}
          />
        )}
        {step === "loose" && (
          <LeftoversStep
            data={data}
            suggestions={byLane.loose}
            kept={kept}
            setKept={setKept}
            onDuration={setDuration}
            onBundleCarried={() => void themeCarried()}
            bundling={themingCarried}
            bundleErr={carriedErr}
          />
        )}
        {step === "inbox" && (
          <InboxStep
            data={data}
            suggestions={byLane.inbox}
            runs={runs}
            kept={kept}
            setKept={setKept}
            onDuration={setDuration}
            inboxCount={inboxCount}
            onGroup={() => void themeInbox()}
            grouping={theming}
            groupErr={themeErr}
          />
        )}
        {step === "week" && (
          <WeekStep
            data={data}
            days={gridDays}
            placements={placements}
            slotNameById={slotById}
            unplaced={result.unplaced}
            routedCount={routedCount}
            busy={busy}
            workStart={workStart}
            workEnd={workEnd}
            onDrop={dropBlock}
          />
        )}
      </div>

      <Footer progress={(WEEK_STEPS.indexOf(step) + 1) / WEEK_STEPS.length}>
        <div className="flex items-center gap-3">
          {/* The capacity read lives once, in the header meter — a second one down
              here quoted different arithmetic for the same week. */}
          <div className="mono min-w-0 flex-1 text-meta text-muted">
            {keptTasks.length} in the week
          </div>
          {next ? (
            <PrimaryButton onClick={() => setStep(next.to)} compact>{next.label}</PrimaryButton>
          ) : (
            <PrimaryButton onClick={() => void commit()} disabled={applying} compact>
              {applying ? "committing…" : "Commit the week"}
            </PrimaryButton>
          )}
        </div>
      </Footer>
    </Overlay>
  );
}

/** The Week segment's entry to the flow — a live read of what's committed, then
 *  the act. Sits above the week's plan/review card: you set the week here, you
 *  watch it land there. */
export function PlanWeekCard({ onOpen }: { onOpen: () => void }) {
  const { data } = useVertical();
  const weekStartISO = planningWeekStartISO();
  const pushes = useMemo(() => weekPushes(data, weekStartISO), [data, weekStartISO]);
  const ready = pushes.filter(({ project }) => lensGaps(data, "project", project, new Date()).length === 0).length;

  return (
    <button
      onClick={onOpen}
      className="tap fast flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-3 text-left active:bg-surface"
    >
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-lead"
        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        aria-hidden
      >
        ◴
      </span>
      <div className="min-w-0 flex-1">
        <div className="section-label !p-0">{sprintLabel(weekStartISO)}</div>
        <div className="masthead truncate text-head text-ink">Plan the week</div>
        <div className="truncate text-caption text-muted">
          {pushes.length === 0
            ? "No projects yet — pick what moves"
            : `${pushes.length} project${pushes.length === 1 ? "" : "s"} · ${ready} ready to schedule`}
        </div>
      </div>
      <span className="shrink-0 text-muted">›</span>
    </button>
  );
}

// ── chrome ───────────────────────────────────────────────────────────────────

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: "color-mix(in srgb, var(--bg) 96%, transparent)", backdropFilter: "blur(20px)" }}
    >
      {children}
    </div>
  );
}

function Footer({ children, progress }: { children: React.ReactNode; progress?: number }) {
  return (
    <footer className="relative shrink-0 border-t border-line px-4 py-3 pb-safe">
      {/* the walk, drawn — same hairline the desktop wears over its stepper, so
          "how far through am I" reads the same on both shells */}
      {progress != null && (
        <div className="absolute inset-x-0 top-0 h-[2px] overflow-hidden" aria-hidden>
          <div
            className="h-full"
            style={{ width: `${progress * 100}%`, background: "var(--accent)", transition: "width .42s var(--ease-out)" }}
          />
        </div>
      )}
      {children}
    </footer>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  compact,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`tap fast flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-5 text-body font-medium text-white active:scale-[0.98] disabled:opacity-50 ${
        compact ? "shrink-0" : "w-full"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "accent" | "signal" }) {
  return (
    <span
      className="mono rounded-full px-2 py-0.5 text-micro"
      style={
        tone === "accent"
          ? { color: "var(--accent)", background: "var(--accent-soft)" }
          : tone === "signal"
            ? { color: "var(--signal)", background: "var(--signal-soft)" }
            : { color: "var(--muted)", border: "1px solid var(--line)" }
      }
    >
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-caption text-muted">{children}</p>;
}

/** Every step opens with the question it answers and nothing else. Instructions
 *  ("tap to drop anything…", "Nuvo can group like with like…") were the first thing
 *  cut: they teach a mechanic you learn once and then re-read fifty-one times a
 *  year. What survives is state, and state gets a number or a shape, not a
 *  sentence. */
function StepHead({ question, count }: { question: string; count?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="masthead min-w-0 flex-1 text-head text-ink">{question}</h2>
      {count && <span className="mono shrink-0 text-meta text-muted">{count}</span>}
    </div>
  );
}

type Suggestion = ReturnType<typeof useWeekDraft>["suggestions"][number];

// ── 1 · projects — what you're moving, and the work that moves it ─────────────

export function ProjectsStep({
  data,
  weekStartISO,
  pushes,
  gain,
  suggestions,
  kept,
  setKept,
  onDuration,
  onBringIn,
  onTakeOff,
}: {
  data: VerticalData;
  weekStartISO: string;
  pushes: ReturnType<typeof weekPushes>;
  gain: { doneCount: number; doneMins: number; topMove: { name: string; from: number; to: number } | null; quiet: string[] };
  suggestions: Suggestion[];
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  onDuration: (taskId: string, mins: number) => void;
  onBringIn: (p: Project) => void;
  onTakeOff: (p: Project) => void;
}) {
  const [showElsewhere, setShowElsewhere] = useState(false);
  const onDeckIds = new Set(projectsOnDeck(data, weekStartISO).map((p) => p.id));
  const open = data.projects.filter(
    (p) => p.status !== "complete" && p.status !== "cancelled" && !onDeckIds.has(p.id),
  );
  // Projects with no week yet are the natural candidates; ones parked on another
  // week stay a tap away, labelled with where they sit — bringing one in MOVES it.
  const needsWeek = open.filter((p) => !p.targetDate);
  const elsewhere = open.filter((p) => p.targetDate);

  // each project's own open work, under its name — naming a project has to bring
  // its work with it, or step 4 has nothing to place
  const byProject = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    const key = s.projectId ?? "loose";
    byProject.set(key, [...(byProject.get(key) ?? []), s]);
  }

  return (
    <div>
      {/* last week, as chips. It was a sentence with three clauses and two full
          stops; nobody parses grammar to learn they did nine hours. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip>{gain.doneCount} done · {hrs(gain.doneMins)}h</Chip>
        {gain.topMove && (
          <Chip tone="accent">{gain.topMove.name} ↑{gain.topMove.to - gain.topMove.from}</Chip>
        )}
        {gain.quiet.map((q) => (
          <Chip key={q} tone="signal">{q} quiet</Chip>
        ))}
      </div>

      <h2 className="masthead mt-4 text-head text-ink">{LANE_QUESTION.projects}</h2>

      {pushes.length > 0 ? (
        <div className="mt-3 border-t border-line">
          {pushes.map(({ project, shipped }) => {
            const color = domainById(data, project.domainId)?.color ?? "var(--accent)";
            const gaps = lensGaps(data, "project", project, new Date());
            const ready = gaps.length === 0;
            const work = byProject.get(project.id) ?? [];
            const on = work.filter((s) => kept.has(s.task.id)).length;
            return (
              <div key={project.id} className="border-b border-line py-3">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={ready ? { background: color } : { border: "1.5px solid var(--line-strong)" }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-body text-ink">{project.name}</span>
                      {/* how much of this project's work is in the week — a meter
                          and a fraction, where a clause used to be */}
                      {work.length > 0 && (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span className="h-1 w-8 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                            <span
                              className="block h-full rounded-full transition-[width] duration-300"
                              style={{ width: `${(on / work.length) * 100}%`, background: color }}
                            />
                          </span>
                          <span className="mono text-micro text-muted">{on}/{work.length}</span>
                        </span>
                      )}
                    </div>
                    {/* a missing outcome is already reported by the gap line below —
                        saying it twice made the row look broken */}
                    {project.outcome?.trim() && (
                      <div className="truncate text-caption text-muted">{project.outcome.trim()}</div>
                    )}
                    {/* "ready to schedule" said nothing the filled dot didn't. Only
                        the gaps — the actionable half — still earn a line. */}
                    {shipped ? (
                      <div className="mono mt-0.5 text-micro" style={{ color }}>shipped</div>
                    ) : !ready ? (
                      <div className="mono mt-0.5 text-micro text-muted">{gaps.map((g) => g.label).join(" · ")}</div>
                    ) : null}
                  </div>
                  <button
                    onClick={() => onTakeOff(project)}
                    aria-label={`Take ${project.name} off this week`}
                    className="tap fast -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2"
                  >
                    ✕
                  </button>
                </div>
                {work.length > 0 && (
                  <div className="mt-1 pl-5">
                    {work.map((s) => (
                      <WorkRow
                        key={s.task.id}
                        data={data}
                        s={s}
                        on={kept.has(s.task.id)}
                        onToggle={() => toggle(kept, setKept, s.task.id)}
                        onDuration={onDuration}
                        hideReason
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty>Nothing on this week yet.</Empty>
      )}

      {(byProject.get("loose")?.length ?? 0) > 0 && (
        <section className="mt-5">
          <div className="section-label mb-1 !p-0">Project work, no week set</div>
          <div className="border-t border-line">
            {byProject.get("loose")!.map((s) => (
              <WorkRow key={s.task.id} data={data} s={s} on={kept.has(s.task.id)} onToggle={() => toggle(kept, setKept, s.task.id)}
                        onDuration={onDuration} />
            ))}
          </div>
        </section>
      )}

      {(needsWeek.length > 0 || elsewhere.length > 0) && (
        <div className="mt-5">
          <div className="section-label mb-2 !p-0">Add a project</div>
          <div className="flex flex-wrap gap-2">
            {needsWeek.map((p) => (
              <ProjectChip key={p.id} data={data} p={p} onTap={() => onBringIn(p)} />
            ))}
            {showElsewhere &&
              elsewhere.map((p) => (
                <ProjectChip
                  key={p.id}
                  data={data}
                  p={p}
                  reason={`week of ${format(parseDateISO(p.targetDate!), "MMM d")}`}
                  onTap={() => onBringIn(p)}
                />
              ))}
            {elsewhere.length > 0 && (
              <button
                onClick={() => setShowElsewhere((s) => !s)}
                className="tap fast min-h-[44px] rounded-full px-3 text-label text-muted active:bg-surface-2"
              >
                {showElsewhere ? "less" : "＋ from another week"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function toggle(kept: Set<string>, setKept: (n: Set<string>) => void, id: string) {
  const next = new Set(kept);
  next.has(id) ? next.delete(id) : next.add(id);
  setKept(next);
}

function ProjectChip({
  data,
  p,
  reason,
  onTap,
}: {
  data: VerticalData;
  p: Project;
  /** only when it says something the heading doesn't — e.g. it's parked elsewhere */
  reason?: string;
  onTap: () => void;
}) {
  const color = domainById(data, p.domainId)?.color ?? "var(--accent)";
  return (
    <button
      onClick={onTap}
      className="tap fast flex min-h-[44px] items-center gap-2 rounded-full border border-line px-3 text-label active:bg-surface-2"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="text-ink">{p.name}</span>
      {reason && <span className="mono text-micro text-muted">{reason}</span>}
    </button>
  );
}

// ── 2 · leftovers — carried over, due, or going quiet ────────────────────────

export function LeftoversStep({
  data,
  suggestions,
  kept,
  setKept,
  onDuration,
  onBundleCarried,
  bundling,
  bundleErr,
}: {
  data: VerticalData;
  suggestions: Suggestion[];
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  onDuration: (taskId: string, mins: number) => void;
  onBundleCarried: () => void;
  bundling: boolean;
  bundleErr: string | null;
}) {
  const carried = suggestions.filter((s) => s.task.rollCount > 0);
  const rest = suggestions.filter((s) => s.task.rollCount === 0);
  const carriedMins = carried.reduce((m, s) => m + s.task.durationMins, 0);

  return (
    <div>
      <StepHead
        question={LANE_QUESTION.loose}
        count={suggestions.length > 0 ? `${suggestions.length}` : undefined}
      />

      {suggestions.length === 0 && <Empty>Nothing owed, nothing due.</Empty>}

      {carried.length > 0 && (
        <section className="mt-1">
          <div className="section-label mb-1 !p-0">Carried over · {carried.length} · {hrs(carriedMins)}h</div>
          {/* a full-width 44px target, not an inline text link: the same action on
              the Inbox step is a real button, and a 14px tap zone fails golden rule 2 */}
          <button
            onClick={onBundleCarried}
            disabled={bundling}
            className="tap fast mb-2 flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 text-body text-accent active:opacity-80 disabled:opacity-50"
            style={{ background: "var(--accent-soft)" }}
          >
            {bundling ? "Grouping…" : "✦ Group into focus blocks"}
          </button>
          {bundleErr && <p className="mb-1 text-meta text-signal">{bundleErr}</p>}
          <div className="border-t border-line">
            {carried.map((s) => (
              <WorkRow key={s.task.id} data={data} s={s} on={kept.has(s.task.id)} onToggle={() => toggle(kept, setKept, s.task.id)}
                        onDuration={onDuration} />
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section className="mt-5">
          <div className="section-label mb-1 !p-0">Due, or going quiet · {rest.length}</div>
          <div className="border-t border-line">
            {rest.map((s) => (
              <WorkRow key={s.task.id} data={data} s={s} on={kept.has(s.task.id)} onToggle={() => toggle(kept, setKept, s.task.id)}
                        onDuration={onDuration} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── 3 · inbox — raw captures, grouped into named runs ────────────────────────

export function InboxStep({
  data,
  suggestions,
  runs,
  kept,
  setKept,
  onDuration,
  inboxCount,
  onGroup,
  grouping,
  groupErr,
}: {
  data: VerticalData;
  suggestions: Suggestion[];
  runs: Batch[];
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  onDuration: (taskId: string, mins: number) => void;
  inboxCount: number;
  onGroup: () => void;
  grouping: boolean;
  groupErr: string | null;
}) {
  return (
    <div>
      <StepHead question={LANE_QUESTION.inbox} count={inboxCount > 0 ? `${inboxCount}` : undefined} />

      {inboxCount === 0 && runs.length === 0 && <Empty>Inbox clear.</Empty>}

      {inboxCount > 0 && (
        <>
          <button
            onClick={onGroup}
            disabled={grouping}
            className="tap fast flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 text-body text-accent active:opacity-80 disabled:opacity-50"
            style={{ background: "var(--accent-soft)" }}
          >
            {grouping ? "Grouping…" : `✦ Group ${inboxCount} into blocks`}
          </button>
          {groupErr && <p className="mt-1 text-meta text-signal">{groupErr}</p>}
        </>
      )}

      {runs.length > 0 && (
        <section className="mt-5">
          <div className="section-label mb-1 !p-0">Grouped · {runs.length}</div>
          <div className="border-t border-line">
            {runs.map((r) => (
              <div key={r.id} className="flex items-start gap-3 border-b border-line py-3">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: r.color ?? "var(--accent)" }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1 truncate text-body text-ink">{r.name}</div>
                <div className="mono shrink-0 text-micro text-muted">
                  {r.taskIds.length} · {r.durationMins}m
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="mt-5">
          <div className="section-label mb-1 !p-0">Pulled in on their own · {suggestions.length}</div>
          <div className="border-t border-line">
            {suggestions.map((s) => (
              <WorkRow key={s.task.id} data={data} s={s} on={kept.has(s.task.id)} onToggle={() => toggle(kept, setKept, s.task.id)}
                        onDuration={onDuration} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── a piece of work, on or off the week ──────────────────────────────────────

function WorkRow({
  data,
  s,
  on,
  onToggle,
  onDuration,
  hideReason,
}: {
  data: VerticalData;
  s: Suggestion;
  on: boolean;
  onToggle: () => void;
  onDuration: (taskId: string, mins: number) => void;
  /** Under a heading that already names the project, the reason is repetition. */
  hideReason?: boolean;
}) {
  const color = domainById(data, s.task.domainId)?.color ?? "var(--accent)";
  const badge = workBadge(s.kind, s.task);
  return (
    <button
      onClick={onToggle}
      title={s.reason}
      className="tap fast flex w-full items-start gap-2.5 border-b border-line py-3 text-left active:bg-surface-2"
    >
      <span
        className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border"
        style={on ? { background: color, borderColor: color } : { borderColor: "var(--line-strong)" }}
      >
        <svg width="11" height="11" viewBox="0 0 10 10" fill="none" className={on ? "opacity-100" : "opacity-0"} style={{ color: "#fff" }}>
          <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-body ${on ? "text-ink" : "text-muted"}`}>{s.task.title}</span>
      </span>
      {!hideReason && badge && (
        <span
          className="mono shrink-0 self-center rounded-full px-1.5 py-0.5 text-micro"
          style={
            badge.urgent
              ? { color: "var(--signal)", background: "var(--signal-soft)" }
              : { color: "var(--muted)", border: "1px solid var(--line)" }
          }
        >
          {badge.text}
        </span>
      )}
      <DurationSelect
        value={s.task.durationMins}
        onChange={(m) => onDuration(s.task.id, m)}
        className="tap shrink-0 rounded px-1.5 py-1 pt-0.5 hover:bg-surface-2"
        title="Sitting length"
      />
    </button>
  );
}

/**
 * A day, as a shape. The working window drawn end to end, with what's already
 * immovable in neutral and what Nuvo placed in its domain's color — so the answer
 * to "how full is Tuesday, and where's the hole?" arrives before you read a single
 * time. An empty day is an empty bar; it doesn't need the word "open".
 */
function DayStrip({
  data,
  list,
  busy,
  slotNameById,
  startMin,
  endMin,
}: {
  data: VerticalData;
  list: Placement[];
  busy: BusyBlock[];
  slotNameById: ReturnType<typeof useWeekDraft>["slotById"];
  startMin: number;
  endMin: number;
}) {
  // stretch the window if anything sits outside working hours, so nothing clips
  let lo = startMin;
  let hi = endMin;
  for (const p of list) {
    lo = Math.min(lo, p.startMin);
    hi = Math.max(hi, p.startMin + p.durationMin);
  }
  for (const b of busy) {
    lo = Math.min(lo, b.start.getHours() * 60 + b.start.getMinutes());
    hi = Math.max(hi, b.end.getHours() * 60 + b.end.getMinutes());
  }
  const span = Math.max(60, hi - lo);
  const at = (m: number) => `${((m - lo) / span) * 100}%`;
  const wide = (m: number) => `${Math.max(1.5, (m / span) * 100)}%`;

  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
      {busy.map((b, i) => {
        const s = b.start.getHours() * 60 + b.start.getMinutes();
        const e = b.end.getHours() * 60 + b.end.getMinutes();
        return (
          <div
            key={`b${i}`}
            className="absolute inset-y-0"
            // a translucent ink wash vanished against the warm track — immovable time
            // has to be unmistakable, or a day full of meetings reads as free
            style={{ left: at(s), width: wide(e - s), background: "var(--line-strong)" }}
            title={b.title}
          />
        );
      })}
      {list.map((p) => {
        const slot = slotNameById.get(p.task.id);
        const color = slot?.color ?? taskDomainColor(data, p.task) ?? "var(--accent)";
        return (
          <div
            key={`${p.task.id}#${p.part ?? 1}`}
            className="absolute inset-y-0 rounded-[2px]"
            style={{ left: at(p.startMin), width: wide(p.durationMin), background: color }}
            title={slot ? slot.name : p.task.title}
          />
        );
      })}
    </div>
  );
}

// ── 4 · the week — where it lands, day by day ────────────────────────────────

export function WeekStep({
  data,
  days,
  placements,
  slotNameById,
  unplaced,
  routedCount,
  busy,
  workStart,
  workEnd,
  onDrop,
}: {
  data: VerticalData;
  days: { iso: string; past: boolean }[];
  placements: Placement[];
  slotNameById: ReturnType<typeof useWeekDraft>["slotById"];
  unplaced: ReturnType<typeof useWeekDraft>["result"]["unplaced"];
  routedCount: number;
  /** what the day already owes before this plan — the one "what counts as busy"
   *  rule, from `toBusyBlocks` (lib/now.ts), never re-derived here */
  busy: BusyBlock[];
  workStart: number;
  workEnd: number;
  onDrop: (taskId: string) => void;
}) {
  const byDay = new Map<string, Placement[]>();
  for (const p of placements) byDay.set(p.dayISO, [...(byDay.get(p.dayISO) ?? []), p]);
  for (const list of byDay.values()) list.sort((a, b) => a.startMin - b.startMin);
  const busyByDay = new Map<string, BusyBlock[]>();
  for (const b of busy) {
    const iso = format(b.start, "yyyy-MM-dd");
    busyByDay.set(iso, [...(busyByDay.get(iso) ?? []), b]);
  }

  return (
    <div>
      <StepHead
        question="Here's the week"
        count={
          <>
            {placements.length} scheduled
            {routedCount > 0 && ` · ${routedCount} standing`}
          </>
        }
      />

      {days.length === 0 && (
        <Empty>No working days set — choose them in Settings.</Empty>
      )}

      {days.map(({ iso, past }) => {
        const list = byDay.get(iso) ?? [];
        return (
          <section key={iso} className={`mt-4 ${past ? "opacity-50" : ""}`}>
            <div className="section-label mb-1 !p-0">{format(parseDateISO(iso), "EEEE, MMM d")}</div>
            <DayStrip
              data={data}
              list={list}
              busy={busyByDay.get(iso) ?? []}
              slotNameById={slotNameById}
              startMin={workStart}
              endMin={workEnd}
            />
            {list.length > 0 && (
              <div className="mt-1.5 border-t border-line">
                {list.map((p) => {
                  const slot = slotNameById.get(p.task.id);
                  const color = slot?.color ?? taskDomainColor(data, p.task) ?? "var(--accent)";
                  const title = slot ? slot.name : p.task.title;
                  return (
                    <div key={`${p.task.id}#${p.part ?? 1}`} className="flex items-start gap-3 border-b border-line py-2.5">
                      <span className="mono w-[58px] shrink-0 pt-0.5 text-micro text-muted">{fmtMinShort(p.startMin)}</span>
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-body text-ink">
                          {title}
                          {p.parts && p.parts > 1 && (
                            <span className="mono text-micro text-muted"> ({p.part}/{p.parts})</span>
                          )}
                        </div>
                        {/* the reason Nuvo chose this time lives in the title, not
                            on the row: you want it when something looks wrong, which
                            is not most weeks */}
                        <div className="mono truncate text-micro text-muted" title={p.reason}>
                          {p.durationMin}m
                          {slot && slot.taskIds.length > 1 && ` · ${slot.taskIds.length} steps`}
                        </div>
                      </div>
                      <button
                        onClick={() => onDrop(p.task.id)}
                        aria-label={`Take ${title} out of the week`}
                        className="tap fast -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {unplaced.length > 0 && (
        <section className="mt-5 border-t border-line pt-3">
          <div className="section-label mb-1 !p-0">No time yet · {unplaced.length}</div>
          {unplaced.map(({ task, reason }) => (
            <div key={task.id} className="flex items-baseline gap-2 py-1">
              <span className="min-w-0 flex-1 truncate text-caption text-muted">{task.title}</span>
              <span className="mono shrink-0 text-micro text-muted">{reason}</span>
            </div>
          ))}
        </section>
      )}

    </div>
  );
}
