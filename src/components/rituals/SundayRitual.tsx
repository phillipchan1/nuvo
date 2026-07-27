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
import { endOf, fmtHours as hrs, formatHourLabel, parseDateISO } from "../../lib/dates";
import { sprintLabel } from "../../lib/sprint";
import { CONTEXT_META, type DayContext, type Placement, type UnplacedTask } from "../../lib/compose";
import { readDay, toBusyBlocks, type Gap } from "../../lib/now";
import { type Batch } from "../../lib/batch";
import DurationSelect from "../DurationSelect";
import { type PullSuggestion } from "../../lib/pull";
import { lensGaps } from "../../lib/lenses";
import { projectsOnDeck, weekPushes } from "../../lib/priorities";
import { bringIntoWeekPatch, pushToNextWeekPatch, spanAnotherWeekPatch, takeOffWeekPatch } from "../../../supabase/functions/_shared/planningRules.ts";
import { PLAN_STEPS, STEP_ASK, STEP_LABEL, STEP_QUESTION, REVEALED_BY_LANE, laneOf, workBadge, type WeekPlanStep } from "../../lib/intake";
import SourceSwitch, { CapacityMeter } from "./WeekIntake";
import type { ExternalEvent, Slot, Task } from "../../lib/types";
import { Btn } from "../ui";

const CONTEXT_CYCLE: DayContext[] = ["normal", "light", "travel", "off"];
const DAY_GLYPH = ["S", "M", "T", "W", "T", "F", "S"]; // Sun…Sat, for working-day chips
const HOUR_PX = 44;
const MIN_BLOCK_PX = 18;
/**
 * The week has exactly two materials, and they must never be told apart by
 * reading a label. A commitment is neutral ink — heavy, solid, a fact you
 * arrived with. Open time is `--slot` — the same teal that means open/claimable
 * on every planner in the app. They differ by *hue*, not by a few percent of the
 * same grey, which is why the earlier "no fill, one hairline bracket" open time
 * disappeared next to a wall of meetings. Defined once, used by the grid, the
 * rail's day bars, and the legend, so all three read as one key.
 */
const BUSY_FILL = "color-mix(in srgb, var(--ink) 30%, transparent)";
const OPEN_FILL = "color-mix(in srgb, var(--slot) 20%, transparent)";
const OPEN_EDGE = "color-mix(in srgb, var(--slot) 40%, transparent)";
const OPEN_EDGE_STRONG = "color-mix(in srgb, var(--slot) 72%, transparent)";
const toMinLabel = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fmtMinShort = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "p" : "a", hh = ((h + 11) % 12) + 1;
  return mm === 0 ? `${hh}${ap}` : `${hh}:${String(mm).padStart(2, "0")}${ap}`;
};

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
    planningAhead,
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
  /** The week's shape, per working day — committed vs open, for the rail's bars. */
  const weekShape = useMemo(
    () =>
      gridDays.map(({ iso }) => {
        const free = (gapsByDay.get(iso) ?? []).reduce((n, g) => n + g.mins, 0);
        return { iso, busyMins: Math.max(0, workEnd - workStart - free), freeMins: free };
      }),
    [gridDays, gapsByDay, workStart, workEnd],
  );
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


  // esc closes; the draft resumes — nothing is committed until you say so
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (committed) {
    return (
      <Shell onClose={onClose}>
        <DoneState onClose={onClose} />
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      {/* ── the pool, left · the week, right — one screen, the whole ritual ───── */}
      <div className="flex min-h-0 flex-1">
        {/* The planner rail: transparent over the atmosphere, hairline separator,
            full height. Crown → the sources → the pool → the forward beat. */}
        <aside className="flex w-[360px] shrink-0 flex-col border-r border-line">
          <div className="shrink-0 px-5 pt-5">
            <div className="section-label !p-0">
              <span style={{ color: "var(--accent)" }}>{sprintLabel(weekStartISO)}</span> ·{" "}
              {planningAhead ? "the week ahead" : "this week"}
            </div>
            <h1 className="mt-1 text-head masthead leading-tight">
              Week of {format(parseDateISO(weekStartISO), "MMMM d")}
            </h1>
            <div className="mt-3">
              <SourceSwitch step={lane} onStep={(s) => setLane(s as WeekPlanStep)} steps={PLAN_STEPS} />
            </div>
            {/* Where you are, said ONCE, right above what you're deciding — the
                step number used to appear here in the stepper's read AND again at
                the rail's foot ("then step 3 of 4"), which is two anchors fighting
                to be the one you trust. */}
            <div className="mt-5 section-label" style={{ color: "var(--accent)" }}>
              Step {PLAN_STEPS.indexOf(lane) + 1} of {PLAN_STEPS.length}
            </div>
            <h2 className="mt-1 text-lead masthead leading-snug text-ink">{STEP_QUESTION[lane]}</h2>
            {/* …and what your part in it is. Naming the act belongs beside the
                question, not buried in whichever lane happens to render below. */}
            {lane !== "open" && <p className="mt-1.5 text-caption text-muted">{STEP_ASK[lane]}</p>}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3">
            {lane === "open" && (
              <OpenTimeLane shape={weekShape} roomFound={roomFound} />
            )}
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

          {/* The act — directly under the pool it acts on. It used to live in the
              opposite corner from the thing that said where you were, so nothing
              connected "here is the decision" to "here is how you move on". */}
          <div className="shrink-0 border-t border-line px-5 py-3">
            <WalkAction
              lane={lane}
              stepCount={PLAN_STEPS.length}
              applying={applying}
              onNext={setLane}
              onCommit={() => void commit()}
            />
          </div>
        </aside>

        {/* The week — never a step. It fills as you keep things in the rail, so
            "the week is full" arrives while you can still do something about it. */}
        <section className="flex min-w-0 flex-1 flex-col px-6 pb-3 pt-5">
            {gridDays.length === 0 ? (
              <div className="rounded-md border border-dashed border-line p-10 text-center text-caption text-muted">
                No working days set — choose them in Boundaries.
              </div>
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
                <div className="shrink-0">
                  {/* Step 1 has put nothing on the week yet, so a load meter here
                      measures the calendar you're already looking at — hours to
                      read, in answer to a question nobody asked yet. It appears
                      the moment your own work starts landing, which is when
                      "how full is this getting" becomes a live question. */}
                  {lane !== "open" && (
                    <div className="mt-3 border-t border-line pt-3">
                      <CapacityMeter
                        intake={intake}
                        fit={{ placed: shownPlacements.length, unplaced: shownUnplaced.length }}
                        revealed={revealed}
                        compact
                      />
                    </div>
                  )}

                  {shownUnplaced.length > 0 && (
                    <div className="max-h-[22vh] overflow-y-auto">
                      <UnplacedReport unplaced={shownUnplaced} onShowProjects={() => setLane("projects")} />
                    </div>
                  )}

                  {/* boundaries — settings, tucked away; here when you need them */}
                  <div className="mt-3">
                    <Boundaries
                      open={showBoundaries}
                      onToggle={() => setShowBoundaries((s) => !s)}
                      weekDays={weekDays}
                      fromGate={fromGate}
                      workingDays={workingDays}
                      setWorkingDays={setWorkingDays}
                    />
                  </div>
                </div>
              </>
            )}
        </section>
      </div>
    </Shell>
  );
}

// ── the overlay chrome ───────────────────────────────────────────────────────
function Shell({
  onClose,
  footer,
  children,
}: {
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="scrim atmosphere fixed inset-0 z-50 flex flex-col">
      {/* clears the macOS traffic lights + gives a drag handle — stays transparent
          so the one warm-paper canvas reads from the very top (no frost seam) */}
      <div data-tauri-drag-region className="h-8 w-full shrink-0" />
      <header className="flex shrink-0 items-center gap-4 border-b border-line px-5 py-2.5">
        {/* The week is named ONCE, by the rail's hero. This bar said it a second
            time and the rail's eyebrow a third — three labels for one date. */}
        <div className="wordmark text-head">Plan the week</div>
        <div className="flex-1" />
        <button onClick={onClose} className="keycap shrink-0">esc — resumes later</button>
      </header>
      {/* the two panes own their own scrolling — the rail and the week move
          independently, so neither one drags the other past its heading */}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {footer}
    </div>
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
    <div className="mt-4 border-t border-line pt-2.5">
      <div className="section-label mb-1" style={{ color: "var(--signal)" }}>
        No open time left{" "}
        <span className="mono normal-case tracking-normal text-muted">{unplaced.length}</span>
      </div>
      {/* Project work that found no time is a decision, not a leftover — the acts
          for it live on its row in the Projects step, one click away. */}
      {unplaced.some((u) => u.task.project_id) && (
        <p className="mb-1.5 text-caption text-muted">
          Project work is in here.{" "}
          <button onClick={onShowProjects} className="fast text-accent hover:brightness-110">
            Sort it on the Projects step →
          </button>
        </p>
      )}
      <div className="grid gap-x-8 md:grid-cols-2">
        {unplaced.map(({ task, reason }) => (
          <div key={task.id} className="flex items-center gap-3 border-b border-line py-1.5 text-caption text-muted">
            <span className="min-w-0 flex-1 truncate text-ink">{task.title}</span>
            <span className="mono shrink-0 text-meta">{reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Step 1 · the week as it already stands.
 *
 * The plan used to open with project blocks already scattered across the grid —
 * new information arriving before you had any frame to read it against. So the
 * first thing you see now is the *empty* week: the immovable calendar, and the
 * room between it drawn as open time. Everything after this is a visible change
 * to a picture you've already understood.
 *
 * **The rail says almost nothing here, on purpose.** It briefly listed all 46 of
 * the week's commitments, which is the calendar restated as a table — the same
 * information, worse, and overwhelming enough to bury the one number that matters.
 * The grid already shows every meeting in its own shape and place, so the act
 * lives *there*: click a meeting you aren't going to and its time turns into open
 * time under your cursor. (`hidden_events` — the same setting every availability
 * path in Nuvo already reads, never a plan-only fiction.)
 */
function OpenTimeLane({
  shape,
  roomFound,
}: {
  /** Per working day: how much of the window is committed vs open. */
  shape: { iso: string; busyMins: number; freeMins: number }[];
  roomFound: boolean;
}) {
  const windowMins = Math.max(1, ...shape.map((d) => d.busyMins + d.freeMins));
  return (
    <section>
      {/* ── the act, first and largest ────────────────────────────────────────
          Setting a meeting aside is the ONLY thing you can do on this step, and
          it lived here as a 12px grey footnote under a big hour count — the
          number you can't act on outranking the gesture that changes the week.
          So the gesture is now shown rather than described: the two states of a
          block, side by side, as they appear on the grid, and one short line. */}
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <SampleBlock kind="committed" />
        </div>
        <span aria-hidden className="shrink-0 text-caption text-muted">→</span>
        <div className="min-w-0 flex-1">
          <SampleBlock kind="open" />
        </div>
      </div>
      <p className="mt-2.5 text-body text-ink">Click anything you're not going to.</p>
      <p className="text-caption text-muted">{STEP_ASK.open}</p>

      {/* ── the week's shape, drawn ───────────────────────────────────────────
          Support, not headline: the same two materials as the grid, stacked per
          day, so "which days have room" is answered by looking. No hours — the
          question is a proportion, and a proportion is a picture. */}
      {/* items-stretch, not items-end: the columns must fill the height for their
          children's percentage heights to resolve against anything. */}
      <div className="mt-6 flex items-stretch gap-1.5" style={{ height: 108 }}>
        {shape.map((d) => {
          const total = d.busyMins + d.freeMins;
          const busyPct = total > 0 ? (d.busyMins / windowMins) * 100 : 0;
          const freePct = total > 0 ? (d.freeMins / windowMins) * 100 : 0;
          return (
            <div key={d.iso} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full flex-1 flex-col justify-end overflow-hidden rounded-[5px]">
                {roomFound && (
                  <div
                    className="gap-in w-full"
                    style={{ height: `${freePct}%`, background: OPEN_FILL }}
                    title="open"
                  />
                )}
                <div
                  className="w-full"
                  style={{
                    height: `${busyPct}%`,
                    background: BUSY_FILL,
                    transition: "height .32s var(--ease-out)",
                  }}
                  title="committed"
                />
              </div>
              <span className="mono text-micro text-muted">{format(parseDateISO(d.iso), "EEEEE")}</span>
            </div>
          );
        })}
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
      className="flex h-[34px] items-center gap-1.5 overflow-hidden rounded-[5px] px-1.5"
      style={
        committed
          ? { background: BUSY_FILL, borderLeft: "3px solid var(--line-strong)" }
          : { background: OPEN_FILL, border: `1px solid ${OPEN_EDGE}`, borderLeft: `2px solid ${OPEN_EDGE_STRONG}` }
      }
    >
      <span
        aria-hidden
        className="mono flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] text-micro leading-none"
        style={
          committed
            ? { background: "var(--line-strong)", color: "var(--surface)" }
            : { border: "1px dashed var(--slot)", color: "var(--slot)" }
        }
      >
        {committed ? "✓" : ""}
      </span>
      <span
        className="mono min-w-0 flex-1 truncate text-micro"
        style={committed ? { color: "var(--ink)" } : { color: "var(--slot)" }}
      >
        {committed ? "Meeting" : "open"}
      </span>
    </div>
  );
}

/** Slotting, once — the same act and the same read in both lanes that have it.
 *
 *  Carried work and raw captures are the same shape of problem (a scatter of
 *  small things with no home), and carried work was *already* grouped in the week
 *  it slipped out of — so re-grouping it is the natural move, not a special case.
 *  Both lanes therefore get one button and one confirmation list. Leftovers used
 *  to group silently: you pressed it, blocks appeared somewhere on the grid, and
 *  the lane never said what it had done. */
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
    <div className={first ? "" : "mt-4"}>
      <div className="section-label mb-1">
        Slots <span className="mono normal-case tracking-normal text-muted">{runs.length}</span>
      </div>
      <div className="border-t border-line">
        {runs.map((r) => {
          const isOpen = open === r.id;
          const members = r.taskIds
            .map((id) => data.tasks.find((t) => t.id === id))
            .filter((t): t is NonNullable<typeof t> => !!t);
          return (
            <div key={r.id} className="border-b border-line">
              {/* The grouping is a proposal. Open it and you can see what the AI
                  decided belongs together — which is the only way to catch a
                  capture themed "Frontier" that's actually SCE before it rides
                  onto the calendar under the wrong name. */}
              <button
                onClick={() => setOpen((cur) => (cur === r.id ? null : r.id))}
                className="fast flex w-full items-baseline gap-2 py-1.5 text-left"
                title="See what's in this block"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color ?? "var(--accent)" }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body">{r.name}</span>
                <span className="mono shrink-0 text-meta text-muted">
                  {r.taskIds.length} {unit}
                  {r.taskIds.length === 1 ? "" : "s"} {isOpen ? "▾" : "▸"}
                </span>
              </button>
              {isOpen && (
                <div className="pb-2 pl-4">
                  {members.map((t) => (
                    <div key={t.id} className="group flex items-baseline gap-2 py-1">
                      <span className="min-w-0 flex-1 truncate text-caption text-muted" title={t.title}>
                        {t.title}
                      </span>
                      <span className="mono shrink-0 text-meta text-muted">{t.durationMins}m</span>
                      {onRemove && (
                        <button
                          onClick={() => onRemove(r.id, t.id)}
                          title="Doesn't belong here — take it out of this block and place it on its own"
                          className="fast shrink-0 text-caption text-muted opacity-0 hover:text-signal group-hover:opacity-100"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The slotting button — identical in both lanes, so it reads as one act.
 *
 *  Once it HAS grouped, it stops shouting: a filled call-to-action offering to
 *  "Group 10 into blocks" above six blocks it already made is the screen arguing
 *  with itself. It becomes a quiet re-run instead. */
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
      <button
        onClick={onGroup}
        disabled={busy}
        title={grouped ? "Slot them again — a fresh read of what belongs together" : undefined}
        className={
          grouped
            ? "fast mono text-meta text-muted hover:text-accent disabled:opacity-50"
            : "tap fast flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-caption text-accent hover:brightness-105 disabled:opacity-50"
        }
        style={grouped ? undefined : { background: "var(--accent-soft)" }}
      >
        {busy ? "Slotting…" : grouped ? "↻ slot again" : label}
      </button>
      {error && <p className="mt-1.5 text-meta text-signal">{error}</p>}
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

  const pushes = useMemo(() => weekPushes(data, weekStartISO), [data, weekStartISO]);
  // Bringing a project in IS placing it on this week — the same kernel patch the
  // On Deck drop and the agent's create_priority apply, so they can't diverge.
  const bringIn = (p: Project) => {
    const patch = bringIntoWeekPatch(p, weekStartISO);
    if (patch) updateProject(p.id, patch);
  };
  const takeOff = (p: Project) => updateProject(p.id, takeOffWeekPatch());
  // Both remediations are span writes through the kernel — the same act as
  // dragging the project's card on On Deck, so the deck and the plan can't
  // disagree about where a project lives.
  const spanIt = (p: Project) => updateProject(p.id, spanAnotherWeekPatch(p, weekStartISO));
  const pushOut = (p: Project) => updateProject(p.id, pushToNextWeekPatch(p, weekStartISO));

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
    <section>
      {pushes.length === 0 && (
        <p className="pb-3 text-caption text-muted">Nothing on this week yet — bring a project in below.</p>
      )}

      <div className="border-t border-line">
        {pushes.map(({ project }) => (
          <ProjectRow
            key={project.id}
            project={project}
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
        <div className="mt-4">
          <div className="section-label mb-1">Project work with no week set</div>
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
 * `--signal` = you kept it and the week had nowhere to put it, faint = you took
 * it off.
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
          className="h-[14px] w-[5px] rounded-[1.5px]"
          style={
            m.state === "placed"
              ? { background: color }
              : m.state === "homeless"
                ? { border: "1px solid var(--signal)", background: "var(--signal-soft)" }
                : { background: "var(--line)" }
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

  return (
    <div className="group border-b border-line">
      <div className="flex items-center gap-2.5 py-2">
        <button
          onClick={onToggleOpen}
          disabled={rows.length === 0}
          title={project.outcome?.trim() || "no outcome yet"}
          aria-expanded={open}
          className="fast flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={ready ? { background: color } : { border: "1.5px solid var(--line-strong)" }}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-body text-ink">{project.name}</span>
        </button>

        {/* What happened to it — one mark per piece, so "did this land?" is
            answered on the row instead of being hunted for on the grid. It used
            to read "4/4 · 3.5h", which counts what you *kept* and says nothing
            about what the week could actually take. */}
        {!ready ? (
          <span className="mono shrink-0 text-meta" style={{ color: "var(--signal)" }}>
            {gaps.map((g) => g.label).join(" · ")}
          </span>
        ) : rows.length === 0 ? (
          <span className="mono shrink-0 text-meta text-muted">no open work</span>
        ) : (
          <FitStrip rows={rows} kept={kept} placedIds={placedIds} color={color} />
        )}

        <button
          onClick={onOpenRecord}
          title={`Open ${project.name}`}
          className="fast mono shrink-0 text-micro text-muted opacity-0 hover:text-accent group-hover:opacity-100"
        >
          open
        </button>
        <button
          onClick={onRemove}
          title="Take it off this week"
          className="fast shrink-0 text-caption text-muted opacity-0 hover:text-signal group-hover:opacity-100"
        >
          ×
        </button>
      </div>

      {/* The week couldn't take all of it — said here, while you're still
          choosing, with the two acts that actually resolve it. A project is not a
          line item you shrug at: it's the thing that moves the needle, so "no
          room" without a remedy is the app leaving you stuck. */}
      {fit && fit.unplaced > 0 && (
        <div className="mb-2 rounded-md px-2.5 py-2" style={{ background: "var(--signal-soft)" }}>
          <div className="text-caption" style={{ color: "var(--signal)" }}>
            {fit.placed > 0
              ? `Only ${fit.placed} of ${fit.placed + fit.unplaced} pieces fit this week.`
              : `None of its ${fit.unplaced} pieces fit this week.`}
          </div>
          {/* …and WHY, in the composer's own words. "No room" beside a calendar
              with ten open hours reads as a lie unless it says what the room was
              missing — length, order, or a deadline. */}
          {fit.reason && <div className="mt-0.5 text-meta text-muted">{fit.reason}</div>}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {fit.placed > 0 && (
              <button
                onClick={onSpan}
                title="Give it another week — same project, longer run. This week takes what fits; the rest continues next week."
                className="tap fast rounded-md border border-line px-2.5 py-1 text-caption text-ink hover:border-line-strong hover:bg-surface-2"
              >
                Give it another week
              </button>
            )}
            <button
              onClick={onPushOut}
              title="Move the whole project to next week, keeping how long it runs."
              className="tap fast rounded-md border border-line px-2.5 py-1 text-caption text-muted hover:border-line-strong hover:bg-surface-2"
            >
              Move it to next week
            </button>
          </div>
        </div>
      )}

      {open && rows.length > 0 && (
        <div className="pb-2 pl-4">
          <button
            onClick={() => {
              const next = new Set(kept);
              rows.forEach((r) => (allOn ? next.delete(r.task.id) : next.add(r.task.id)));
              setKept(next);
            }}
            className="fast mono mb-1 text-micro text-muted hover:text-accent"
          >
            {allOn ? "none" : "all"}
          </button>
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
    <div className="space-y-0.5">
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
    <button
      key={p.id}
      onClick={() => onBringIn(p)}
      title={`Move "${p.name}" to this week — ${reason}`}
      className="tap fast flex max-w-full items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-label hover:border-line-strong hover:bg-surface-2"
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: domainById(data, p.domainId)?.color ?? "var(--accent)" }}
        aria-hidden
      />
      <span className="min-w-0 truncate text-ink">{p.name}</span>
    </button>
  );

  // Adding a project is the exception, not the task — most weeks you're deciding
  // about what's already on the slate. So it's a single quiet line until you want
  // it, instead of a wall of chips competing with the projects you're reading.
  const total = needsWeek.length + elsewhere.length;
  return (
    <div className="mt-5">
      <button
        onClick={() => setShowAll((v) => !v)}
        className="fast mono text-meta text-muted hover:text-accent"
      >
        {showAll ? "− bring one in" : `＋ bring one in (${total})`}
      </button>
      {showAll && (
        <div className="mt-2 flex flex-wrap gap-1.5">
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
 * provenance, not kind. Worse, each step slotted its own pool, so a "Frontier"
 * leftover and a "Frontier" capture came back as two different slots because the
 * AI never saw them together. One step, one pool, one slotting pass.
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
      <div className="mb-4">
        <div className="section-label mb-1">
          {label}{" "}
          <span className="mono normal-case tracking-normal" style={{ color: tone ?? "var(--muted)" }}>
            {rows.length}
          </span>
        </div>
        <div className="space-y-0.5">{rows.map(row)}</div>
      </div>
    );

  return (
    <section>
      {/* The slots come first: they're the proposal you're here to agree with. */}
      {slotting && runs.length === 0 ? (
        <p className="text-caption text-muted">Slotting…</p>
      ) : (
        <GroupedRuns runs={runs} unit="piece" first data={data} onRemove={onRemoveFromRun} />
      )}
      {runs.length > 0 && (
        <div className="mt-2">
          <GroupButton label="✦ Slot them" busy={slotting} error={slotErr} grouped onGroup={onSlot} />
        </div>
      )}

      <div className={runs.length > 0 ? "mt-5 border-t border-line pt-4" : ""}>
        {group("Carried over", rolled, "var(--signal)")}
        {group("Due, or going quiet", rest)}
        {group("New captures", captures)}
        {carried.length === 0 && captures.length === 0 && (
          <p className="py-1 text-caption text-muted">
            {inboxCount > 0 ? `${inboxCount} in the inbox — none of it needs this week.` : "Nothing owed, nothing new."}
          </p>
        )}
      </div>

      <button
        onClick={() => setShowMore((m) => !m)}
        className="fast mono mt-3 text-meta text-muted hover:text-accent"
      >
        {showMore ? "hide" : "＋ add more"}
      </button>

      {showMore && (
        <div className="mt-1.5 border-t border-line pt-2">
          <div className="section-label mb-1">Inbox &amp; backlog ({more.length})</div>
          {more.length === 0 && <div className="px-2 py-3 text-center text-label text-muted">Nothing else waiting.</div>}
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
      )}
    </section>
  );
}

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
    <button
      onClick={onToggle}
      title={reason}
      className="tap fast flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left"
      style={{ background: on ? "var(--accent-soft)" : "transparent" }}
    >
      <span
        className="mono flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-micro"
        style={{
          background: on ? "var(--accent)" : "transparent",
          border: on ? "none" : "1px solid var(--line)",
          color: on ? "#fff" : "var(--muted)",
        }}
      >
        {on ? "✓" : ""}
      </span>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color ?? "var(--line)" }} />
      <span className="min-w-0 flex-1 truncate text-body" style={{ opacity: on ? 1 : 0.62 }}>
        {title}
      </span>
      {/* two glyphs where a clause used to be — the clause survives as the title */}
      {badge && (
        <span
          className="mono shrink-0 rounded-full px-1.5 text-meta"
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
        value={mins}
        onChange={onMins}
        className="shrink-0 rounded px-1 py-0.5 hover:bg-surface-2"
        title="Sitting length"
      />
    </button>
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

  const setWork = (key: "work_start_minutes" | "work_end_minutes") => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    const [h, mm] = e.target.value.split(":").map(Number);
    updateSettings({ [key]: h * 60 + mm });
  };
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
    <section className="border-t border-line pt-3">
      <button onClick={onToggle} className="fast flex w-full items-center justify-between text-left">
        <span className="section-label">Boundaries</span>
        <span className="mono flex items-center gap-1.5 text-caption text-muted">
          {workingLabel} · {toMinLabel(workStart)}–{toMinLabel(workEnd)}
          {/* the affordance is the glyph, not a sentence telling you to click */}
          <span aria-hidden className="fast text-meta" style={{ transform: open ? "rotate(180deg)" : undefined }}>
            ▾
          </span>
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {/* working days — the recurring boundary; weekends off by default */}
          <div className="flex items-center gap-1.5">
            <span className="mono w-[92px] shrink-0 text-caption text-muted">working days</span>
            {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
              const on = workingDays.includes(dow);
              return (
                <button
                  key={dow}
                  onClick={() => toggleWorkingDay(dow)}
                  title={`${on ? "A working day" : "Off"} — click to toggle`}
                  className="tap fast mono h-9 w-10 rounded-md border text-caption"
                  style={{
                    borderColor: on ? "var(--accent)" : "var(--line)",
                    color: on ? "var(--accent)" : "var(--muted)",
                    background: on ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  {DAY_GLYPH[dow]}
                </button>
              );
            })}
            <span className="mono ml-1 text-meta text-muted">— a setting, applies every week</span>
          </div>

          <label className="mono flex items-center gap-2 text-caption text-muted">
            <span className="w-[92px] shrink-0">working hours</span>
            <input type="time" step={900} value={toMinLabel(workStart)} onChange={setWork("work_start_minutes")}
              className="tap h-9 rounded-md border border-line bg-bg px-2.5 text-caption outline-none focus:border-accent" />
            <span>–</span>
            <input type="time" step={900} value={toMinLabel(workEnd)} onChange={setWork("work_end_minutes")}
              className="tap h-9 rounded-md border border-line bg-bg px-2.5 text-caption outline-none focus:border-accent" />
          </label>

          {workingISOs.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="mono w-[92px] shrink-0 text-caption text-muted">this week</span>
              {workingISOs.map((iso) => {
                const ctx = dayContexts[iso] ?? "normal";
                const past = iso < fromGate;
                const meta = CONTEXT_META[ctx];
                return (
                  <button
                    key={iso}
                    disabled={past}
                    onClick={() => cycleContext(iso)}
                    title={`${format(parseDateISO(iso), "EEEE")} — ${meta.label} (click to change)`}
                    className="tap fast mono h-9 flex-1 rounded-md border px-1 text-caption disabled:opacity-25"
                    style={{
                      borderColor: ctx === "normal" ? "var(--line)" : "var(--accent)",
                      color: ctx === "normal" ? "var(--muted)" : "var(--accent)",
                      background: ctx === "normal" ? "transparent" : "var(--accent-soft)",
                    }}
                  >
                    {format(parseDateISO(iso), "EEEEE")} {meta.glyph}
                  </button>
                );
              })}
              <span className="mono hidden text-meta text-muted xl:inline">· normal ◐ light ✈ travel — off</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── the act — the walk's one forward move, at the foot of the rail ──────────
//
// One primary control, in one place, doing one thing: pour the next source into
// the week. It sits under the pool because that is the column the decision lives
// in — the old bottom bar put it diagonally opposite the step indicator, so the
// screen had a "where am I" corner and a "how do I move on" corner and nothing
// tying them together.
//
// The label names the **act**, not the destination. "Projects →" told you where
// you'd land and nothing about what pressing it does; each press actually adds a
// source, and the grid animating is that sentence finishing.
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
  /**
   * The button **completes the step you're on**, in your own voice — it doesn't
   * describe the next one.
   *
   * It used to say "Add your projects" on the open-time step, which named what
   * the *next* screen does. But standing on step 1 you aren't adding projects,
   * you're agreeing that this is the room the week really has; a button that
   * narrates somewhere else gives you nothing to decide against. Where you'll
   * land is a quiet line beneath — a name, not a step number, because the
   * stepper already owns the counting.
   */
  const DONE_ACT: Record<WeekPlanStep, string> = {
    open: "That's my open time",
    projects: "That's what I'm moving",
    rest: "",
  };
  return (
    <div>
      <Btn
        kind="primary"
        onClick={last ? onCommit : () => onNext(PLAN_STEPS[step + 1])}
        disabled={applying}
        className="w-full justify-center px-4 py-2.5"
      >
        {last ? (applying ? "committing…" : "Commit the week →") : `${DONE_ACT[lane]} →`}
      </Btn>
      {!last && (
        <div className="mono mt-1.5 text-center text-meta text-muted">
          next · {STEP_LABEL[PLAN_STEPS[step + 1]]}
        </div>
      )}
    </div>
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
  const minAt = (clientY: number, colTop: number) => lo + ((clientY - colTop) / HOUR_PX) * 60;
  const colTopOf = (iso: string) => {
    const el = colRefs.current.get(iso);
    return el ? el.getBoundingClientRect().top : 0;
  };

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === "move") {
        let targetISO = d.dayISO;
        for (const [iso, el] of colRefs.current) {
          const r = el.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX < r.right) { targetISO = iso; break; }
        }
        let start = snap(minAt(e.clientY, colTopOf(targetISO)) - d.grabOffsetMin);
        start = Math.max(lo, Math.min(hi - d.durationMin, start));
        if (targetISO !== d.dayISO || start !== d.startMin) d.moved = true;
        d.dayISO = targetISO;
        d.startMin = start;
      } else {
        let end = snap(minAt(e.clientY, colTopOf(d.dayISO)));
        end = Math.max(d.startMin + 15, Math.min(hi, end));
        if (end - d.startMin !== d.durationMin) d.moved = true;
        d.durationMin = end - d.startMin;
      }
      bump();
    };
    const onPointerUp = () => {
      const d = dragRef.current;
      if (!d) return;
      // a press that never moved is a click — open the sitting instead of
      // committing a no-op placement override
      if (!d.moved) setInspect((cur) => (cur === d.id ? null : d.id));
      else if (d.mode === "move") onMove(d.id, d.dayISO, d.startMin);
      else onResize(d.id, d.durationMin);
      dragRef.current = null;
      bump();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [lo, hi, onMove, onResize]);

  const startDrag = (e: React.PointerEvent, it: GridItem, dayISO: string, mode: "move" | "resize") => {
    e.preventDefault();
    if (mode === "resize") e.stopPropagation();
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
    // Fills whatever height the pane gives it. This used to be capped at 62vh —
    // a number that ignored the actual window, so on a tall screen the week
    // stopped two-thirds of the way down with empty pane beneath it, and you
    // scrolled a small box instead of seeing your days.
    <div ref={paneRef} className="h-full overflow-auto rounded-lg border border-line">
      {/* day headers — sticky frosted glass so they stay legible over the scroll,
          without painting an opaque seam over the warm-paper canvas */}
      <div
        className="sticky top-0 z-10 flex border-b border-line"
        style={{ background: "color-mix(in srgb, var(--surface) 72%, transparent)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
      >
        <div className="w-[52px] shrink-0" />
        {days.map((d) => {
          const ctx = dayContexts[d.iso] ?? "normal";
          return (
            <div key={d.iso} className="min-w-[150px] flex-1 border-l border-line px-2 py-2 text-center" style={{ opacity: d.past ? 0.4 : 1 }}>
              <div className="text-caption font-semibold">{format(parseDateISO(d.iso), "EEE")}</div>
              <div className="mono text-micro text-muted">
                {format(parseDateISO(d.iso), "MMM d")}
                {ctx !== "normal" && <span className="ml-1 text-accent">{CONTEXT_META[ctx].label}</span>}
                {d.past && " · passed"}
              </div>
            </div>
          );
        })}
      </div>

      {/* the time canvas */}
      <div className="flex" style={{ height: totalH }}>
        <div className="w-[52px] shrink-0">
          {hours.map((h) => (
            <div key={h} className="relative" style={{ height: hourPx }}>
              <span className="mono absolute -top-1.5 right-1.5 text-meta text-muted">{formatHourLabel(Math.floor(h / 60))}</span>
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
              className="relative min-w-[150px] flex-1 border-l border-line"
              style={{
                opacity: d.past ? 0.5 : 1,
                background: drag?.mode === "move" && drag.dayISO === d.iso ? "color-mix(in srgb, var(--accent) 7%, transparent)" : undefined,
              }}
            >
              {hours.map((h, i) =>
                i === 0 ? null : <div key={h} className="absolute inset-x-0" style={{ top: yOf(h), borderTop: "1px solid var(--line)", opacity: 0.5 }} />,
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
                      top: yOf(gs), height: h,
                      // Open time carries its own material now. Drawing it as pure
                      // absence — one hairline bracket on an empty column — meant
                      // the eye had to *find* the room by looking for where the
                      // grey stopped. It reads as a colour block against neutral
                      // meetings instead, so scanning the week for teal answers
                      // "where is my room" without reading anything.
                      background: OPEN_FILL,
                      // longhand on every side — mixing `border` with `borderLeft`
                      // makes React drop one of them on a re-render
                      borderTop: `1px solid ${OPEN_EDGE}`,
                      borderRight: `1px solid ${OPEN_EDGE}`,
                      borderBottom: `1px solid ${OPEN_EDGE}`,
                      borderLeft: `2px solid ${OPEN_EDGE_STRONG}`,
                      animationDelay: `${Math.min(320, gi * 40)}ms`,
                    }}
                    // the hours survive on hover — they were never worth the ink
                    // they took on the face of the week
                    title={`${fmtMinShort(gs)}–${fmtMinShort(ge)} open · ${hrs(g.mins)}h`}
                  />
                );
              })}
              {items.map((it, idx) => {
                const top = yOf(it.startMin);
                const height = Math.max(MIN_BLOCK_PX, yOf(it.endMin) - yOf(it.startMin));
                if (it.kind === "event") {
                  // immovable external commitments — a quiet neutral frost, no
                  // identity. On step 1 they're the one thing you CAN change: set
                  // one aside and its time becomes open, right where you're looking.
                  const canToggle = !!it.event && !!onToggleEvent;
                  const aside = !!it.aside;
                  return (
                    <div
                      key={`ev-${it.id}`}
                      data-block
                      onPointerDown={canToggle ? (e) => e.stopPropagation() : undefined}
                      onClick={canToggle ? () => onToggleEvent!(it.event!) : undefined}
                      className={`group/ev absolute overflow-hidden rounded-[5px] py-0.5 ${aside ? "pl-1" : "px-1.5"} ${canToggle ? "fast cursor-pointer" : ""}`}
                      style={{
                        top, height, ...laneStyle(lanes.get(it.id)),
                        // These are the immovable facts you arrived with — they
                        // have to be readable BEFORE anything of yours is on the
                        // week, or step 1 shows you a calendar you can't read.
                        // A meeting is a FACT you arrived with, so it is drawn like
                        // one: solid, with a real edge. It used to sit at 5–9% ink
                        // — the same weight as the open time beside it — which is
                        // why the week was hard to read before anything was on it.
                        // A set-aside meeting is standing ON open time — the gap
                        // beneath it is already painted, so it adds no fill of its
                        // own; it's the struck name left on the room it gave back.
                        background: aside
                          ? "transparent"
                          : canToggle
                            ? BUSY_FILL
                            : "color-mix(in srgb, var(--ink) 8%, transparent)",
                        borderLeft: aside ? undefined : "3px solid var(--line-strong)",
                        opacity: aside ? 0.85 : 1,
                        backdropFilter: aside ? undefined : "blur(4px)",
                        WebkitBackdropFilter: aside ? undefined : "blur(4px)",
                      }}
                      title={
                        !canToggle
                          ? it.title
                          : aside
                            ? `${it.title} — set aside, its time counts as open. Click to put it back.`
                            : `${it.title} — not going? Click to set it aside and free the time.`
                      }
                    >
                      <div className="flex items-baseline gap-1">
                        {/* The toggle state, said with a mark rather than left to
                            be inferred from a strikethrough: ✓ counts against your
                            week, ○ has been set aside and its time is open. */}
                        {canToggle && height >= 16 && (
                          <span
                            aria-hidden
                            className="mono flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] text-micro leading-none"
                            style={
                              aside
                                ? { border: "1px dashed var(--slot)", color: "var(--slot)" }
                                : { background: "var(--line-strong)", color: "var(--surface)" }
                            }
                          >
                            {aside ? "" : "✓"}
                          </span>
                        )}
                        <span
                          className="mono min-w-0 flex-1 truncate text-meta leading-tight"
                          style={
                            aside
                              ? { textDecoration: "line-through", color: "var(--muted)" }
                              : { color: "var(--ink)", opacity: canToggle ? 1 : 0.62 }
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
                // Tinted glass: the domain hue read through, with its color as the
                // left identity edge and ink text — never a solid white-on-color slab.
                // Placed-for-you (new) reads as Nuvo's intent: a touch stronger + lift.
                const holds = it.holds ?? 0;
                const open = inspect === it.id;
                // what this block IS, in words — used as an eyebrow when there's
                // a line for it, and inlined before the title when there isn't
                const kindLabel =
                  holds > 0
                    ? it.slotPart
                      ? `Project · part ${it.slotPart.part} of ${it.slotPart.parts}`
                      : `${isProject ? "Project" : "Slot"} · ${holds} ${isProject ? "task" : "capture"}${holds === 1 ? "" : "s"}`
                    : isProject
                      ? it.project
                      : // a single loose piece of work — say so, so every block Nuvo
                        // placed names its kind and the week reads as one vocabulary
                        isNew
                        ? "Task"
                        : null;
                // 44px = one hour. A 45-minute sitting is 33px: room for a
                // designation and a title, not for a time it can read off the axis.
                const showEyebrow = blkHeight >= 30 && !!kindLabel;
                const showMeta = blkHeight >= 46;
                const inlineKind = !showEyebrow && !!kindLabel;
                return (
                  <div
                    key={`${it.kind}-${it.id}`}
                    data-block
                    onPointerDown={draggable ? (e) => startDrag(e, it, d.iso, "move") : undefined}
                    className={`group lift-anim absolute overflow-hidden rounded-[6px] px-1.5 py-1 ${draggable ? "cursor-grab" : ""} ${isNew ? "block-in" : ""}`}
                    style={{
                      top: blkTop, height: blkHeight, ...laneStyle(lanes.get(it.id)),
                      color: "var(--ink)",
                      background: `color-mix(in srgb, ${hue} ${isProject ? 26 : isNew ? 22 : isSlot ? 18 : 13}%, transparent)`,
                      borderLeft: `${isProject ? 4 : 3}px solid ${hue}`,
                      borderTop: moveSource ? "1px dashed var(--line-strong)" : undefined,
                      opacity: moveSource ? 0.3 : isNew || isSlot ? 1 : 0.85,
                      backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
                      // a project slot lifts a touch more — a real push, not errand
                      // time; an opened sitting lifts further still
                      boxShadow: !isNew || moveSource ? "none" : isProject ? `var(--shadow-lift), inset 3px 0 0 color-mix(in srgb, ${hue} ${open ? 70 : 45}%, transparent)` : "var(--shadow-lift)",
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
                    {/* What KIND of block this is, said in words — PROJECT · 3
                        TASKS, SLOT · 3 CAPTURES, TASK — at every size a block can
                        be. A "▸" asked you to learn a glyph first. A block sheds
                        the least recoverable thing last: the designation outlives
                        the title, and the time goes first, because the grid axis
                        already says when. */}
                    {isNew && showEyebrow && kindLabel && (
                      <div
                        className="truncate text-micro font-semibold uppercase leading-none"
                        style={{ color: hue, letterSpacing: "0.06em" }}
                        title={it.project ?? undefined}
                      >
                        {kindLabel}
                      </div>
                    )}
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1 truncate text-caption font-semibold leading-tight">
                        {inlineKind && (
                          <span className="text-micro uppercase" style={{ color: hue, letterSpacing: "0.06em" }}>
                            {isProject ? "Project" : holds > 0 ? "Slot" : "Task"}{" · "}
                          </span>
                        )}
                        {isSlot ? `⛶ ${it.title}` : isProject ? `▸ ${it.title}` : isNew ? `✦ ${it.title}` : it.title}
                      </div>
                      {isNew ? (
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => onDrop(it.taskId ?? it.id)}
                          className="fast shrink-0 text-caption leading-none text-muted opacity-0 hover:text-signal group-hover:opacity-100"
                          title={isSplit ? "Remove the whole overdue task from the week" : "Remove from the week"}
                        >
                          ×
                        </button>
                      ) : isSlot ? null : (
                        <span className="shrink-0 text-micro leading-none text-muted">✓</span>
                      )}
                    </div>
                    {(showMeta || !isNew) && blkHeight > 30 && (
                      <div className="mono truncate text-meta leading-tight text-muted">
                        {fmtMinShort(it.startMin)}–{fmtMinShort(endMin)}
                        {holds > 0 && (
                          <span style={{ color: open ? hue : undefined }}>
                            {" · "}{holds} task{holds === 1 ? "" : "s"}
                          </span>
                        )}
                        {isSplit && <span className="text-signal"> · sitting {it.split!.part}/{it.split!.parts}</span>}
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
                const tall = held.length * 22 + 44;
                const flip = below + tall > totalH;
                return (
                  <div
                    key={`peek-${it.id}`}
                    data-peek
                    onPointerDown={(e) => e.stopPropagation()}
                    className="glass-card pop-in absolute inset-x-1 z-30 rounded-md border p-2"
                    style={{ [flip ? "bottom" : "top"]: flip ? totalH - yOf(it.startMin) + 4 : below, borderColor: hue }}
                  >
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="section-label min-w-0 flex-1 truncate" style={{ color: hue }}>
                        {it.title}
                      </span>
                      <button
                        onClick={() => setInspect(null)}
                        className="fast shrink-0 text-caption leading-none text-muted hover:text-ink"
                        title="Close"
                      >
                        ×
                      </button>
                    </div>
                    {held.map((t) => (
                      <div key={t.id} className="flex items-baseline gap-2 border-t border-line py-1">
                        <span className="min-w-0 flex-1 truncate text-caption" title={t.title}>{t.title}</span>
                        <span className="mono shrink-0 text-meta text-muted">{t.durationMins}m</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {drag?.mode === "move" && drag.dayISO === d.iso && (
                <div
                  className="glass-grab pointer-events-none absolute overflow-hidden rounded-[6px] px-1.5 py-1"
                  style={{
                    ...laneStyle(lanes.get("__ghost")),
                    top: yOf(drag.startMin),
                    height: Math.max(MIN_BLOCK_PX, yOf(drag.startMin + drag.durationMin) - yOf(drag.startMin)),
                    color: "var(--ink)",
                    background: `color-mix(in srgb, ${drag.hue} 26%, transparent)`,
                    borderLeft: `3px solid ${drag.hue}`,
                    zIndex: 30,
                  }}
                >
                  <div className="truncate text-meta font-semibold leading-tight">✦ {drag.title}</div>
                  <div className="mono text-micro text-muted">{fmtMinShort(drag.startMin)}–{fmtMinShort(drag.startMin + drag.durationMin)}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── the close ────────────────────────────────────────────────────────────────
function DoneState({ onClose }: { onClose: () => void }) {
  const { data } = useVertical();
  const committed = sprintTasks(data).filter((t) => t.status !== "done");
  const totalMins = committed.reduce((s, t) => s + t.durationMins, 0);
  const split = sprintMinsByDomain(data);

  const totalSplit = Math.max(1, split.reduce((s, y) => s + y.mins, 0));

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      {/* the arrival — the one place in the flow that gets ceremony, because it's
          the one moment that's actually a moment */}
      <div className="moment max-w-[460px] text-center">
        <div className="mono mb-2 text-micro uppercase tracking-wide" style={{ color: "var(--accent)" }}>{sprintLabel()}</div>
        <div className="text-display masthead">Your week is set.</div>
        {data.sprintGoal && <div className="mt-2 text-head text-muted">“{data.sprintGoal}”</div>}
        <div className="mono mt-3 text-label text-muted">
          {hrs(totalMins)}h committed · {committed.length} tasks · {split.length} domain{split.length === 1 ? "" : "s"}
        </div>
        {split.length > 0 && (
          <>
            {/* the week you just built, by world — each band grows into place */}
            <div className="mx-auto mt-4 flex h-2 max-w-[300px] overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
              {split.map((x, i) => (
                <div
                  key={x.domain.id}
                  title={`${x.domain.name} · ${hrs(x.mins)}h`}
                  className="block-in"
                  style={{
                    width: `${(x.mins / totalSplit) * 100}%`,
                    background: x.domain.color,
                    animationDelay: `${120 + i * 90}ms`,
                  }}
                />
              ))}
            </div>
            <div className="mono mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-micro text-muted">
              {split.map((x) => (
                <span key={x.domain.id} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: x.domain.color }} aria-hidden />
                  {x.domain.name} {hrs(x.mins)}h
                </span>
              ))}
            </div>
          </>
        )}
        <div className="mt-6">
          <Btn kind="primary" onClick={onClose}>Begin the week</Btn>
        </div>
      </div>
    </div>
  );
}

