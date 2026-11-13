// Plan the week, on a phone — the same act the desktop runs, laid out for a thumb.
//
// The desktop lays the week out as one wide board (sources left, a seven-column
// grid you drag on). A phone can't hold that board, but the *act* isn't the board:
// it's deciding what the week carries, by source, and then when each piece happens.
//
//   1 · Projects   — the projects you're moving, and the work that moves them
//   2 · Leftovers  — what you already owed: carried over, or due
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

import WeekSetMoment from "../plan/WeekSetMoment";
import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useDeferProject } from "../../hooks/useProjectTime";
import { useWeekDraft } from "../../hooks/useWeekDraft";
import { carryMark, projectsOnDeck, weekPushes } from "../../lib/priorities";
import { lensGaps } from "../../lib/lenses";
import { domainById, sprintMinsByDomain, taskDomainColor, type Project, type VerticalData } from "../../lib/vertical";
import { fmtHours as hrs, parseDateISO, planningWeekStartISO } from "../../lib/dates";
import { bringIntoWeekPatch } from "../../../supabase/functions/_shared/planningRules.ts";
import { weekName, weekSpan } from "../../lib/week";
import { REVEALED_BY_LANE, STEP_ASK, STEP_DONE, STEP_QUESTION, workBadge } from "../../lib/intake";
import type { Batch } from "../../lib/batch";
import type { Placement } from "../../lib/compose";
import { toBusyBlocks, type BusyBlock } from "../../lib/now";
import { at } from "./dayPlan";
import SourceSwitch, { CapacityMeter, WEEK_STEPS, type WeekStep } from "../rituals/WeekIntake";
import DurationSelect from "../DurationSelect";
import { Button, Card, Dot, IconButton } from "../kit";
import { PhEmpty, TouchButton } from "./touch";

/** The forward beat — named after the ACT, not the destination. "Leftovers →"
 *  said where you'd land and nothing about what pressing it does; each press
 *  pours one more source into the week. */
// The same verbs as the desktop's walk button (STEP_DONE) — one act, one voice.
const NEXT: Partial<Record<WeekStep, { to: WeekStep; label: string }>> = {
  open: { to: "projects", label: STEP_DONE.open },
  projects: { to: "rest", label: STEP_DONE.projects },
  rest: { to: "week", label: STEP_DONE.rest },
};

// the app's one clock spelling (D-122), fed minutes-from-midnight
const atMin = (m: number) => {
  const d = new Date(2000, 0, 1);
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return at(d);
};

export default function MobilePlanWeek({ onClose }: { onClose: () => void }) {
  const draft = useWeekDraft();
  const { updateProject, updateTask } = useVertical();
  const [step, setStep] = useState<WeekStep>("open");

  const {
    data,
    weekStartISO,
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
    inboxCount,
    slotLooseWork,
    theming,
    themeErr,
    goal,
    commit,
    applying,
    committed,
  } = draft;

  // The week's projects — derived from the On Deck spans, never stored. Bringing a
  // project in / taking it off IS the placement write, same as the deck's drop.
  const defer = useDeferProject();
  const pushes = useMemo(() => weekPushes(data, weekStartISO), [data, weekStartISO]);
  const bringIn = (p: Project) => {
    const patch = bringIntoWeekPatch(p, weekStartISO);
    if (patch) updateProject(p.id, patch);
  };
  const takeOff = (p: Project) => void defer.takeOff(p, weekStartISO);
  const setDuration = (taskId: string, mins: number) => updateTask(taskId, { durationMins: mins });

  // the one "what counts as busy" rule (lib/now.ts) — the day strips draw what the
  // week already owes, so an empty-looking day full of meetings can't read as free
  const busy = useMemo(() => toBusyBlocks(visibleEvents, onCalBlocks), [visibleEvents, onCalBlocks]);


  if (committed) {
    return (
      <Overlay>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
          {/* COMMIT (D-187) — the desktop rail ends on the same moment. */}
          <WeekSetMoment
            eyebrow={weekName(weekStartISO)}
            bands={sprintMinsByDomain(data).map((x) => ({ key: x.domain.id, label: x.domain.name, color: x.domain.color, mins: x.mins }))}
            facts={
              <>
                {placements.length} scheduled · {keptTasks.length} committed
                {routedCount > 0 && ` · ${routedCount} standing`}
              </>
            }
            goal={goal}
          />
        </div>
        <Footer>
          <TouchButton kind="primary" full onClick={onClose}>
            Done
          </TouchButton>
        </Footer>
      </Overlay>
    );
  }

  return (
    <PlanWeekFrame
      weekStartISO={weekStartISO}
      step={step}
      onStep={setStep}
      onClose={onClose}
      meter={
        <CapacityMeter
          intake={intake}
          fit={{ placed: placements.length, unplaced: result.unplaced.length }}
          revealed={step === "week" ? undefined : REVEALED_BY_LANE[step]}
          compact
          dense
        />
      }
      onCommit={() => void commit()}
      applying={applying}
    >
      {step === "projects" && (
        <ProjectsStep
          data={data}
          weekStartISO={weekStartISO}
          pushes={pushes}
          suggestions={byLane.projects}
          kept={kept}
          setKept={setKept}
          onDuration={setDuration}
          onBringIn={bringIn}
          onTakeOff={takeOff}
        />
      )}
      {step === "open" && <OpenStep blockedMins={intake.blockedMins} />}
      {step === "rest" && (
        <CarriedStep
          data={data}
          carried={byLane.loose}
          captures={byLane.inbox}
          runs={runs}
          kept={kept}
          setKept={setKept}
          onDuration={setDuration}
          inboxCount={inboxCount}
          onSlot={() => void slotLooseWork()}
          slotting={theming}
          slotErr={themeErr}
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
    </PlanWeekFrame>
  );
}

/**
 * The ritual's frame — shared with the `?planweek` harness so the steps are
 * checked inside the chrome they actually wear. The bar names the week once,
 * quietly, beside the way out; then the walk, drawn as a stepper, and the
 * week's one honest read under it (the phone's stand-in for the desktop's
 * always-visible grid — it reveals by source the same way the desktop grid
 * does). The step's question, inside the body, is the screen's one hero. The
 * foot has one way forward, named after what pressing it does, and the way
 * back beside it.
 */
export function PlanWeekFrame({
  weekStartISO,
  step,
  onStep,
  onClose,
  meter,
  onCommit,
  applying = false,
  children,
}: {
  weekStartISO: string;
  step: WeekStep;
  onStep: (s: WeekStep) => void;
  onClose: () => void;
  meter: React.ReactNode;
  onCommit: () => void;
  applying?: boolean;
  children: React.ReactNode;
}) {
  const next = NEXT[step];
  const prev = WEEK_STEPS[WEEK_STEPS.indexOf(step) - 1];
  return (
    <Overlay>
      <header className="shrink-0 border-b border-[var(--line-1)] pt-safe">
        <div className="flex min-h-12 items-center gap-2 pl-4 pr-2">
          <span className="min-w-0 flex-1 truncate text-caption font-semibold text-muted">
            Plan the week · <span className="text-ink">{weekName(weekStartISO)}</span> · {weekSpan(weekStartISO)}
          </span>
          <IconButton label="Close" size="md" icon={<Icon name="close" size={18} />} onClick={onClose} className="tap-icon shrink-0" />
        </div>
        <div className="px-4 pb-3">
          <SourceSwitch step={step} onStep={onStep} steps={WEEK_STEPS} dense />
          <div className="mt-2.5">{meter}</div>
        </div>
      </header>

      <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-5">{children}</div>

      <Footer>
        <div className="flex items-center gap-2">
          {prev && (
            // A 44px ghost square: the forward act keeps the row's width for
            // its words, which name what pressing it does.
            <IconButton
              label="Back"
              kind="ghost"
              icon={<Icon name="chevron-left" size={20} />}
              onClick={() => onStep(prev)}
              className="ph-btn shrink-0"
            />
          )}
          {next ? (
            <TouchButton
              kind="primary"
              onClick={() => onStep(next.to)}
              trailing={<Icon name="arrow-right" size={16} />}
              className="min-w-0 flex-1"
            >
              <span className="truncate">{next.label}</span>
            </TouchButton>
          ) : (
            <TouchButton kind="primary" onClick={onCommit} disabled={applying} className="min-w-0 flex-1">
              {applying ? "Committing…" : STEP_DONE.week}
            </TouchButton>
          )}
        </div>
      </Footer>
    </Overlay>
  );
}

/** The Week segment's entry to the flow — a live read of what's committed, then
 *  the act. Sits above the week's plan/review card: you set the week here, you
 *  watch it land there. */
export function PlanWeekCard({
  onOpen,
  variant = "card",
}: {
  onOpen: () => void;
  /** "link" demotes the card to a quiet text row — the Week segment shows ONE
   *  primary card per state (see WeekCompanions), never three rivals. */
  variant?: "card" | "link";
}) {
  const { data } = useVertical();
  const weekStartISO = planningWeekStartISO();
  const pushes = useMemo(() => weekPushes(data, weekStartISO), [data, weekStartISO]);
  const ready = pushes.filter(({ project }) => lensGaps(data, "project", project, new Date()).length === 0).length;

  if (variant === "link") {
    return (
      <Button kind="ghost" size="sm" onClick={onOpen} trailing={<Icon name="chevron-right" size={14} />} className="tap-bloom -ml-2.5 self-start">
        Adjust the week's plan
      </Button>
    );
  }

  return (
    <Card className="ph-card">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-head font-semibold text-ink">Plan the week</div>
          <div className="mt-0.5 truncate text-caption tabular-nums text-muted">
            {weekName(weekStartISO)}
            {pushes.length > 0 && ` · ${pushes.length} project${pushes.length === 1 ? "" : "s"} · ${ready} ready`}
          </div>
        </div>
        <TouchButton kind="primary" compact onClick={onOpen} className="shrink-0">
          Plan
        </TouchButton>
      </div>
    </Card>
  );
}

// ── chrome ───────────────────────────────────────────────────────────────────

/** The ritual's layer: the panel, opaque, over the whole shell. */
function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="ph-overlay !pt-0">{children}</div>;
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <footer
      className="shrink-0 border-t border-[var(--line-1)] bg-[var(--panel)] px-4 pt-3"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}
    >
      {children}
    </footer>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <PhEmpty>{children}</PhEmpty>;
}

/** Every step opens with the question it answers — the screen's one hero — and
 *  nothing else. Instructions ("tap to drop anything…", "keep what should
 *  move…") are not drawn: they teach a mechanic you learn once and then re-read
 *  fifty-one times a year. What survives is state, and state gets a number or a
 *  shape, not a sentence. (`ask` stays in the signature for the desktop's copy.) */
function StepHead({ question, count }: { question: string; ask?: string; count?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-display masthead m-0 text-ink">{question}</h2>
      {count && <div className="mt-1.5 text-caption tabular-nums text-muted">{count}</div>}
    </div>
  );
}

/** A group's name and count inside a step — the phone's section voice. */
function StepSection({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="mb-1 flex items-baseline gap-1.5 text-caption font-semibold text-muted">
      <span>{children}</span>
      {count != null && <span className="font-medium tabular-nums text-[var(--faint)]">{count}</span>}
    </div>
  );
}

type Suggestion = ReturnType<typeof useWeekDraft>["suggestions"][number];

// ── 0 · open time — what the week already owes ───────────────────────────────

export function OpenStep({ blockedMins }: { blockedMins: number }) {
  return (
    <>
      <StepHead question={STEP_QUESTION.open} />
      <p className="text-body tabular-nums text-muted">
        <span className="font-semibold text-ink">{hrs(blockedMins)}h</span> already on the calendar
      </p>
    </>
  );
}

// ── 1 · projects — what you're moving, and the work that moves it ─────────────

export function ProjectsStep({
  data,
  weekStartISO,
  pushes,
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
      {/* Last week's look-back chips (done · hours · quiet domains) used to sit
          above the question. They answer the Review's question, not this one —
          the desktop dropped them for that reason, and the phone now matches. */}
      <StepHead question={STEP_QUESTION.projects} ask={STEP_ASK.projects} />

      {pushes.length > 0 ? (
        <div className="border-t border-[var(--line-1)]">
          {pushes.map(({ project, shipped, carried }) => {
            const color = domainById(data, project.domainId)?.color ?? "var(--accent)";
            const gaps = lensGaps(data, "project", project, new Date());
            const ready = gaps.length === 0;
            const work = byProject.get(project.id) ?? [];
            const on = work.filter((s) => kept.has(s.task.id)).length;
            return (
              <div key={project.id} className="border-b border-[var(--line-1)] py-2">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-[13px] h-2 w-2 shrink-0 rounded-[2.5px]"
                    style={ready ? { background: color } : { boxShadow: "inset 0 0 0 1.5px var(--line-2)" }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 pt-2">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-head font-semibold text-ink">{project.name}</span>
                      {/* It's here because its week passed, not because you just
                          chose it — say so, or the slate reads as five fresh
                          decisions when two of them are debt. */}
                      {carried > 0 && (
                        <span className="shrink-0 text-caption tabular-nums text-muted" title={carryMark(carried).title}>
                          {carryMark(carried).text}
                        </span>
                      )}
                      {/* how much of this project's work is in the week — a meter
                          and a fraction, where a clause used to be */}
                      {work.length > 0 && (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span className="h-[3px] w-8 overflow-hidden rounded-[2px] bg-[var(--line-2)]">
                            <span
                              className="block h-full rounded-[2px] transition-[width] duration-300"
                              style={{ width: `${(on / work.length) * 100}%`, background: color }}
                            />
                          </span>
                          <span className="text-caption tabular-nums text-muted">{on}/{work.length}</span>
                        </span>
                      )}
                    </div>
                    {/* a missing outcome is already reported by the gap line below —
                        saying it twice made the row look broken */}
                    {project.outcome?.trim() && (
                      <div className="mt-0.5 truncate text-caption text-muted">{project.outcome.trim()}</div>
                    )}
                    {/* "ready to schedule" said nothing the filled dot didn't. Only
                        the gaps — the actionable half — still earn a line. */}
                    {shipped ? (
                      <div className="mt-0.5 text-caption font-medium text-[var(--landed,var(--accent))]">Shipped</div>
                    ) : !ready ? (
                      <div className="mt-0.5 text-caption text-[var(--warn)]">{gaps.map((g) => g.label).join(" · ")}</div>
                    ) : null}
                  </div>
                  <IconButton
                    label={`Take ${project.name} off this week`}
                    size="md"
                    icon={<Icon name="close" size={16} />}
                    onClick={() => onTakeOff(project)}
                    className="tap-icon -mr-1.5 mt-1.5 shrink-0"
                  />
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
        <Empty>Nothing on this week</Empty>
      )}

      {(byProject.get("loose")?.length ?? 0) > 0 && (
        <section className="mt-6">
          <StepSection count={byProject.get("loose")!.length}>Project work, no week set</StepSection>
          <div className="border-t border-[var(--line-1)]">
            {byProject.get("loose")!.map((s) => (
              <WorkRow key={s.task.id} data={data} s={s} on={kept.has(s.task.id)} onToggle={() => toggle(kept, setKept, s.task.id)}
                        onDuration={onDuration} />
            ))}
          </div>
        </section>
      )}

      {(needsWeek.length > 0 || elsewhere.length > 0) && (
        <div className="mt-6">
          <StepSection>Add a project</StepSection>
          <div className="border-t border-[var(--line-1)]">
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
                type="button"
                onClick={() => setShowElsewhere((s) => !s)}
                aria-expanded={showElsewhere}
                className="ph-row row-hover text-muted"
                data-flush=""
              >
                <span className="ph-row-lead">
                  <Icon name={showElsewhere ? "chevron-down" : "chevron-right"} size={16} />
                </span>
                <span className="text-body font-medium">{showElsewhere ? "Fewer" : "From another week"}</span>
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
    <button type="button" onClick={onTap} className="ph-row row-hover" data-flush="">
      <span className="ph-row-lead">
        <Dot color={color} />
      </span>
      <span className="ph-row-title">{p.name}</span>
      {reason && <span className="ph-row-meta">{reason}</span>}
      <Icon name="plus" size={16} className="shrink-0 text-muted" />
    </button>
  );
}

// ── 2 · leftovers — carried over, or due ────────────────────────────────────

/**
 * Step 3 · everything the week carries that isn't a project — one pool.
 *
 * Was two steps, *Leftovers* then *Inbox*, each slotting its own pool. A carried
 * task **was** a capture once; the difference is provenance, not kind. Slotting
 * them separately is why a "Frontier" leftover and a "Frontier" capture came back
 * as two slots the AI had no way to see belonged together.
 */
export function CarriedStep({
  data,
  carried,
  captures,
  runs,
  kept,
  setKept,
  onDuration,
  inboxCount,
  onSlot,
  slotting,
  slotErr,
}: {
  data: VerticalData;
  carried: Suggestion[];
  captures: Suggestion[];
  runs: Batch[];
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  onDuration: (taskId: string, mins: number) => void;
  inboxCount: number;
  onSlot: () => void;
  slotting: boolean;
  slotErr: string | null;
}) {
  const rolled = carried.filter((s) => s.task.rollCount > 0);
  const rest = carried.filter((s) => s.task.rollCount === 0);

  const group = (label: string, rows: Suggestion[]) =>
    rows.length === 0 ? null : (
      <section className="mt-6">
        <StepSection count={rows.length}>{label}</StepSection>
        <div className="border-t border-[var(--line-1)]">
          {rows.map((s) => (
            <WorkRow
              key={s.task.id}
              data={data}
              s={s}
              on={kept.has(s.task.id)}
              onToggle={() => toggle(kept, setKept, s.task.id)}
              onDuration={onDuration}
            />
          ))}
        </div>
      </section>
    );

  return (
    <div>
      <StepHead question={STEP_QUESTION.rest} ask={STEP_ASK.rest} />

      {/* the slots first — they're the proposal you're here to agree with */}
      {slotting && runs.length === 0 ? (
        <p className="text-body text-muted">Slotting…</p>
      ) : runs.length > 0 ? (
        <section>
          <StepSection count={runs.length}>Slots</StepSection>
          <div className="border-t border-[var(--line-1)]">
            {runs.map((r) => (
              <div key={r.id} className="ph-row" data-flush="">
                <span className="ph-idbar !mx-[8.5px]" style={{ ["--h" as string]: r.color ?? "var(--accent)" }} aria-hidden />
                <span className="ph-row-title">{r.name}</span>
                <span className="ph-row-meta">
                  {r.taskIds.length} · {r.durationMins}m
                </span>
              </div>
            ))}
          </div>
          <Button
            kind="ghost"
            size="sm"
            onClick={onSlot}
            disabled={slotting}
            icon={<Icon name="refresh" size={14} />}
            className="tap-bloom -ml-2.5 mt-2"
          >
            Slot again
          </Button>
        </section>
      ) : null}
      {slotErr && <p className="mt-1 text-caption text-[var(--danger)]">{slotErr}</p>}

      {group("Carried over", rolled)}
      {group("Due this week", rest)}
      {group("New captures", captures)}

      {carried.length === 0 && captures.length === 0 && (
        <Empty>
          {inboxCount > 0 ? `${inboxCount} in the inbox, none due` : "Nothing owed"}
        </Empty>
      )}
    </div>
  );
}

function WorkRow({
  s,
  on,
  onToggle,
  onDuration,
  hideReason,
}: {
  /** kept in the signature: callers pass the vertical, the row no longer reads it */
  data?: VerticalData;
  s: Suggestion;
  on: boolean;
  onToggle: () => void;
  onDuration: (taskId: string, mins: number) => void;
  /** Under a heading that already names the project, the reason is repetition. */
  hideReason?: boolean;
}) {
  const badge = workBadge(s.kind, s.task);
  return (
    <button
      type="button"
      onClick={onToggle}
      title={s.reason}
      aria-pressed={on}
      // one line, one height (design-language: hierarchy 5) — the 48px row
      // holds the duration's target; nothing wraps to a second line
      className="ph-row row-hover"
      data-flush=""
    >
      {/* Kept is intent, so it wears the landing colour — the same round mark
          as the kit's TaskCheck, drawn (it sits inside the row's button). */}
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={on ? { background: "var(--landed, var(--accent))" } : { boxShadow: "inset 0 0 0 1.5px var(--line-2)" }}
        aria-hidden
      >
        {on && <Icon name="check" size={12} strokeWidth={2.5} style={{ color: "var(--on-accent)" }} />}
      </span>
      <span className={`ph-row-title ${on ? "" : "!text-muted"}`}>{s.task.title}</span>
      {!hideReason && badge && (
        <span
          className="k-chip shrink-0 tabular-nums"
          style={
            badge.urgent
              ? { color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 12%, transparent)", borderColor: "transparent" }
              : undefined
          }
        >
          {badge.text}
        </span>
      )}
      <DurationSelect
        value={s.task.durationMins}
        onChange={(m) => onDuration(s.task.id, m)}
        className="tap shrink-0 justify-end rounded-[var(--r-ctl)] px-1"
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
    <div className="relative h-2 w-full overflow-hidden rounded-[3px] bg-[var(--line-1)]">
      {busy.map((b, i) => {
        const s = b.start.getHours() * 60 + b.start.getMinutes();
        const e = b.end.getHours() * 60 + b.end.getMinutes();
        return (
          <div
            key={`b${i}`}
            className="absolute inset-y-0"
            // a translucent ink wash vanished against the warm track — immovable time
            // has to be unmistakable, or a day full of meetings reads as free
            style={{ left: at(s), width: wide(e - s), background: "color-mix(in srgb, var(--ink) 22%, transparent)" }}
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
            className="absolute inset-y-0 rounded-[1px]"
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
        <Empty>No working days set</Empty>
      )}

      {days.map(({ iso, past }) => {
        const list = byDay.get(iso) ?? [];
        return (
          <section key={iso} className={`mt-6 ${past ? "opacity-50" : ""}`}>
            <StepSection>{format(parseDateISO(iso), "EEEE, MMM d")}</StepSection>
            <DayStrip
              data={data}
              list={list}
              busy={busyByDay.get(iso) ?? []}
              slotNameById={slotNameById}
              startMin={workStart}
              endMin={workEnd}
            />
            {list.length > 0 && (
              <div className="mt-2 border-t border-[var(--line-1)]">
                {list.map((p) => {
                  const slot = slotNameById.get(p.task.id);
                  const color = slot?.color ?? taskDomainColor(data, p.task) ?? "var(--accent)";
                  const title = slot ? slot.name : p.task.title;
                  return (
                    // the phone's row: time in its gutter, the identity bar, the
                    // name, its length — and the way out of the week
                    <div key={`${p.task.id}#${p.part ?? 1}`} className="ph-row !pr-0" data-flush="">
                      <span className="ph-row-time">{atMin(p.startMin)}</span>
                      <span className="ph-idbar !mx-0" style={{ ["--h" as string]: color }} aria-hidden />
                      {/* the reason Nuvo chose this time lives in the title, not
                          on the row: you want it when something looks wrong,
                          which is not most weeks */}
                      <span className="ph-row-title" title={p.reason}>
                        {title}
                        {p.parts && p.parts > 1 && (
                          <span className="font-normal tabular-nums text-muted"> {p.part}/{p.parts}</span>
                        )}
                      </span>
                      <span className="ph-row-meta">
                        {p.durationMin}m{slot && slot.taskIds.length > 1 && ` · ${slot.taskIds.length}`}
                      </span>
                      <IconButton
                        label={`Take ${title} out of the week`}
                        size="md"
                        icon={<Icon name="close" size={16} />}
                        onClick={() => onDrop(p.task.id)}
                        className="tap-icon shrink-0"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {unplaced.length > 0 && (
        <section className="mt-6">
          <StepSection count={unplaced.length}>No time yet</StepSection>
          <div className="border-t border-[var(--line-1)]">
            {unplaced.map(({ task, reason }) => (
              <div key={task.id} className="ph-row" data-flush="">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--warn)]" aria-hidden />
                <span className="ph-row-title !text-muted">{task.title}</span>
                <span className="ph-row-meta">{reason}</span>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}
