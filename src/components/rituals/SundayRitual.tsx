// Plan the week — the weekly ritual, reduced to its one honest job: arrive to a
// week that's already been pulled and time-blocked, then tune and commit. What
// you do is a draft, not a form:
//
//   · the pull + the compose run the moment it opens (no "compose" button)
//   · every block still carries its reason — you keep the map, never lost
//   · one gesture overrides anything — drop a block, keep a candidate, add a project
//   · the only required click is Commit
//
// **One screen: the sources on the left, the week on the right, always.** The
// three sources take turns in the rail (Projects · Leftovers · Inbox); the week
// grid never leaves. That's the fix for the flow's real flaw — it used to ask you
// to keep work across three pages and only told you at the end that five of your
// projects had no room ("the week is full"). Deciding and its consequence now
// share a screen, which is also the planner grammar every other surface already
// uses (pool left → grid of time right; design-language.md).
//
// Defaults are pre-decided, settings live in Settings (working hours tuck away),
// intelligence does the deciding-where. You stay at altitude.

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useDeferProject } from "../../hooks/useProjectTime";
import { useSettings } from "../../hooks/useSettings";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { placementKey, useWeekDraft } from "../../hooks/useWeekDraft";
import {
  backlogTasks,
  domainById,
  inboxTasks,
  projectById,
  sprintMinsByDomain,
  sprintTasks,
  taskDomainColor,
  type Project,
  type VerticalData,
} from "../../lib/vertical";
import { endOf, fmtHours as hrs, parseDateISO } from "../../lib/dates";
import { at, span } from "../mobile/dayPlan";
import { weekName, weekSpan } from "../../lib/week";
import { noticeIfUnready } from "../../lib/readyNotice";
import { CONTEXT_META, type DayContext, type Placement, type UnplacedTask } from "../../lib/compose";
import { readDay, toBusyBlocks, type Gap } from "../../lib/now";
import { type Batch } from "../../lib/batch";
import { blockDesignation } from "../../lib/slots";
import DurationSelect from "../DurationSelect";
import { type PullSuggestion } from "../../lib/pull";
import { lensGaps } from "../../lib/lenses";
import { carryMark, projectsOnDeck, weekPushes } from "../../lib/priorities";
import { bringIntoWeekPatch, spanAnotherWeekPatch } from "../../../supabase/functions/_shared/planningRules.ts";
import { PLAN_STEPS, STEP_ASK, STEP_DONE, STEP_QUESTION, REVEALED_BY_LANE, laneOf, workBadge, type WeekPlanStep } from "../../lib/intake";
import SourceSwitch, { CapacityMeter } from "./WeekIntake";
import { FlowFoot, FlowFrame, FlowHead, keyIsTaken } from "./FlowShell";
import WeekSetMoment from "../plan/WeekSetMoment";
import { RemedyPanel } from "../floors/RemedyPanel";
import type { ExternalEvent, Slot, Task } from "../../lib/types";
import { Button, Checkbox, Chip, ChipButton, Dot, EmptyState, IconButton, Row, SectionHeader } from "../kit";
import { Icon } from "../Icon";
import { TimeInput } from "../form";
import { pressable } from "../../lib/a11y";

const CONTEXT_CYCLE: DayContext[] = ["normal", "light", "travel", "off"];
const DAY_GLYPH = ["S", "M", "T", "W", "T", "F", "S"]; // Sun…Sat, for working-day chips
const HOUR_PX = 44;
const MIN_BLOCK_PX = 18;
/**
 * The week has exactly two materials, and they must never be told apart by
 * reading a label. A commitment is neutral ink — solid, with a real edge, a fact
 * you arrived with. Open time is `--slot` — the same teal that means
 * open/claimable on every planner in the app, drawn hatched the way the
 * Schedule draws a slot. They differ by *hue*, not by a few percent of the same
 * grey. Defined once, used by the grid and the legend, so both read as one key.
 */
const BUSY_FILL = "color-mix(in srgb, var(--ink) 11%, var(--panel))";
const BUSY_EDGE = "inset 2px 0 0 var(--faint)";
const OPEN_FILL =
  "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--slot) 9%, transparent) 6px 7px), color-mix(in srgb, var(--slot) 7%, transparent)";
const OPEN_EDGE = "inset 0 0 0 1px color-mix(in srgb, var(--slot) 42%, transparent), inset 2px 0 0 var(--slot)";
// One spelling of a clock time, app-wide (D-122): `at` / `span`, fed
// minutes-from-midnight. This flow kept two private formats — `09:00` in its
// boundaries and `9a–10:30a` on its blocks — beside a gutter reading `9:00 AM`.
const clockAt = (m: number) => {
  const d = new Date(2000, 0, 1);
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d;
};
const atMin = (m: number) => at(clockAt(m));
const spanMin = (a: number, b: number) => span(clockAt(a), clockAt(b));

// Three sources, named after what they hold rather than after invented verbs
// ("Slate", "Pull", "Shape" appeared nowhere else in the product): **Projects ·
// Leftovers · Inbox.** They take turns in the rail; the week they pour into is on
// the right the whole time.
//
// **They are a switch, not a wizard** — the distinction the old five-step wizard
// got wrong and must not get wrong again. Every source is one click away at any
// time, the week is fully composed the moment this opens, and every keep or drop
// re-shapes the grid beside your cursor.

export default function SundayRitual({
  step: stepIndex,
  setStep,
  onClose,
}: {
  /** The step, held in nav history — so back/forward walks the plan. */
  step: number;
  setStep: (i: number) => void;
  onClose: () => void;
}) {
  // Everything the week IS — the pull, the standing-slot routing, the project
  // slots, the composer and the commit — lives in useWeekDraft, shared with the
  // phone's Plan the week. This file is the desktop's *layout* of that draft.
  const draft = useWeekDraft();
  const {
    data,
    weekStartISO,
    weekDays,
    gridDays,
    workingDays,
    setWorkingDays,
    dayContexts,
    workStart,
    workEnd,
    fromGate,
    byLane,
    intake,
    placementLane,
    kept,
    setKept,
    dropBlock,
    slotById,
    runs,
    removeFromRun,
    visibleEvents,
    allWeekEvents,
    hiddenEvent,
    toggleEventHidden,
    weekSlots,
    onCalBlocks,
    result,
    placements,
    movePlacement,
    resizePlacement,
    inboxCount,
    slotLooseWork,
    theming,
    themeErr,
    commit,
    applying,
    committed,
  } = draft;

  // The step lives in nav history, not local state — so the browser's (and the
  // mouse's, and the trackpad's) back and forward walk the plan instead of
  // dropping out of it. `closeFlow` already unwinds `flowStep + 1` entries.
  const lane = PLAN_STEPS[Math.min(Math.max(stepIndex, 0), PLAN_STEPS.length - 1)];
  const setLane = (s: WeekPlanStep) => setStep(PLAN_STEPS.indexOf(s));
  const [showBoundaries, setShowBoundaries] = useState(false);

  /**
   * Step 1 runs in two beats, because it's answering two questions in order:
   * *what is already on my week?* and only then *what room is left?* Showing the
   * commitments and the open spans in the same instant made them compete — and
   * the room you have is a conclusion drawn FROM the commitments, so it should
   * arrive after them. It also gives you the moment to set aside what you're not
   * going to before the measurement is taken.
   */
  const [roomFound, setRoomFound] = useState(false);
  useEffect(() => {
    if (lane !== "open") { setRoomFound(false); return; }
    const t = setTimeout(() => setRoomFound(true), 520);
    return () => clearTimeout(t);
  }, [lane]);

  // The week fills in one source at a time. On Projects you see the projects
  // land in an otherwise empty week — nothing else competing for the good hours
  // — and each later source animates in on top. The composer still solves the
  // WHOLE week (so a block never jumps once you've seen it); this only governs
  // what's drawn, and the meter keeps the honest total in view throughout.
  const revealed = REVEALED_BY_LANE[lane];
  const shownPlacements = useMemo(
    () => placements.filter((p) => revealed.includes(placementLane(p))),
    [placements, revealed, placementLane],
  );
  const shownUnplaced = useMemo(
    () => result.unplaced.filter((u) => revealed.includes(laneOf(u.task))),
    [result.unplaced, revealed],
  );
  /**
   * How much of each project's work the week could actually take.
   *
   * Projects and initiatives are the things that move the needle, so "it didn't
   * fit" cannot be a footnote about them — it has to be a decision you're offered
   * while you're still choosing. Counted in *pieces*, not blocks: one sitting can
   * hold five tasks, and "3 of 7 fit" is the number a person can act on.
   */
  const projectFit = useMemo(() => {
    const m = new Map<string, { placed: number; unplaced: number; reason?: string }>();
    const bump = (pid: string | null | undefined, key: "placed" | "unplaced", n: number, reason?: string) => {
      if (!pid) return;
      const cur = m.get(pid) ?? { placed: 0, unplaced: 0 };
      cur[key] += n;
      // the composer's own words for why — "no room" without the reason is the
      // thing that reads as a lie next to an open calendar
      if (reason && !cur.reason) cur.reason = reason;
      m.set(pid, cur);
    };
    for (const pl of placements) {
      const batch = slotById.get(pl.task.id);
      bump(batch?.projectId ?? pl.task.project_id, "placed", batch ? batch.taskIds.length : 1);
    }
    for (const u of result.unplaced) {
      const batch = slotById.get(u.task.id);
      bump(batch?.projectId ?? u.task.project_id, "unplaced", batch ? batch.taskIds.length : 1, u.reason);
    }
    return m;
  }, [placements, result.unplaced, slotById]);

  /** Every task that ended up with a time on the week — including the ones riding
   *  inside a project slot, since a slot is placed as one block but *means* all
   *  the tasks it holds. Lets each project row mark its own pieces landed or not
   *  instead of leaving "did this fit?" to be inferred from the grid. */
  const placedTaskIds = useMemo(() => {
    const s = new Set<string>();
    for (const pl of placements) {
      const batch = slotById.get(pl.task.id);
      if (batch) batch.taskIds.forEach((id) => s.add(id));
      else s.add(pl.task.id);
    }
    return s;
  }, [placements, slotById]);


  // ── the week as it stands — the room you actually have, before anything ─────
  // The one "what counts as busy" rule (`toBusyBlocks`) and the one "where are the
  // gaps" rule (`readDay`) — never re-derived here. `readDay` walks forward from
  // its `now`, so each working day is read from its own start.
  const gapsByDay = useMemo(() => {
    const m = new Map<string, Gap[]>();
    for (const { iso } of gridDays) {
      const day = parseDateISO(iso);
      const from = new Date(day); from.setHours(Math.floor(workStart / 60), workStart % 60, 0, 0);
      const to = new Date(day); to.setHours(Math.floor(workEnd / 60), workEnd % 60, 0, 0);
      const busy = toBusyBlocks(
        visibleEvents.filter((e) => format(new Date(e.start_at), "yyyy-MM-dd") === iso),
        onCalBlocks.filter((b) => b.start_time && format(new Date(b.start_time), "yyyy-MM-dd") === iso),
      );
      m.set(iso, readDay(from, busy, from, to).gaps);
    }
    return m;
  }, [gridDays, visibleEvents, onCalBlocks, workStart, workEnd]);
  /** Every event in the planning week's working days — including the ones you've
   *  already set aside, so the grid can draw them struck through and hand them back. */
  const weekEvents = useMemo(() => {
    const days = new Set(gridDays.map((d) => d.iso));
    return allWeekEvents.filter(
      (e) => e.busy && !e.all_day && days.has(format(new Date(e.start_at), "yyyy-MM-dd")),
    );
  }, [allWeekEvents, gridDays]);
  /** Time you took back, counted the same way open time is: only the part inside
   *  your working window. Summing whole events made "X h of that you took back"
   *  exceed the total open hours it claimed to be a share of — a 6am meeting you
   *  set aside gives back nothing you were ever going to plan into. */


  // The step's one fact, in figures — the numbers under the question.
  const openMins = useMemo(() => {
    let m = 0;
    for (const gs of gapsByDay.values()) for (const g of gs) m += g.mins;
    return m;
  }, [gapsByDay]);
  const projectCount = useMemo(() => new Set(byLane.projects.map((s) => s.projectId).filter(Boolean)).size, [byLane.projects]);
  const fact =
    lane === "open" ? (
      <>
        <b>{hrs(openMins)}h</b> open across <b>{gridDays.length}</b> working day{gridDays.length === 1 ? "" : "s"}
      </>
    ) : lane === "projects" ? (
      <>
        <b>{projectCount}</b> project{projectCount === 1 ? "" : "s"} · <b>{byLane.projects.length}</b> pieces ·{" "}
        <b>{shownPlacements.length}</b> placed
      </>
    ) : (
      <>
        <b>{byLane.loose.length}</b> carried · <b>{byLane.inbox.length}</b> new · <b>{runs.length}</b> slot{runs.length === 1 ? "" : "s"}
      </>
    );

  const stepIx = PLAN_STEPS.indexOf(lane);
  const lastStep = stepIx === PLAN_STEPS.length - 1;
  const forward = () => (lastStep ? void commit() : setLane(PLAN_STEPS[stepIx + 1]));

  // esc closes; the draft resumes — nothing is committed until you say so.
  // ↵ completes the step you're on; the commit itself asks for ⌘↵.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
      if (e.key === "Escape") onClose();
      if (e.key !== "Enter" || committed || applying || keyIsTaken(e)) return;
      if (lastStep ? e.metaKey || e.ctrlKey : !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        forward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (committed) {
    return (
      <Shell onClose={onClose} lane={null} onLane={setLane}>
        <DoneState onClose={onClose} />
      </Shell>
    );
  }

  return (
    <Shell
      onClose={onClose}
      weekStartISO={weekStartISO}
      lane={lane}
      onLane={setLane}
      footer={
        <FlowFoot summary={STEP_ASK[lane]}>
          <Button kind="ghost" size="md" disabled={stepIx === 0} onClick={() => setLane(PLAN_STEPS[Math.max(0, stepIx - 1)])}>
            Back
          </Button>
          <WalkAction lane={lane} stepCount={PLAN_STEPS.length} applying={applying} onNext={setLane} onCommit={() => void commit()} />
        </FlowFoot>
      }
    >
      {/* ── the pool, left · the week, right — one screen, the whole ritual ───── */}
      <div className="flex min-h-0 flex-1">
        {/* The planner rail: on the panel, a hairline separator, full height.
            The question → the pool. Where you are is the stepper's job, in the
            bar; the forward act is the footer's. */}
        <aside className="flex w-[360px] shrink-0 flex-col" style={{ borderRight: "1px solid var(--line-1)" }}>
          <div className="shrink-0 px-5 pb-4 pt-6">
            <FlowHead hero={STEP_QUESTION[lane]} fact={fact} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
            {lane === "open" && <OpenTimeLane />}
            {lane === "projects" && (
              <ProjectsLane
                data={data}
                weekStartISO={weekStartISO}
                suggestions={byLane.projects}
                kept={kept}
                setKept={setKept}
                fit={projectFit}
                placedIds={placedTaskIds}
              />
            )}
            {lane === "rest" && (
              <CarriedLane
                carried={byLane.loose}
                captures={byLane.inbox}
                inboxCount={inboxCount}
                kept={kept}
                setKept={setKept}
                data={data}
                runs={runs}
                onRemoveFromRun={removeFromRun}
                onSlot={() => void slotLooseWork()}
                slotting={theming}
                slotErr={themeErr}
              />
            )}
          </div>
        </aside>

        {/* The week — never a step. It fills as you keep things in the rail, so
            "the week is full" arrives while you can still do something about it. */}
        <section className="flex min-w-0 flex-1 flex-col gap-3 px-6 pb-4 pt-5">
          {gridDays.length === 0 ? (
            <EmptyState icon={<Icon name="calendar" size={20} />}>No working days set</EmptyState>
          ) : (
            <>
              {/* the week takes the height — it's the thing you're reading */}
              <div className="min-h-0 flex-1">
                <WeekGrid
                  days={gridDays}
                  events={lane === "open" ? weekEvents : visibleEvents}
                  isEventAside={lane === "open" ? hiddenEvent : undefined}
                  onToggleEvent={lane === "open" ? toggleEventHidden : undefined}
                  slots={weekSlots}
                  locked={onCalBlocks}
                  placements={shownPlacements}
                  slotById={slotById}
                  data={data}
                  workStartMin={workStart}
                  workEndMin={workEnd}
                  dayContexts={dayContexts}
                  gaps={lane === "open" && roomFound ? gapsByDay : null}
                  onDrop={dropBlock}
                  onMove={movePlacement}
                  onResize={resizePlacement}
                />
              </div>

              {/* …and the reference sits under it at its own size, so a long
                  "no room" list can never squeeze the week it's describing. */}
              <div className="grid shrink-0 gap-3">
                {/* Step 1 has put nothing on the week yet, so a load meter here
                    would measure the calendar you're already looking at. It
                    appears the moment your own work starts landing. */}
                {lane !== "open" && (
                  <CapacityMeter
                    intake={intake}
                    fit={{ placed: shownPlacements.length, unplaced: shownUnplaced.length }}
                    revealed={revealed}
                    compact
                  />
                )}

                {shownUnplaced.length > 0 && (
                  <div className="max-h-[22vh] overflow-y-auto">
                    <UnplacedReport unplaced={shownUnplaced} onShowProjects={() => setLane("projects")} />
                  </div>
                )}

                {/* boundaries — settings, tucked away; here when you need them */}
                <Boundaries
                  open={showBoundaries}
                  onToggle={() => setShowBoundaries((s) => !s)}
                  weekDays={weekDays}
                  fromGate={fromGate}
                  workingDays={workingDays}
                  setWorkingDays={setWorkingDays}
                />
              </div>
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}

// ── the frame — the Flow layout (D-190) ──────────────────────────────────────
function Shell({
  onClose,
  weekStartISO,
  lane,
  onLane,
  footer,
  children,
}: {
  onClose: () => void;
  /** Absent on the done state, which names the week in its own hero. */
  weekStartISO?: string;
  /** the station you're on; null once the week is committed (every step done) */
  lane: WeekPlanStep | null;
  onLane: (s: WeekPlanStep) => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <FlowFrame
      label="Plan the week"
      onClose={onClose}
      closeLabel="Close — the draft resumes where you left it"
      center={
        lane ? (
          <SourceSwitch step={lane} onStep={(s) => onLane(s as WeekPlanStep)} steps={PLAN_STEPS} />
        ) : (
          <span className="f-top-title">Plan the week</span>
        )
      }
      right={
        weekStartISO && (
          <span className="f-top-meta">
            {weekName(weekStartISO)} · {weekSpan(weekStartISO)}
          </span>
        )
      }
      footer={footer}
    >
      {/* the two panes own their own scrolling — the rail and the week move
          independently, so neither one drags the other past its heading */}
      {children}
    </FlowFrame>
  );
}

// ── the three sources, as the desktop lays them out ─────────────────────────
// Same three lanes as the phone, same order, same words — one act, two shells.

/**
 * What didn't get a time.
 *
 * There is exactly one reason left: **the week had nowhere to put it.** There
 * used to be a second — work refused for running past a derived "proven pace"
 * ceiling — and it was the majority of this list while the calendar sat visibly
 * open. That gate is gone (the calendar is the constraint; see `useWeekDraft`),
 * so this heading is now true whenever it appears.
 */
function UnplacedReport({
  unplaced,
  onShowProjects,
}: {
  unplaced: UnplacedTask[];
  onShowProjects: () => void;
}) {
  return (
    <section className="f-section">
      {/* Project work that found no time is a decision, not a leftover — the
          acts for it live on its row in the Projects step, one click away. */}
      <SectionHeader
        title={<span style={{ color: "var(--warn)" }}>No open time left</span>}
        count={unplaced.length}
        actions={
          unplaced.some((u) => u.task.project_id) ? (
            <Button size="xs" kind="ghost" onClick={onShowProjects} trailing={<Icon name="arrow-right" size={12} />}>
              Sort it on Projects
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-x-8 md:grid-cols-2">
        {unplaced.map(({ task, reason }) => (
          <Row key={task.id} title={task.title} meta={reason} style={{ boxShadow: "inset 0 -1px 0 var(--line-1)", borderRadius: 0 }} />
        ))}
      </div>
    </section>
  );
}

/**
 * Step 1 · the week as it already stands.
 *
 * The first thing you see is the *empty* week: the immovable calendar, and the
 * room between it drawn as open time. **The rail says almost nothing here, on
 * purpose.** The grid already shows every meeting in its own shape and place, so
 * the act lives *there*: click a meeting you aren't going to and its time turns
 * into open time under your cursor (`hidden_events`). The rail only shows the
 * gesture: the two states of a block, as the grid draws them.
 */
function OpenTimeLane() {
  return (
    <section className="flex items-center gap-2.5 pt-1">
      <div className="min-w-0 flex-1">
        <SampleBlock kind="committed" />
      </div>
      <Icon name="arrow-right" size={14} className="shrink-0 text-[var(--faint)]" />
      <div className="min-w-0 flex-1">
        <SampleBlock kind="open" />
      </div>
    </section>
  );
}

/** The two materials of step 1, at the size of a legend — drawn with the exact
 *  fills the grid uses, so the rail is a key to the week rather than a picture
 *  of its own. */
function SampleBlock({ kind }: { kind: "committed" | "open" }) {
  const committed = kind === "committed";
  return (
    <div
      className="flex h-[34px] items-center gap-2 overflow-hidden rounded-[5px] px-2"
      style={committed ? { background: BUSY_FILL, boxShadow: BUSY_EDGE } : { background: OPEN_FILL, boxShadow: OPEN_EDGE }}
    >
      <AsideMark aside={!committed} />
      <span className="min-w-0 flex-1 truncate text-caption font-medium" style={{ color: committed ? "var(--ink)" : "var(--slot)" }}>
        {committed ? "Meeting" : "Open"}
      </span>
    </div>
  );
}

/** ✓ counts against your week · an empty dashed square has been set aside. */
function AsideMark({ aside }: { aside: boolean }) {
  return (
    <span
      aria-hidden
      className="flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[var(--r-chip)]"
      style={aside ? { border: "1px dashed var(--slot)" } : { background: "var(--ink-2)", color: "var(--panel)" }}
    >
      {aside ? null : <Icon name="check" size={9} strokeWidth={3} />}
    </span>
  );
}

/** Slotting, once — the same act and the same read in both lanes that have it.
 *
 *  Carried work and raw captures are the same shape of problem (a scatter of
 *  small things with no home), so both lanes get one button and one
 *  confirmation list. The grouping is a proposal: open one and you can see what
 *  belongs together before it rides onto the calendar under its name. */
function GroupedRuns({
  runs,
  unit,
  first,
  data,
  onRemove,
}: {
  runs: Batch[];
  unit: string;
  first?: boolean;
  data: VerticalData;
  /** Pull a task back out of a block it doesn't belong in. */
  onRemove?: (runId: string, taskId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (runs.length === 0) return null;
  return (
    <section className={`f-section ${first ? "" : "mt-4"}`}>
      <SectionHeader title="Slots" count={runs.length} />
      <div className="f-rows">
        {runs.map((r) => {
          const isOpen = open === r.id;
          const members = r.taskIds
            .map((id) => data.tasks.find((t) => t.id === id))
            .filter((t): t is NonNullable<typeof t> => !!t);
          return (
            <div key={r.id}>
              <Row
                leading={<Dot color={r.color ?? "var(--accent)"} />}
                title={r.name}
                meta={`${r.taskIds.length} ${unit}${r.taskIds.length === 1 ? "" : "s"}`}
                trailing={
                  <Icon
                    name="chevron-down"
                    size={12}
                    style={{ color: "var(--faint)", transform: isOpen ? undefined : "rotate(-90deg)", transition: "transform var(--d-base) var(--ease-out)" }}
                  />
                }
                aria-expanded={isOpen}
                onActivate={() => setOpen((cur) => (cur === r.id ? null : r.id))}
              />
              {isOpen && (
                <div className="grid pb-2 pl-6">
                  {members.map((t) => (
                    <div key={t.id} className="group flex min-h-[28px] items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-caption text-[var(--ink-2)]" title={t.title}>
                        {t.title}
                      </span>
                      <span className="f-num shrink-0 text-caption text-[var(--faint)]">{t.durationMins}m</span>
                      {onRemove && (
                        <IconButton
                          size="xs"
                          label="Doesn't belong here — place it on its own"
                          icon={<Icon name="close" size={12} />}
                          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={() => onRemove(r.id, t.id)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The slotting button — identical in both lanes, so it reads as one act.
 *
 *  Once it HAS grouped, it stops shouting: a filled call-to-action offering to
 *  group above blocks it already made is the screen arguing with itself. It
 *  becomes a quiet re-run instead. */
function GroupButton({
  label,
  busy,
  error,
  grouped,
  onGroup,
}: {
  label: string;
  busy: boolean;
  error: string | null;
  /** Already produced slots — the button demotes to a redo. */
  grouped?: boolean;
  onGroup: () => void;
}) {
  return (
    <>
      {grouped ? (
        <Button
          size="xs"
          kind="ghost"
          icon={<Icon name="refresh" size={12} />}
          onClick={onGroup}
          disabled={busy}
          title="Slot them again — a fresh read of what belongs together"
        >
          {busy ? "Slotting…" : "Slot again"}
        </Button>
      ) : (
        <Button full size="md" icon={<Icon name="sparkles" size={14} />} onClick={onGroup} disabled={busy}>
          {busy ? "Slotting…" : label}
        </Button>
      )}
      {error && <p className="f-error mt-1.5">{error}</p>}
    </>
  );
}

/** Toggle one candidate on or off the week. */
function useToggle(kept: Set<string>, setKept: (next: Set<string>) => void) {
  return (id: string) => {
    const next = new Set(kept);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setKept(next);
  };
}

/** The projects lane — the week's slate, at project altitude.
 *
 *  This used to be four stacked sections (a look-back paragraph, the initiative
 *  leads, the project list, and every piece of their work as a checkbox grid) —
 *  roughly fifty rows to answer one question. Two of those sections answered a
 *  *different* question at a different cadence (the Review's "how did last week
 *  go" and Summit's "which initiatives lead this quarter"), so they're gone from
 *  here. What's left is one row per project, and the work folded underneath it:
 *  you decide on projects first, and open one only when you want to argue with
 *  what came along.
 */
function ProjectsLane({
  data,
  weekStartISO,
  suggestions,
  kept,
  setKept,
  fit,
  placedIds,
}: {
  data: VerticalData;
  weekStartISO: string;
  suggestions: PullSuggestion[];
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  /** How many of each project's pieces the week could take, and why not. */
  fit: Map<string, { placed: number; unplaced: number; reason?: string }>;
  /** Task ids that ended up with a time on the week. */
  placedIds: Set<string>;
}) {
  const { updateProject } = useVertical();
  const { openRecord } = useAppNavigation();
  const [open, setOpen] = useState<string | null>(null);

  const defer = useDeferProject();
  const pushes = useMemo(() => weekPushes(data, weekStartISO), [data, weekStartISO]);
  // Bringing a project in IS placing it on this week — the same kernel patch the
  // On Deck drop and the agent's create_priority apply, so they can't diverge.
  const bringIn = (p: Project) => {
    const patch = bringIntoWeekPatch(p, weekStartISO);
    if (patch) updateProject(p.id, patch);
    // Placed either way — but a project with no steps can't be sized, and the
    // week is where that costs you. Name it, offer the fix, don't refuse.
    noticeIfUnready(data, p, () => openRecord("project", p.id));
  };
  // Leaving the week also clears what the project holds on the calendar — a
  // re-plan mid-week is exactly when it already has a sitting (`useDeferProject`).
  const takeOff = (p: Project) => void defer.takeOff(p, weekStartISO);
  // Both remediations are span writes through the kernel — the same act as
  // dragging the project's card on On Deck, so the deck and the plan can't
  // disagree about where a project lives.
  const spanIt = (p: Project) => updateProject(p.id, spanAnotherWeekPatch(p, weekStartISO));
  const pushOut = (p: Project) => void defer.pushOut(p, weekStartISO);

  const byProject = new Map<string, PullSuggestion[]>();
  const unassigned: PullSuggestion[] = [];
  for (const s of suggestions) {
    const pid = s.projectId;
    if (pid && projectById(data, pid)) {
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid)!.push(s);
    } else unassigned.push(s);
  }

  return (
    <section className="grid gap-4">
      {pushes.length === 0 && <EmptyState>Nothing on this week yet</EmptyState>}

      <div className="f-rows">
        {pushes.map(({ project, carried }) => (
          <ProjectRow
            key={project.id}
            project={project}
            carried={carried}
            data={data}
            rows={byProject.get(project.id) ?? []}
            kept={kept}
            setKept={setKept}
            open={open === project.id}
            onToggleOpen={() => setOpen((cur) => (cur === project.id ? null : project.id))}
            onOpenRecord={() => openRecord("project", project.id)}
            onRemove={() => takeOff(project)}
            fit={fit.get(project.id)}
            placedIds={placedIds}
            onSpan={() => spanIt(project)}
            onPushOut={() => pushOut(project)}
          />
        ))}
      </div>

      {unassigned.length > 0 && (
        <div className="f-section">
          <SectionHeader title="No week set" count={unassigned.length} />
          <WorkList rows={unassigned} data={data} kept={kept} setKept={setKept} />
        </div>
      )}

      <OnDeckChips data={data} weekStartISO={weekStartISO} onBringIn={bringIn} />
    </section>
  );
}

/**
 * A project's pieces, as marks — landed, kept-but-homeless, or dropped.
 *
 * This is the answer to "it says these don't fit; what fits then?" The row used
 * to carry `4/4 · 3.5h`, which is an inventory of what you *kept*: it can read
 * 4/4 while the week took none of it. Three states, three weights, no reading —
 * filled in the project's own colour = it has a time on the week, hollow
 * `--warn` = you kept it and the week had nowhere to put it, faint = you took
 * it off. (Never --signal: the ember means *now*, D-187.)
 */
function FitStrip({
  rows,
  kept,
  placedIds,
  color,
}: {
  rows: PullSuggestion[];
  kept: Set<string>;
  placedIds: Set<string>;
  color: string;
}) {
  const marks = rows.map((r) => {
    const on = kept.has(r.task.id);
    return {
      id: r.task.id,
      title: r.task.title,
      state: !on ? ("off" as const) : placedIds.has(r.task.id) ? ("placed" as const) : ("homeless" as const),
    };
  });
  const landed = marks.filter((m) => m.state === "placed").length;
  const homeless = marks.filter((m) => m.state === "homeless").length;
  return (
    <span
      className="flex shrink-0 items-center gap-[3px]"
      title={
        homeless > 0
          ? `${landed} on the week · ${homeless} with nowhere to go`
          : landed > 0
            ? `${landed} on the week`
            : "nothing kept"
      }
    >
      {marks.map((m) => (
        <span
          key={m.id}
          title={`${m.title} — ${m.state === "placed" ? "on the week" : m.state === "homeless" ? "no room found" : "off this week"}`}
          className="h-[12px] w-[4px] rounded-[1px]"
          style={
            m.state === "placed"
              ? { background: color }
              : m.state === "homeless"
                ? { boxShadow: "inset 0 0 0 1.25px var(--warn)" }
                : { background: "var(--line-2)" }
          }
        />
      ))}
    </span>
  );
}

/** One project on the week. Collapsed it says the four things you decide on:
 *  whose world it's in (the dot), what it is, what it's asking of the week, and —
 *  only when there IS one — what's missing. "Ready to slot" on every row was five
 *  identical words carrying no information, so readiness is now a silence. */
function ProjectRow({
  project,
  carried,
  data,
  rows,
  kept,
  setKept,
  open,
  onToggleOpen,
  onOpenRecord,
  onRemove,
  fit,
  placedIds,
  onSpan,
  onPushOut,
}: {
  project: Project;
  /** weeks it has been carrying past the week it was committed to (0 = chosen
   *  for this week). Sunday has to distinguish a decision from a leftover. */
  carried: number;
  data: VerticalData;
  rows: PullSuggestion[];
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  open: boolean;
  onToggleOpen: () => void;
  onOpenRecord: () => void;
  onRemove: () => void;
  fit?: { placed: number; unplaced: number; reason?: string };
  placedIds: Set<string>;
  onSpan: () => void;
  onPushOut: () => void;
}) {
  const color = domainById(data, project.domainId)?.color ?? "var(--accent)";
  const gaps = lensGaps(data, "project", project, new Date());
  const ready = gaps.length === 0;
  const on = rows.filter((r) => kept.has(r.task.id));
  const allOn = rows.length > 0 && on.length === rows.length;

  const someOn = on.length > 0;

  return (
    <div className="group py-1">
      <div className="flex min-h-[38px] items-center gap-2.5 px-1">
        <button
          type="button"
          onClick={onToggleOpen}
          disabled={rows.length === 0}
          title={project.outcome?.trim() || "no outcome yet"}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {ready ? (
            <Dot color={color} />
          ) : (
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2.5px]" style={{ boxShadow: "inset 0 0 0 1.5px var(--line-2)" }} />
          )}
          <span className="min-w-0 flex-1 truncate text-body font-medium text-[var(--ink)]">{project.name}</span>
          {/* Carrying, not chosen — Sunday's whole job is telling those apart. */}
          {carried > 0 && (
            <span className="f-num shrink-0 text-caption text-[var(--faint)]" title={carryMark(carried).title}>
              {carryMark(carried).text}
            </span>
          )}
          {rows.length > 0 && (
            <Icon
              name="chevron-down"
              size={12}
              style={{ color: "var(--faint)", flex: "none", transform: open ? undefined : "rotate(-90deg)", transition: "transform var(--d-base) var(--ease-out)" }}
            />
          )}
        </button>

        {/* What happened to it — one mark per piece, so "did this land?" is
            answered on the row instead of being hunted for on the grid. */}
        {!ready ? (
          <span className="shrink-0 text-caption" style={{ color: "var(--warn)" }}>
            {gaps.map((g) => g.label).join(" · ")}
          </span>
        ) : rows.length === 0 ? (
          <span className="shrink-0 text-caption text-[var(--faint)]">No open work</span>
        ) : (
          <FitStrip rows={rows} kept={kept} placedIds={placedIds} color={color} />
        )}

        <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <IconButton size="xs" label={`Open ${project.name}`} icon={<Icon name="arrow-right" size={12} />} onClick={onOpenRecord} />
          <IconButton size="xs" label="Take it off this week" icon={<Icon name="close" size={12} />} onClick={onRemove} />
        </span>
      </div>

      {/* The week couldn't take all of it — said here, while you're still
          choosing, with the two acts that actually resolve it. */}
      {fit && fit.unplaced > 0 && (
        <RemedyPanel
          problem={
            fit.placed > 0
              ? `Only ${fit.placed} of ${fit.placed + fit.unplaced} pieces fit this week.`
              : `None of its ${fit.unplaced} pieces fit this week.`
          }
          // …and WHY, in the composer's own words. "No room" beside a calendar
          // with ten open hours reads as a lie unless it says what the room was
          // missing — length, order, or a deadline.
          why={fit.reason}
          acts={[
            ...(fit.placed > 0
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
          ]}
        />
      )}

      {open && rows.length > 0 && (
        <div className="grid gap-0.5 pb-2 pl-5">
          <div className="flex items-center gap-2 px-2 py-1">
            <Checkbox
              checked={allOn ? true : someOn ? "mixed" : false}
              onChange={() => {
                const next = new Set(kept);
                rows.forEach((r) => (allOn ? next.delete(r.task.id) : next.add(r.task.id)));
                setKept(next);
              }}
              label={allOn ? "Keep none" : "Keep all"}
            />
            <span className="text-caption font-medium text-muted">{allOn ? "None" : "All"}</span>
          </div>
          <WorkList rows={rows} data={data} kept={kept} setKept={setKept} />
        </div>
      )}
    </div>
  );
}

/** A pool of candidate work — the same row everywhere it appears. */
function WorkList({
  rows,
  data,
  kept,
  setKept,
}: {
  rows: PullSuggestion[];
  data: VerticalData;
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
}) {
  const { updateTask } = useVertical();
  const toggle = useToggle(kept, setKept);
  return (
    <div className="grid">
      {rows.map((r) => (
        <WorkRow
          key={r.task.id}
          on={kept.has(r.task.id)}
          onToggle={() => toggle(r.task.id)}
          color={domainById(data, r.task.domainId)?.color}
          title={r.task.title}
          mins={r.task.durationMins}
          onMins={(m) => updateTask(r.task.id, { durationMins: m })}
          reason={r.reason}
          badge={workBadge(r.kind, r.task)}
        />
      ))}
    </div>
  );
}

/** On deck — the candidates, one tap to bring in. Recognition, not recall. */
function OnDeckChips({
  data,
  weekStartISO,
  onBringIn,
}: {
  data: VerticalData;
  weekStartISO: string;
  onBringIn: (p: Project) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const onDeckIds = new Set(projectsOnDeck(data, weekStartISO).map((p) => p.id));
  const openProjects = data.projects.filter(
    (p) => p.status !== "complete" && p.status !== "cancelled" && !onDeckIds.has(p.id),
  );
  const needsWeek = openProjects.filter((p) => !p.targetDate);
  const elsewhere = openProjects.filter((p) => p.targetDate);
  if (needsWeek.length === 0 && elsewhere.length === 0) return null;

  const chip = (p: Project, reason: string) => (
    <ChipButton
      key={p.id}
      dot={domainById(data, p.domainId)?.color ?? "var(--accent)"}
      onClick={() => onBringIn(p)}
      title={`Move "${p.name}" to this week — ${reason}`}
    >
      {p.name}
    </ChipButton>
  );

  // Adding a project is the exception, not the task — most weeks you're deciding
  // about what's already on the slate. So it's a single quiet line until you want
  // it, instead of a wall of chips competing with the projects you're reading.
  const total = needsWeek.length + elsewhere.length;
  return (
    <div className="grid gap-2">
      <div>
        <Button
          size="xs"
          kind="ghost"
          icon={<Icon name="plus" size={12} />}
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
          data-teach="plan-bring-in"
        >
          Bring one in <span className="f-num text-[var(--faint)]">{total}</span>
        </Button>
      </div>
      {showAll && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {needsWeek.map((p) => chip(p, "needs a week"))}
          {elsewhere.map((p) => chip(p, `sits on the week of ${format(parseDateISO(p.targetDate!), "MMM d")}`))}
        </div>
      )}
    </div>
  );
}

/**
 * Step 3 · everything the week carries that isn't a project.
 *
 * This was two steps — *Leftovers* then *Inbox* — and they were one decision
 * wearing two hats. A carried task **was** a capture once; the difference is
 * provenance, not kind. One step, one pool, one slotting pass.
 *
 * Provenance still shows — you read *carried over* differently from *new* — but
 * as sections inside one decision rather than as two stops on the walk.
 */
function CarriedLane({
  carried,
  captures,
  inboxCount,
  kept,
  setKept,
  data,
  runs,
  onRemoveFromRun,
  onSlot,
  slotting,
  slotErr,
}: {
  carried: PullSuggestion[];
  captures: PullSuggestion[];
  inboxCount: number;
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  data: VerticalData;
  runs: Batch[];
  onRemoveFromRun: (runId: string, taskId: string) => void;
  onSlot: () => void;
  slotting: boolean;
  slotErr: string | null;
}) {
  const { updateTask } = useVertical();
  const [showMore, setShowMore] = useState(false);
  const toggle = useToggle(kept, setKept);

  const suggestedIds = new Set([...carried, ...captures].map((s) => s.task.id));
  const more = useMemo(() => {
    const extra = [...inboxTasks(data), ...backlogTasks(data)].filter((t) => !suggestedIds.has(t.id));
    const seen = new Set<string>();
    return extra.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const rolled = carried.filter((s) => s.task.rollCount > 0);
  const rest = carried.filter((s) => s.task.rollCount === 0);

  const row = (s: PullSuggestion) => (
    <WorkRow
      key={s.task.id}
      on={kept.has(s.task.id)}
      onToggle={() => toggle(s.task.id)}
      color={domainById(data, s.task.domainId)?.color}
      title={s.task.title}
      mins={s.task.durationMins}
      onMins={(m) => updateTask(s.task.id, { durationMins: m })}
      reason={s.reason}
      badge={workBadge(s.kind, s.task)}
    />
  );

  const group = (label: string, rows: PullSuggestion[], tone?: string) =>
    rows.length === 0 ? null : (
      <div className="f-section">
        <SectionHeader title={label} count={<span style={tone ? { color: tone } : undefined}>{rows.length}</span>} />
        <div className="grid">{rows.map(row)}</div>
      </div>
    );

  return (
    <section className="grid gap-4">
      {/* The slots come first: they're the proposal you're here to agree with. */}
      {slotting && runs.length === 0 ? (
        <EmptyState icon={<Icon name="sparkles" size={20} />}>Slotting…</EmptyState>
      ) : (
        <GroupedRuns runs={runs} unit="piece" first data={data} onRemove={onRemoveFromRun} />
      )}
      {runs.length > 0 && (
        <div>
          <GroupButton label="Slot them" busy={slotting} error={slotErr} grouped onGroup={onSlot} />
        </div>
      )}

      <div className="grid gap-4" style={runs.length > 0 ? { borderTop: "1px solid var(--line-1)", paddingTop: 12 } : undefined}>
        {group("Carried over", rolled, "var(--warn)")}
        {group("Due this week", rest)}
        {group("New captures", captures)}
        {carried.length === 0 && captures.length === 0 && (
          <EmptyState>{inboxCount > 0 ? `${inboxCount} in the inbox, none due` : "Nothing owed, nothing new"}</EmptyState>
        )}
      </div>

      <div>
        <Button
          size="xs"
          kind="ghost"
          icon={<Icon name={showMore ? "chevron-down" : "plus"} size={12} />}
          aria-expanded={showMore}
          onClick={() => setShowMore((m) => !m)}
        >
          {showMore ? "Hide" : "Add more"}
        </Button>
      </div>

      {showMore && (
        <div className="f-section">
          <SectionHeader title="Inbox & backlog" count={more.length} />
          {more.length === 0 && <EmptyState>Nothing else waiting</EmptyState>}
          <div className="grid">
            {more.map((t) => (
              <WorkRow
                key={t.id}
                on={kept.has(t.id)}
                onToggle={() => toggle(t.id)}
                color={domainById(data, t.domainId)?.color}
                title={t.title || "untitled"}
                mins={t.durationMins}
                onMins={(m) => updateTask(t.id, { durationMins: m })}
                reason={t.inbox ? "from the inbox" : "from a backlog"}
                badge={t.rollCount > 0 ? workBadge("carried", t) : null}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** A piece of candidate work — the kit Row: a check, its world, its name, the
 *  one mark worth a glance, and how long a sitting it wants. Kept rows read in
 *  ink; set-aside ones go faint. */
function WorkRow({
  on,
  onToggle,
  color,
  title,
  mins,
  onMins,
  reason,
  badge,
}: {
  on: boolean;
  onToggle: () => void;
  color?: string | null;
  title: string;
  mins: number;
  onMins: (m: number) => void;
  /** the long form — kept as the row's tooltip */
  reason: string;
  badge: ReturnType<typeof workBadge>;
}) {
  return (
    <Row
      // the reason rides as the title's tooltip (lib/tooltips)
      title={<span title={reason}>{title}</span>}
      done={!on}
      onActivate={onToggle}
      aria-pressed={on}
      leading={
        <>
          <Checkbox checked={on} onChange={onToggle} label={on ? `Keep ${title}` : `Add ${title}`} />
          <Dot color={color ?? "var(--line-2)"} />
        </>
      }
      trailing={
        <>
          {/* two glyphs where a clause used to be — the clause survives as the title */}
          {badge && (
            <Chip className={badge.urgent ? "f-chip-warn" : undefined}>
              <span className="f-num">{badge.text}</span>
            </Chip>
          )}
          <DurationSelect value={mins} onChange={onMins} className="f-dur shrink-0" title="Sitting length" />
        </>
      }
    />
  );
}

// ── boundaries — working hours (a setting) + per-day contexts; tucked away ───
function Boundaries({
  open,
  onToggle,
  weekDays,
  fromGate,
  workingDays,
  setWorkingDays,
}: {
  open: boolean;
  onToggle: () => void;
  weekDays: string[];
  fromGate: string;
  workingDays: number[];
  setWorkingDays: (d: number[]) => void;
}) {
  const { data, setDayContexts } = useVertical();
  const { settings, update: updateSettings } = useSettings();
  const workStart = settings?.work_start_minutes ?? 480;
  const workEnd = settings?.work_end_minutes ?? 990;
  const dayContexts = (data.sprint?.day_contexts ?? {}) as Record<string, DayContext>;
  // context tweaks only make sense on the days you actually work
  const workingISOs = weekDays.filter((iso) => workingDays.includes(parseDateISO(iso).getDay()));

  const cycleContext = (iso: string) => {
    const cur = dayContexts[iso] ?? "normal";
    const next = CONTEXT_CYCLE[(CONTEXT_CYCLE.indexOf(cur) + 1) % CONTEXT_CYCLE.length];
    setDayContexts({ ...dayContexts, [iso]: next });
  };
  const toggleWorkingDay = (dow: number) =>
    setWorkingDays(workingDays.includes(dow) ? workingDays.filter((d) => d !== dow) : [...workingDays, dow].sort());

  const workingLabel = [1, 2, 3, 4, 5].every((d) => workingDays.includes(d)) && workingDays.length === 5
    ? "Mon–Fri"
    : `${workingDays.length} day${workingDays.length === 1 ? "" : "s"}`;

  return (
    <section className="f-section" style={{ borderTop: "1px solid var(--line-1)", paddingTop: 4 }}>
      <SectionHeader
        title="Boundaries"
        collapsed={!open}
        onToggle={onToggle}
        actions={
          <span className="f-num text-caption font-medium text-muted">
            {workingLabel} · {spanMin(workStart, workEnd)}
          </span>
        }
      />
      {open && (
        <div className="grid gap-2.5 pb-1 pt-1">
          {/* working days — the recurring boundary; weekends off by default */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-[104px] shrink-0 text-caption text-muted">Working days</span>
            {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
              const on = workingDays.includes(dow);
              return (
                <Button
                  key={dow}
                  size="xs"
                  kind={on ? "secondary" : "ghost"}
                  active={on}
                  aria-pressed={on}
                  className="!w-8"
                  onClick={() => toggleWorkingDay(dow)}
                  title={`${on ? "A working day" : "Off"} — click to toggle`}
                >
                  {DAY_GLYPH[dow]}
                </Button>
              );
            })}
          </div>

          <label className="flex items-center gap-1.5 text-caption text-muted">
            <span className="w-[104px] shrink-0">Working hours</span>
            <TimeInput step={900} minutes={workStart} onCommit={(m) => updateSettings({ work_start_minutes: m })}
              className="!w-32 text-caption" />
            <span aria-hidden>–</span>
            <TimeInput step={900} minutes={workEnd} onCommit={(m) => updateSettings({ work_end_minutes: m })}
              className="!w-32 text-caption" />
          </label>

          {workingISOs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="w-[104px] shrink-0 text-caption text-muted" title="normal · ◐ light · ✈ travel · — off">
                This week
              </span>
              {workingISOs.map((iso) => {
                const ctx = dayContexts[iso] ?? "normal";
                const past = iso < fromGate;
                const meta = CONTEXT_META[ctx];
                return (
                  <Button
                    key={iso}
                    size="xs"
                    kind={ctx === "normal" ? "ghost" : "secondary"}
                    active={ctx !== "normal"}
                    disabled={past}
                    onClick={() => cycleContext(iso)}
                    title={`${format(parseDateISO(iso), "EEEE")} — ${meta.label} (click to change)`}
                  >
                    {format(parseDateISO(iso), "EEEEE")} {meta.glyph}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── the act — the walk's one forward move, bottom-right of the footer ──────
//
// The label names the **act**, not the destination. "Projects →" told you where
// you'd land and nothing about what pressing it does; each press actually adds a
// source, and the grid animating is that sentence finishing. ↵ does it; the
// commit itself asks for ⌘↵.
function WalkAction({
  lane,
  stepCount,
  applying,
  onNext,
  onCommit,
}: {
  lane: WeekPlanStep;
  stepCount: number;
  applying: boolean;
  onNext: (next: WeekPlanStep) => void;
  onCommit: () => void;
}) {
  const step = PLAN_STEPS.indexOf(lane);
  const last = step === stepCount - 1;
  return (
    <Button
      kind="primary"
      size="md"
      onClick={last ? onCommit : () => onNext(PLAN_STEPS[step + 1])}
      disabled={applying}
      shortcut={last ? ["⌘", "↵"] : "↵"}
    >
      {/* completes the step you're on (STEP_DONE); where you land next is the
          stepper's to say */}
      {last ? (applying ? "Committing…" : STEP_DONE.week) : STEP_DONE[lane]}
    </Button>
  );
}

// ── the week grid — a familiar week planner; OUR placements rendered strong ──
/**
 * Overlapping blocks share the column instead of stacking on top of each other.
 *
 * Without this the week is a pile: drag one block over another to swap them and
 * the thing you were aiming at vanishes underneath the thing you're holding, so
 * the one gesture that needs both visible is the one that hides one of them.
 * Standard calendar column packing — a run of mutually overlapping blocks is a
 * cluster, every block takes the first column free at its start, and the whole
 * cluster splits the width evenly.
 */
function assignLanes(items: { id: string; startMin: number; endMin: number }[]) {
  const out = new Map<string, { col: number; cols: number }>();
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  let cluster: typeof sorted = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = [];
    const assigned: { id: string; col: number }[] = [];
    for (const it of cluster) {
      let col = colEnds.findIndex((e) => e <= it.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(it.endMin);
      } else colEnds[col] = it.endMin;
      assigned.push({ id: it.id, col });
    }
    for (const a of assigned) out.set(a.id, { col: a.col, cols: colEnds.length });
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const it of sorted) {
    if (cluster.length > 0 && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
}

/** Where a block sits across its column, once its neighbours have had their say. */
const laneStyle = (lane: { col: number; cols: number } | undefined) => {
  const { col, cols } = lane ?? { col: 0, cols: 1 };
  return {
    left: `calc(${(col / cols) * 100}% + 4px)`,
    width: `calc(${100 / cols}% - 8px)`,
  };
};

interface GridItem {
  id: string;
  kind: "event" | "locked" | "new" | "slot";
  startMin: number;
  endMin: number;
  title: string;
  color: string | null;
  reason?: string;
  /** The originating task row (== id for whole blocks; the shared base for split
   *  pieces). Used for drop/remove, which acts on the whole task. */
  taskId?: string;
  /** Project-backed work reads as a "project slot" — significant, not errand
   *  time. Carries the project name as an eyebrow above the title. */
  project?: string | null;
  /** how many tasks this block holds — set only on a project slot */
  holds?: number;
  /** Set on an overdue task carved across sittings — this piece is 1 of N. */
  split?: { part: number; parts: number };
  /** One sitting of a project too big for one — "part 2 of 3". */
  slotPart?: { part: number; parts: number };
  /** An external commitment you've set aside — its time reads as open. */
  aside?: boolean;
  /** The event behind an "event" item, when it can be set aside / brought back. */
  event?: ExternalEvent;
}

function WeekGrid({
  days,
  events,
  isEventAside,
  onToggleEvent,
  slots,
  locked,
  placements,
  slotById,
  data,
  workStartMin,
  workEndMin,
  dayContexts,
  gaps,
  onDrop,
  onMove,
  onResize,
}: {
  days: { iso: string; past: boolean }[];
  events: ExternalEvent[];
  /** Step 1 only: is this commitment set aside? (present ⇒ events are clickable) */
  isEventAside?: (e: ExternalEvent) => boolean;
  onToggleEvent?: (e: ExternalEvent) => void;
  slots: Slot[];
  locked: Task[];
  placements: Placement[];
  /** placements whose "task" is really a project slot, by synthetic id */
  slotById: Map<string, Batch>;
  data: VerticalData;
  workStartMin: number;
  workEndMin: number;
  dayContexts: Record<string, DayContext>;
  /** Open spans per day, drawn as claimable time. Set on the "before" step, where
   *  the question is how much room there is; null once your work is on the grid. */
  gaps?: Map<string, Gap[]> | null;
  onDrop: (taskId: string) => void;
  onMove: (taskId: string, dayISO: string, startMin: number) => void;
  onResize: (taskId: string, durationMin: number) => void;
}) {
  const dayKeys = new Set(days.map((d) => d.iso));
  const byDay = new Map<string, GridItem[]>();
  const add = (iso: string, it: GridItem) => {
    if (!dayKeys.has(iso)) return;
    if (!byDay.has(iso)) byDay.set(iso, []);
    byDay.get(iso)!.push(it);
  };

  for (const e of events) {
    if (!e.busy || e.all_day) continue;
    const s = new Date(e.start_at);
    const en = new Date(e.end_at);
    const iso = format(s, "yyyy-MM-dd");
    const sameDay = format(en, "yyyy-MM-dd") === iso;
    add(iso, {
      id: e.id,
      kind: "event",
      startMin: s.getHours() * 60 + s.getMinutes(),
      endMin: sameDay ? en.getHours() * 60 + en.getMinutes() : 24 * 60,
      title: e.title || "busy",
      color: null,
      aside: isEventAside?.(e) ?? false,
      event: onToggleEvent ? e : undefined,
    });
  }
  for (const b of locked) {
    if (!b.start_time) continue;
    const s = new Date(b.start_time);
    const en = endOf({ start_time: b.start_time, duration_minutes: b.duration_minutes });
    add(format(s, "yyyy-MM-dd"), {
      id: b.id,
      kind: "locked",
      startMin: s.getHours() * 60 + s.getMinutes(),
      endMin: en.getHours() * 60 + en.getMinutes(),
      title: b.title,
      color: taskDomainColor(data, b),
    });
  }
  for (const p of placements) {
    const split = p.parts && p.parts > 1 ? { part: p.part!, parts: p.parts } : undefined;
    // a project slot's "task" is the sitting itself — its title IS the project,
    // and the tasks it holds are the detail
    const slot = slotById.get(p.task.id);
    add(p.dayISO, {
      // the block's identity — split pieces share a task id, so they key by part
      id: placementKey(p),
      taskId: p.task.id,
      kind: "new",
      startMin: p.startMin,
      endMin: p.startMin + p.durationMin,
      // the base name — the eyebrow says which part, so the title needn't repeat it
      title: slot?.baseName ?? p.task.title,
      color: taskDomainColor(data, p.task),
      reason: p.reason,
      project: p.task.project_id ? projectById(data, p.task.project_id)?.name ?? null : null,
      holds: slot ? slot.taskIds.length : undefined,
      slotPart: slot?.part && slot.parts ? { part: slot.part, parts: slot.parts } : undefined,
      split,
    });
  }
  // batched focus blocks (Slots) the user has already created — shown as
  // intentional blocks holding their tasks
  for (const sl of slots) {
    const s = new Date(sl.start_time);
    const en = new Date(s.getTime() + sl.duration_minutes * 60_000);
    add(format(s, "yyyy-MM-dd"), {
      id: sl.id,
      kind: "slot",
      startMin: s.getHours() * 60 + s.getMinutes(),
      endMin: en.getHours() * 60 + en.getMinutes(),
      title: sl.title,
      color: sl.color ?? (sl.domain_id ? domainById(data, sl.domain_id)?.color ?? null : null),
    });
  }

  // the visible window: work hours, stretched to fit anything poking outside
  let lo = workStartMin;
  let hi = workEndMin;
  for (const items of byDay.values()) for (const it of items) {
    lo = Math.min(lo, it.startMin);
    hi = Math.max(hi, it.endMin);
  }
  lo = Math.max(0, Math.floor(lo / 60) * 60);
  hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
  const hours: number[] = [];
  for (let h = lo; h < hi; h += 60) hours.push(h);

  /**
   * An hour is at least `HOUR_PX` tall, and taller when the pane can afford it.
   *
   * A fixed 44px meant a tall window showed the same cramped week as a short one
   * — hours ended two-thirds down the pane with dead space beneath, and a
   * 15-minute commitment stayed an 11px sliver you couldn't read or aim at.
   * Stretching to fit is what makes the extra height *worth* anything: bigger
   * blocks, legible titles, real click targets.
   */
  const [paneH, setPaneH] = useState(0);
  const paneRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPaneH(el.clientHeight));
    ro.observe(el);
    setPaneH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const HEADER_H = 46; // the sticky day headers live inside the same scroller
  const hourPx =
    hours.length > 0 && paneH > 0
      ? Math.max(HOUR_PX, Math.floor((paneH - HEADER_H) / hours.length))
      : HOUR_PX;
  const totalH = ((hi - lo) / 60) * hourPx;
  const yOf = (m: number) => ((m - lo) / 60) * hourPx;

  // ── hand-editing — drag a placed block to move it, drag its edge to resize ──
  // Pointer events (Tauri swallows HTML5 DnD). The held block lifts into glass and
  // the destination column highlights — the drag-and-hold contract (design-language).
  const colRefs = useRef(new Map<string, HTMLDivElement>());
  const colSnapRef = useRef<Array<{ iso: string; left: number; right: number; top: number }>>([]);
  const dragRef = useRef<
    | { id: string; mode: "move" | "resize"; title: string; hue: string; dayISO: string; startMin: number; durationMin: number; grabOffsetMin: number; moved: boolean }
    | null
  >(null);
  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);
  const drag = dragRef.current;
  // A block that holds several tasks says "· 3 tasks" and nothing else — which is
  // the one moment in the flow you most want to look inside. Clicking it opens
  // what's in the sitting. (A click is a press that didn't move; the same pointer
  // gesture still drags, so nothing is taken away.)
  const [inspect, setInspect] = useState<string | null>(null);
  useEffect(() => {
    if (!inspect) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // capture phase + stopImmediatePropagation, so Escape closes this popover
      // instead of falling through and closing the whole flow
      e.stopImmediatePropagation();
      setInspect(null);
    };
    // …and any press outside it closes it, the way every popover in the app does
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-peek]") || el?.closest("[data-block]")) return;
      setInspect(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [inspect]);

  const snap = (m: number) => Math.round(m / 15) * 15;
  // at the hour height actually drawn — dividing by the HOUR_PX floor made a drag
  // travel further than the cursor whenever the pane stretched the hours taller
  const minAt = (clientY: number, colTop: number) => lo + ((clientY - colTop) / hourPx) * 60;
  const colTopOf = (iso: string) => {
    const el = colRefs.current.get(iso);
    return el ? el.getBoundingClientRect().top : 0;
  };

  useEffect(() => {
    let bumpRaf = 0;
    const scheduleBump = () => {
      if (bumpRaf) return;
      bumpRaf = requestAnimationFrame(() => {
        bumpRaf = 0;
        bump();
      });
    };
    const colTopDuringDrag = (iso: string) =>
      colSnapRef.current.find((c) => c.iso === iso)?.top ?? colTopOf(iso);

    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === "move") {
        let targetISO = d.dayISO;
        for (const c of colSnapRef.current) {
          if (e.clientX >= c.left && e.clientX < c.right) {
            targetISO = c.iso;
            break;
          }
        }
        let start = snap(minAt(e.clientY, colTopDuringDrag(targetISO)) - d.grabOffsetMin);
        start = Math.max(lo, Math.min(hi - d.durationMin, start));
        if (targetISO !== d.dayISO || start !== d.startMin) d.moved = true;
        d.dayISO = targetISO;
        d.startMin = start;
      } else {
        let end = snap(minAt(e.clientY, colTopDuringDrag(d.dayISO)));
        end = Math.max(d.startMin + 15, Math.min(hi, end));
        if (end - d.startMin !== d.durationMin) d.moved = true;
        d.durationMin = end - d.startMin;
      }
      scheduleBump();
    };
    const onPointerUp = () => {
      const d = dragRef.current;
      if (!d) return;
      if (bumpRaf) cancelAnimationFrame(bumpRaf);
      if (!d.moved) setInspect((cur) => (cur === d.id ? null : d.id));
      else if (d.mode === "move") onMove(d.id, d.dayISO, d.startMin);
      else onResize(d.id, d.durationMin);
      dragRef.current = null;
      colSnapRef.current = [];
      bump();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [lo, hi, hourPx, onMove, onResize]);

  const startDrag = (e: React.PointerEvent, it: GridItem, dayISO: string, mode: "move" | "resize") => {
    e.preventDefault();
    if (mode === "resize") e.stopPropagation();
    colSnapRef.current = [...colRefs.current.entries()].map(([iso, el]) => {
      const r = el.getBoundingClientRect();
      return { iso, left: r.left, right: r.right, top: r.top };
    });
    const grabOffsetMin = mode === "move" ? minAt(e.clientY, colTopOf(dayISO)) - it.startMin : 0;
    dragRef.current = {
      id: it.id, mode, title: it.title, hue: it.color ?? "var(--accent)",
      dayISO, startMin: it.startMin, durationMin: it.endMin - it.startMin, grabOffsetMin,
      moved: false,
    };
    bump();
  };

  /** What's inside a sitting — the tasks a project slot or a themed run holds. */
  const heldTasks = (blockId: string) => {
    const batch = slotById.get(blockId);
    if (!batch) return [];
    return batch.taskIds
      .map((id) => data.tasks.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => !!t);
  };

  return (
    // Fills whatever height the pane gives it — the week is the thing you read.
    <div
      ref={paneRef}
      className="h-full overflow-auto rounded-[var(--r-card)]"
      style={{ boxShadow: "inset 0 0 0 1px var(--line-1)" }}
    >
      {/* day headers — sticky, on the panel's own solid surface */}
      <div className="sticky top-0 z-10 flex" style={{ background: "var(--panel)", boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
        <div className="w-[52px] shrink-0" />
        {days.map((d) => {
          const ctx = dayContexts[d.iso] ?? "normal";
          return (
            <div
              key={d.iso}
              className="flex h-[46px] min-w-[150px] flex-1 items-center gap-1.5 px-2.5"
              style={{ opacity: d.past ? 0.45 : 1, boxShadow: "inset 1px 0 0 var(--line-1)" }}
            >
              <span className="text-caption font-medium text-muted">{format(parseDateISO(d.iso), "EEE")}</span>
              <span className="f-num text-head font-[650] tracking-[-0.02em] text-[var(--ink)]">{format(parseDateISO(d.iso), "d")}</span>
              <span className="min-w-0 flex-1" />
              {ctx !== "normal" && <Chip tone="accent">{CONTEXT_META[ctx].label}</Chip>}
              {d.past && <span className="text-label text-[var(--faint)]">Passed</span>}
            </div>
          );
        })}
      </div>

      {/* the time canvas */}
      <div className="flex" style={{ height: totalH }}>
        <div className="w-[52px] shrink-0">
          {hours.map((h) => (
            <div key={h} className="relative" style={{ height: hourPx }}>
              <span className="f-num absolute -top-[7px] right-2 text-label text-[var(--faint)]">{atMin(h)}</span>
            </div>
          ))}
        </div>
        {days.map((d) => {
          const items = (byDay.get(d.iso) ?? []).sort((a, b) => a.startMin - b.startMin);
          // The block under your cursor is laid out with everything else, so it
          // takes a column *beside* what it's landing on rather than covering it —
          // which is the whole point of dragging one onto another.
          const ghost =
            drag?.mode === "move" && drag.dayISO === d.iso
              ? { id: "__ghost", startMin: drag.startMin, endMin: drag.startMin + drag.durationMin }
              : null;
          const lanes = assignLanes([...items, ...(ghost ? [ghost] : [])]);
          return (
            <div
              key={d.iso}
              ref={(el) => { if (el) colRefs.current.set(d.iso, el); }}
              className="relative min-w-[150px] flex-1"
              style={{
                opacity: d.past ? 0.5 : 1,
                boxShadow: "inset 1px 0 0 var(--line-1)",
                background: drag?.mode === "move" && drag.dayISO === d.iso ? "var(--accent-wash)" : undefined,
              }}
            >
              {hours.map((h, i) =>
                i === 0 ? null : <div key={h} className="absolute inset-x-0" style={{ top: yOf(h), borderTop: "1px solid var(--line-1)" }} />,
              )}
              {/* open time, drawn — `--slot` is open/claimable everywhere in the
                  app, so the week's room reads the same here as on any planner */}
              {(gaps?.get(d.iso) ?? []).map((g, gi) => {
                const gs = g.start.getHours() * 60 + g.start.getMinutes();
                const ge = g.end.getHours() * 60 + g.end.getMinutes();
                const h = Math.max(MIN_BLOCK_PX, yOf(ge) - yOf(gs));
                return (
                  <div
                    key={`gap-${gs}`}
                    className="gap-in pointer-events-none absolute inset-x-1 rounded-[5px]"
                    style={{
                      top: yOf(gs),
                      height: h,
                      background: OPEN_FILL,
                      boxShadow: OPEN_EDGE,
                      animationDelay: `${Math.min(320, gi * 40)}ms`,
                    }}
                    // the hours survive on hover — never worth the ink on the week
                    title={`${spanMin(gs, ge)} open · ${hrs(g.mins)}h`}
                  />
                );
              })}
              {items.map((it, idx) => {
                const top = yOf(it.startMin);
                const height = Math.max(MIN_BLOCK_PX, yOf(it.endMin) - yOf(it.startMin));
                if (it.kind === "event") {
                  // immovable external commitments — neutral, no identity. On step
                  // 1 they're the one thing you CAN change: set one aside and its
                  // time becomes open, right where you're looking.
                  const canToggle = !!it.event && !!onToggleEvent;
                  const aside = !!it.aside;
                  return (
                    <div
                      key={`ev-${it.id}`}
                      data-block
                      onPointerDown={canToggle ? (e) => e.stopPropagation() : undefined}
                      onClick={canToggle ? () => onToggleEvent!(it.event!) : undefined}
                      // Setting a meeting aside is the one edit step 1 offers, so
                      // it cannot be mouse-only. A block that can't be toggled
                      // stays inert — no tab stop for a thing with no action.
                      {...(canToggle
                        ? pressable(() => onToggleEvent!(it.event!), {
                            label: `${it.title || "Meeting"} — ${aside ? "bring back" : "set aside"}`,
                          })
                        : {})}
                      className={`group/ev absolute overflow-hidden rounded-[5px] px-1.5 py-1 ${canToggle ? "fast" : ""}`}
                      style={{
                        top,
                        height,
                        ...laneStyle(lanes.get(it.id)),
                        // A meeting is a FACT you arrived with, so it is drawn like
                        // one: solid, with a real edge. A set-aside meeting stands
                        // ON open time — it adds no fill of its own; it's the
                        // struck name left on the room it gave back.
                        background: aside ? "transparent" : canToggle ? BUSY_FILL : "color-mix(in srgb, var(--ink) 6%, var(--panel))",
                        boxShadow: aside ? undefined : BUSY_EDGE,
                      }}
                      title={
                        !canToggle
                          ? it.title
                          : aside
                            ? `${it.title} — set aside, its time counts as open. Click to put it back.`
                            : `${it.title} — not going? Click to set it aside and free the time.`
                      }
                    >
                      <div className="flex items-center gap-1.5">
                        {/* The toggle state, said with a mark rather than left to
                            be inferred from a strikethrough. */}
                        {canToggle && height >= 16 && <AsideMark aside={aside} />}
                        <span
                          className="min-w-0 flex-1 truncate text-label font-medium leading-tight"
                          style={
                            aside
                              ? { textDecoration: "line-through", color: "var(--muted)" }
                              : { color: canToggle ? "var(--ink)" : "var(--ink-2)" }
                          }
                        >
                          {it.title}
                        </span>
                      </div>
                    </div>
                  );
                }
                const isNew = it.kind === "new";
                const isSlot = it.kind === "slot";
                const isProject = isNew && !!it.project; // a "project slot" — significant work
                const isSplit = isNew && !!it.split; // an overdue task carved across sittings
                // everything Nuvo places is a proposal you can move — including a
                // split sitting (overrides key per block, so pieces move apart)
                const draggable = isNew;
                const hue = it.color ?? "var(--accent)";
                const dragging = drag?.id === it.id;
                const moveSource = dragging && drag!.mode === "move";
                const resizing = dragging && drag!.mode === "resize";
                const endMin = resizing ? it.startMin + drag!.durationMin : it.endMin;
                const blkTop = yOf(it.startMin);
                const blkHeight = Math.max(MIN_BLOCK_PX, yOf(endMin) - yOf(it.startMin));
                const holds = it.holds ?? 0;
                const open = inspect === it.id;
                // what this block IS, in words — `blockDesignation` (lib/slots)
                // spells it for the Schedule too, so a sitting proposed here and
                // the same sitting on the grid wear one vocabulary.
                const kindLabel =
                  holds > 0
                    ? blockDesignation({
                        kind: isProject ? "project" : "slot",
                        part: it.slotPart,
                        holds,
                        unit: isProject ? "task" : "capture",
                      })
                    : isProject
                      ? blockDesignation({ kind: "project", name: it.project })
                      : isNew
                        ? blockDesignation({ kind: "task" })
                        : null;
                const showEyebrow = blkHeight >= 30 && !!kindLabel;
                const showMeta = blkHeight >= 46;
                const inlineKind = !showEyebrow && !!kindLabel;
                // Tinted by the block's world — its hue mixed into the panel, a
                // 2px identity edge, ink pulled toward the hue. Nuvo's proposal
                // (new) reads a touch stronger than a block already on the week.
                const tint = isProject ? 18 : isNew ? 15 : isSlot ? 12 : 9;
                return (
                  <div
                    key={`${it.kind}-${it.id}`}
                    data-block
                    onPointerDown={draggable ? (e) => startDrag(e, it, d.iso, "move") : undefined}
                    className={`group absolute overflow-hidden rounded-[5px] px-1.5 py-1 ${draggable ? "cursor-grab" : ""} ${isNew ? "block-in" : ""}`}
                    style={{
                      top: blkTop,
                      height: blkHeight,
                      ...laneStyle(lanes.get(it.id)),
                      color: "var(--ink)",
                      background: `color-mix(in srgb, ${hue} ${tint}%, var(--panel))`,
                      boxShadow: moveSource
                        ? `inset 0 0 0 1px var(--line-2)`
                        : open
                          ? `inset ${isProject ? 3 : 2}px 0 0 ${hue}, 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-wash)`
                          : `inset ${isProject ? 3 : 2}px 0 0 ${hue}`,
                      opacity: moveSource ? 0.35 : isNew || isSlot ? 1 : 0.8,
                      zIndex: open ? 25 : undefined,
                      touchAction: draggable ? "none" : undefined,
                      animationDelay: isNew ? `${Math.min(220, idx * 26)}ms` : undefined,
                    }}
                    title={
                      holds > 0
                        ? `click to see the ${holds} task${holds === 1 ? "" : "s"} in this sitting · drag to move`
                        : draggable
                          ? `drag to move · drag the bottom edge to resize${isSplit ? " · one sitting of a split" : ""}`
                          : isSlot
                            ? "focus block — your batched work"
                            : "already on the calendar — locked"
                    }
                  >
                    {/* What KIND of block this is, said in words — at every size a
                        block can be. The designation outlives the title, and the
                        time goes first, because the grid axis already says when. */}
                    {isNew && showEyebrow && kindLabel && (
                      <div
                        className="truncate text-label font-semibold leading-none"
                        style={{ color: `color-mix(in srgb, ${hue} 70%, var(--mix))` }}
                        title={it.project ?? undefined}
                      >
                        {kindLabel}
                      </div>
                    )}
                    <div className="mt-0.5 flex items-start gap-1">
                      <div className="min-w-0 flex-1 truncate text-caption font-semibold leading-tight">
                        {inlineKind && (
                          <span className="text-label" style={{ color: `color-mix(in srgb, ${hue} 70%, var(--mix))` }}>
                            {isProject ? "Project" : holds > 0 ? "Slot" : "Task"}
                            {" · "}
                          </span>
                        )}
                        {it.title}
                      </div>
                      {isNew ? (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => onDrop(it.taskId ?? it.id)}
                          className="grid h-4 w-4 shrink-0 place-items-center rounded-[var(--r-chip)] text-[var(--muted)] opacity-0 group-hover:opacity-100"
                          title={isSplit ? "Remove the whole overdue task from the week" : "Remove from the week"}
                          aria-label={isSplit ? "Remove the whole overdue task from the week" : "Remove from the week"}
                        >
                          <Icon name="close" size={11} />
                        </button>
                      ) : isSlot ? null : (
                        <Icon name="check" size={11} className="shrink-0 text-[var(--faint)]" />
                      )}
                    </div>
                    {(showMeta || !isNew) && blkHeight > 30 && (
                      <div className="f-num truncate text-label leading-tight text-muted">
                        {spanMin(it.startMin, endMin)}
                        {/* the count rides here only when the eyebrow didn't say it */}
                        {holds > 0 && !(isNew && showEyebrow && !(it.slotPart && it.slotPart.parts > 1)) && (
                          <span style={{ color: open ? hue : undefined }}>
                            {" · "}
                            {holds} task{holds === 1 ? "" : "s"}
                          </span>
                        )}
                        {isSplit && (
                          <span style={{ color: "var(--warn)" }}>
                            {" "}
                            · sitting {it.split!.part}/{it.split!.parts}
                          </span>
                        )}
                      </div>
                    )}
                    {draggable && (
                      <div
                        onPointerDown={(e) => startDrag(e, it, d.iso, "resize")}
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                        style={{ touchAction: "none" }}
                        title="Drag to resize"
                      />
                    )}
                  </div>
                );
              })}
              {/* what's inside the sitting you clicked — the tasks a project slot
                  or a themed run holds, which the block could only count */}
              {items.map((it) => {
                if (inspect !== it.id) return null;
                const held = heldTasks(it.taskId ?? it.id);
                if (held.length === 0) return null;
                const hue = it.color ?? "var(--accent)";
                const below = yOf(it.endMin) + 4;
                const tall = held.length * 28 + 48;
                const flip = below + tall > totalH;
                return (
                  <div
                    key={`peek-${it.id}`}
                    data-peek
                    data-nested-surface=""
                    onPointerDown={(e) => e.stopPropagation()}
                    className="pop-in absolute inset-x-1 z-30 rounded-[var(--r-card)] p-1"
                    style={{
                      [flip ? "bottom" : "top"]: flip ? totalH - yOf(it.startMin) + 4 : below,
                      background: "var(--raised)",
                      boxShadow: "var(--sh-pop)",
                      ["--pop-origin" as string]: flip ? "bottom center" : "top center",
                    }}
                  >
                    <div className="flex items-center gap-1.5 py-1 pl-2 pr-0.5">
                      <Dot color={hue} />
                      <span className="min-w-0 flex-1 truncate text-caption font-semibold">{it.title}</span>
                      <IconButton size="xs" label="Close" shortcut="Esc" icon={<Icon name="close" size={12} />} onClick={() => setInspect(null)} />
                    </div>
                    {held.map((t) => (
                      <div key={t.id} className="flex min-h-[26px] items-center gap-2 px-2" style={{ boxShadow: "inset 0 1px 0 var(--line-1)" }}>
                        <span className="min-w-0 flex-1 truncate text-caption" title={t.title}>
                          {t.title}
                        </span>
                        <span className="f-num shrink-0 text-caption text-[var(--faint)]">{t.durationMins}m</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {drag?.mode === "move" && drag.dayISO === d.iso && (
                <div
                  className="glass-grab pointer-events-none absolute overflow-hidden rounded-[5px] px-1.5 py-1"
                  style={{
                    ...laneStyle(lanes.get("__ghost")),
                    top: yOf(drag.startMin),
                    height: Math.max(MIN_BLOCK_PX, yOf(drag.startMin + drag.durationMin) - yOf(drag.startMin)),
                    color: "var(--ink)",
                    background: `color-mix(in srgb, ${drag.hue} 18%, var(--raised))`,
                    boxShadow: `inset 2px 0 0 ${drag.hue}, var(--sh-pop)`,
                    zIndex: 30,
                  }}
                >
                  <div className="truncate text-caption font-semibold leading-tight">{drag.title}</div>
                  <div className="f-num text-label text-muted">{spanMin(drag.startMin, drag.startMin + drag.durationMin)}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── the close — the commit moment (D-187), the same one both shells end on ──
function DoneState({ onClose }: { onClose: () => void }) {
  const { data } = useVertical();
  const committed = sprintTasks(data).filter((t) => t.status !== "done");
  const totalMins = committed.reduce((s, t) => s + t.durationMins, 0);
  const split = sprintMinsByDomain(data);

  return (
    <div className="f-scroll">
      <div className="f-page flex min-h-full items-center justify-center" data-width="narrow">
        <WeekSetMoment
          eyebrow={weekName()}
          goal={data.sprintGoal}
          bands={split.map((x) => ({ key: x.domain.id, label: x.domain.name, color: x.domain.color, mins: x.mins }))}
          facts={
            <>
              {hrs(totalMins)}h committed · {committed.length} tasks · {split.length} domain{split.length === 1 ? "" : "s"}
            </>
          }
          action={
            <Button kind="primary" size="md" full onClick={onClose}>
              Begin the week
            </Button>
          }
        />
      </div>
    </div>
  );
}
