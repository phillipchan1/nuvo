// Plan the week — the weekly ritual, reduced to its one honest job: arrive to a
// week that's already been pulled and time-blocked, then tune and commit. The
// old five gated steps are gone. What you do is a draft, not a form:
//
//   · the pull + the compose run the moment it opens (no "compose" button)
//   · every block still carries its reason — you keep the map, never lost
//   · one gesture overrides anything — drop a block, add a candidate, flag an initiative
//   · the only required click is Commit
//
// Defaults are pre-decided, settings live in Settings (working hours tuck away),
// intelligence does the deciding-where. You stay at altitude.

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, format, subDays } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useSettings } from "../../hooks/useSettings";
import { placementKey, useWeekDraft } from "../../hooks/useWeekDraft";
import {
  backlogTasks,
  domainById,
  inboxTasks,
  initiativeProgress,
  initiativeProgressAt,
  isOpenStatus,
  projectById,
  sprintMinsByDomain,
  sprintTasks,
  taskDomainColor,
  type Initiative,
  type VerticalData,
} from "../../lib/vertical";
import { endOf, fmtHours as hrs, formatHourLabel, parseDateISO } from "../../lib/dates";
import { sprintLabel } from "../../lib/sprint";
import { CONTEXT_META, plannedMinutes, type DayContext, type Placement } from "../../lib/compose";
import { type Batch } from "../../lib/batch";
import DurationSelect from "../DurationSelect";
import { type calibrate, type confidence } from "../../lib/calibration";
import { type PullSuggestion } from "../../lib/pull";
import { MomentumChip } from "../floors/parts";
import { BigRocks } from "../floors/bigRocks";
import { weekPushes } from "../../lib/priorities";
import { LANE_QUESTION, workBadge } from "../../lib/intake";
import WeekIntakeBar, { type WeekStep } from "./WeekIntake";
import type { WeekIntakeRead } from "../../lib/intake";
import type { ExternalEvent, Slot, Task } from "../../lib/types";
import { Btn } from "../ui";

const CONTEXT_CYCLE: DayContext[] = ["normal", "light", "travel", "off"];
const DAY_GLYPH = ["S", "M", "T", "W", "T", "F", "S"]; // Sun…Sat, for working-day chips
const HOUR_PX = 44;
const MIN_BLOCK_PX = 18;
const toMinLabel = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fmtMinShort = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "p" : "a", hh = ((h + 11) % 12) + 1;
  return mm === 0 ? `${hh}${ap}` : `${hh}:${String(mm).padStart(2, "0")}${ap}`;
};

// Four steps, the same four the phone runs: **Projects · Leftovers · Inbox → The
// week.** They are named after what they hold, not after invented verbs ("Slate",
// "Pull", "Shape" appeared nowhere else in the product), and the header
// (`WeekIntakeBar`) draws all four as one funnel with a live capacity read.
//
// **They are steps, not gates** — which is the distinction the old five-step wizard
// got wrong. Every lane is one click away at any time (including backwards from the
// grid), the week is fully composed the moment this opens, and the capacity track
// gives the same live "can I carry this?" read on every step. That last part is what
// pays for splitting the sources off the grid: you no longer need them side by side
// to see the consequence of keeping something, because the track shows it.

export default function SundayRitual({ onClose }: { onClose: () => void }) {
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
    kept,
    setKept,
    keptCount,
    dropBlock,
    routedCount,
    slotById,
    runs,
    visibleEvents,
    weekSlots,
    onCalBlocks,
    result,
    placements,
    movePlacement,
    resizePlacement,
    plannedMins,
    cal,
    conf,
    gain,
    inboxCount,
    themeInbox,
    theming,
    themeErr,
    themeCarried,
    themingCarried,
    carriedErr,
    goal,
    setGoal,
    commit,
    applying,
    committed,
  } = draft;

  // one piece of state for the step and the header's active lane — the lane IS the
  // position, so the two can never disagree.
  const [step, setStep] = useState<WeekStep>("projects");
  const [visited, setVisited] = useState<Set<WeekStep>>(new Set(["projects"]));
  const [showBoundaries, setShowBoundaries] = useState(false);
  const go = (s: WeekStep) => {
    setStep(s);
    setVisited((v) => new Set([...v, s]));
  };

  const placedCount = placements.length;
  const weekSpan = `${format(parseDateISO(weekStartISO), "MMM d")}–${format(addDays(parseDateISO(weekStartISO), 6), "MMM d")}`;
  const weekProjectCount = weekPushes(data, weekStartISO).length;

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
      <Shell onClose={onClose} weekLabel={format(parseDateISO(weekStartISO), "MMM d")} planningAhead={planningAhead}>
        <DoneState onClose={onClose} />
      </Shell>
    );
  }

  const eventCount = visibleEvents.filter((e) => e.busy && !e.all_day).length;

  return (
    <Shell
      onClose={onClose}
      weekLabel={format(parseDateISO(weekStartISO), "MMM d")}
      planningAhead={planningAhead}
      intake={
        <WeekIntakeBar intake={intake} step={step} onStep={go} visited={visited} waitingInbox={inboxCount} />
      }
      footer={
        step !== "week" ? (
          <ForwardBar
            step={step}
            projectCount={weekProjectCount}
            leadCount={data.focusInitiativeIds.length}
            intake={intake}
            waitingInbox={inboxCount}
            onNext={() => go(step === "projects" ? "loose" : step === "loose" ? "inbox" : "week")}
          />
        ) : (
          <CommitBar
            goal={goal}
            setGoal={setGoal}
            lastGoal={data.sprintGoal ?? ""}
            conf={conf}
            cal={cal}
            plannedMins={plannedMins}
            keptCount={keptCount}
            applying={applying}
            onCommit={() => void commit()}
          />
        )
      }
    >
      {step === "projects" && (
        <div className="mx-auto max-w-[1080px]">
          {/* ── 1 · the projects — open with the look-back, then what moves ────── */}
          {/* hero: ceremony + the gain folded in as the supporting read, not a stray line */}
          <header className="mb-8">
            <div className="section-label"><span style={{ color: "var(--accent)" }}>{sprintLabel(weekStartISO)}</span> · {weekSpan} · {planningAhead ? "the week ahead" : "this week"}</div>
            <h1 className="mt-1.5 text-display masthead leading-[1.05]">
              Week of {format(parseDateISO(weekStartISO), "MMMM d")}
            </h1>
            <p className="mt-2.5 text-body text-muted">
              Last 7 days — <span className="text-ink">{gain.doneCount} done · {hrs(gain.doneMins)}h</span>.
              {gain.topMove && (
                <span style={{ color: "var(--accent)" }}> {gain.topMove.name} climbed {gain.topMove.from}→{gain.topMove.to}%.</span>
              )}
              {gain.quiet.length > 0 && (
                <span style={{ color: "var(--signal)" }}> {gain.quiet.join(" & ")} went quiet.</span>
              )}
            </p>
          </header>

          {/* the initiatives — the strategic backdrop; a quiet check above the week's intent */}
          <BetsStrip />

          {/* the projects — the heart: name what would make this week a win */}
          <div className="mt-8"><BigRocks weekStartISO={weekStartISO} /></div>

          {/* …and the work that moves them. Naming a project has to bring its work
              with it, or step 4 has nothing to place. */}
          <div className="mt-8">
            <ProjectWork suggestions={byLane.projects} kept={kept} setKept={setKept} data={data} />
          </div>
        </div>
      )}

      {step === "loose" && (
        <div className="mx-auto max-w-[1080px]">
          {/* ── 2 · leftovers — what you already owed, before anything new ─────── */}
          <StepHeader title={LANE_QUESTION.loose} />
          <Leftovers
            suggestions={byLane.loose}
            kept={kept}
            setKept={setKept}
            data={data}
            onBundleCarried={() => void themeCarried()}
            bundling={themingCarried}
            bundleErr={carriedErr}
          />
        </div>
      )}

      {step === "inbox" && (
        <div className="mx-auto max-w-[1080px]">
          {/* ── 3 · the inbox — the GTD tail: loose captures get a when ────────── */}
          <StepHeader title={LANE_QUESTION.inbox} />
          <InboxGroups
            count={inboxCount}
            runs={runs}
            theming={theming}
            error={themeErr}
            onTheme={() => void themeInbox()}
          />
        </div>
      )}

      {step === "week" && (
        // ── 4 · the week — the composed board wide, boundaries + pool railed ───
        <div className="flex flex-col gap-6 lg:flex-row">
          <section className="min-w-0 flex-1">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              {/* no "batch into focus blocks" button: the board already composes
                  project slots and grouped runs. A second batcher over the
                  already-committed week was a different answer to the same
                  question, shown in a modal you couldn't edit. */}
              <h2 className="text-head masthead">Here's the week</h2>
              <span className="mono shrink-0 text-meta text-muted">
                {placedCount} scheduled · {result.unplaced.length} with no time yet
                {routedCount > 0 && ` · ${routedCount} in standing slots`}
                {eventCount > 0 && ` · ${eventCount} immovable`}
              </span>
            </div>

            {gridDays.length === 0 ? (
              <div className="rounded-md border border-dashed border-line p-10 text-center text-caption text-muted">
                No working days set — choose them in Boundaries.
              </div>
            ) : (
              <>
                <WeekGrid
                  days={gridDays}
                  events={visibleEvents}
                  slots={weekSlots}
                  locked={onCalBlocks}
                  placements={placements}
                  slotById={slotById}
                  data={data}
                  workStartMin={workStart}
                  workEndMin={workEnd}
                  dayContexts={dayContexts}
                  onDrop={dropBlock}
                  onMove={movePlacement}
                  onResize={resizePlacement}
                />
                {/* the glyphs on the blocks (✦ ▸ ✓) are the legend; four swatches
                    restating them was a key nobody needs twice */}
                <div className="mt-2 flex items-center gap-3 text-meta text-muted">
                  <span className="flex items-center gap-1.5"><span className="h-3 w-2.5 rounded-[3px]" style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", borderLeft: "3px solid var(--accent)" }} /> ✦ placed for you</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-2.5 rounded-[3px]" style={{ background: "color-mix(in srgb, var(--ink) 5%, transparent)", borderLeft: "2px solid var(--line-strong)" }} /> immovable</span>
                  <span className="mono ml-auto">drag to move · hover to drop</span>
                </div>
              </>
            )}
          </section>

          {/* right rail — what didn't find a time, and the boundaries that decided
              where things could go. The sources themselves live in steps 1–3; the
              header's capacity track keeps their weight in view from here. */}
          <aside className="shrink-0 space-y-5 lg:w-[320px]">
            {result.unplaced.length > 0 && (
              <section>
                <div className="section-label mb-1">
                  Committed, no time yet <span className="mono normal-case tracking-normal text-muted">{result.unplaced.length}</span>
                </div>
                {result.unplaced.map(({ task, reason }) => (
                  <div key={task.id} className="flex items-center gap-2 border-b border-line py-1 text-label text-muted">
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    <span className="mono shrink-0 text-micro">{reason}</span>
                  </div>
                ))}
              </section>
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
          </aside>
        </div>
      )}
    </Shell>
  );
}

// ── the overlay chrome ───────────────────────────────────────────────────────
function Shell({
  onClose,
  weekLabel,
  planningAhead,
  intake,
  footer,
  children,
}: {
  onClose: () => void;
  weekLabel: string;
  planningAhead: boolean;
  /** The funnel — always visible, on both acts. */
  intake?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="scrim atmosphere fixed inset-0 z-50 flex flex-col">
      {/* clears the macOS traffic lights + gives a drag handle — stays transparent
          so the one warm-paper canvas reads from the very top (no frost seam) */}
      <div data-tauri-drag-region className="h-8 w-full shrink-0" />
      <header className="flex shrink-0 items-center gap-4 border-b border-line px-5 py-2.5">
        <div className="flex items-baseline gap-3">
          <div className="wordmark text-head">Plan</div>
          <div className="mono text-label text-muted">
            week of {weekLabel}
            <span className="ml-1.5 rounded-full border border-line px-1.5 py-0.5 text-micro">
              {planningAhead ? "the week ahead" : "this week"}
            </span>
          </div>
        </div>
        <div className="flex-1" />
        <button onClick={onClose} className="keycap shrink-0">esc — resumes later</button>
      </header>
      {/* the funnel — the three sources and the one week they pour into, held in
          view for the whole flow so the arithmetic is never a surprise at commit */}
      {intake && (
        <div className="shrink-0 border-b border-line px-8 py-2">
          <div className="mx-auto max-w-[1080px]">{intake}</div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">{children}</div>
      {footer}
    </div>
  );
}

// The forward beat out of steps 1–3. Plain words for the thing you're going to,
// and a mono read of what the step you're leaving actually put in the week.
function ForwardBar({
  step,
  projectCount,
  leadCount,
  intake,
  waitingInbox,
  onNext,
}: {
  step: WeekStep;
  projectCount: number;
  leadCount: number;
  intake: WeekIntakeRead;
  waitingInbox: number;
  onNext: () => void;
}) {
  const read =
    step === "projects"
      ? `${projectCount > 0 ? `${projectCount} project${projectCount === 1 ? "" : "s"} this week` : "no projects on this week yet"}` +
        `${leadCount > 0 ? ` · ★ ${leadCount} lead${leadCount === 1 ? "" : "s"}` : ""}` +
        `${intake.projects.count > 0 ? ` · ${intake.projects.count} piece${intake.projects.count === 1 ? "" : "s"} of their work in` : ""}`
      : step === "loose"
        ? intake.loose.count > 0
          ? `${intake.loose.count} leftover${intake.loose.count === 1 ? "" : "s"} kept · ${hrs(intake.loose.mins)}h`
          : "nothing owed and nothing due"
        : intake.inbox.count > 0
          ? `${intake.inbox.count} capture${intake.inbox.count === 1 ? "" : "s"} joining the week` +
            (waitingInbox > 0 ? ` · ${waitingInbox} left in the inbox` : "")
          : waitingInbox > 0
            ? `${waitingInbox} still in the inbox — they'll keep`
            : "the inbox is clear";
  const label = step === "projects" ? "Leftovers →" : step === "loose" ? "Inbox →" : "The week →";

  return (
    <footer className="shrink-0 border-t border-line px-8 py-3">
      <div className="mx-auto flex max-w-[1080px] items-center gap-4">
        <div className="mono min-w-0 flex-1 text-meta text-muted">{read}</div>
        <Btn kind="primary" onClick={onNext} className="shrink-0 px-4 py-2">{label}</Btn>
      </div>
    </footer>
  );
}

/** Steps 2 and 3 are pages, not rails — and a page opens with its question and
 *  nothing else. The step number is in the intake bar two inches above; the
 *  explanatory paragraph taught a mechanic you learn once and re-read weekly. */
function StepHeader({ title }: { title: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-display masthead leading-[1.05]">{title}</h1>
    </header>
  );
}

// ── the initiatives — ≤3 leads, carried forward; verdicts on the stalled ────────────
function BetsStrip() {
  const { data, setFocusInitiatives, updateInitiative } = useVertical();
  const leads = data.focusInitiativeIds;
  const cutoff = useMemo(() => subDays(new Date(), 7), []);
  const rows = data.initiatives.filter((i) => isOpenStatus(i.status));
  const leadInits = rows.filter((i) => leads.includes(i.id));
  const stalledLeads = leadInits.filter(
    (i) => i.status !== "waiting" && initiativeProgress(data, i) === initiativeProgressAt(data, i, cutoff) && i.momentum !== "up",
  );
  const [manage, setManage] = useState(false);
  const open = manage || stalledLeads.length > 0;

  const toggleLead = (id: string) => {
    if (leads.includes(id)) setFocusInitiatives(leads.filter((x) => x !== id));
    else if (leads.length < 3) setFocusInitiatives([...leads, id]);
  };

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="section-label">
          The initiatives <span className="mono normal-case tracking-normal text-muted">· ★ {leads.length}/3 leads</span>
        </div>
        {rows.length > 0 && (
          <button onClick={() => setManage((m) => !m)} className="fast mono text-meta text-muted hover:text-ink">
            {open ? "done" : "adjust"}
          </button>
        )}
      </div>

      {!open ? (
        <div className="flex flex-wrap gap-1.5">
          {leadInits.length === 0 && (
            <span className="text-caption text-muted italic">No leads — up to three, via adjust.</span>
          )}
          {leadInits.map((i) => {
            const domain = domainById(data, i.domainId);
            return (
              <span
                key={i.id}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label"
                style={{ borderColor: "var(--signal)", background: "var(--signal-soft)" }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: domain?.color }} />
                {i.name}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((i) => (
            <BetRow
              key={i.id}
              initiative={i}
              data={data}
              cutoff={cutoff}
              lead={leads.includes(i.id)}
              leadFull={leads.length >= 3}
              onToggleLead={() => toggleLead(i.id)}
              onUpdate={(patch) => updateInitiative(i.id, patch)}
            />
          ))}
          {rows.length === 0 && (
            <p className="py-2 text-caption text-muted">
              No active initiatives. Start an initiative on the Initiative floor (⌘4).
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function BetRow({
  initiative,
  data,
  cutoff,
  lead,
  leadFull,
  onToggleLead,
  onUpdate,
}: {
  initiative: Initiative;
  data: VerticalData;
  cutoff: Date;
  lead: boolean;
  leadFull: boolean;
  onToggleLead: () => void;
  onUpdate: (patch: Partial<Initiative>) => void;
}) {
  const domain = domainById(data, initiative.domainId);
  const paused = initiative.status === "waiting";
  const from = initiativeProgressAt(data, initiative, cutoff);
  const to = initiativeProgress(data, initiative);
  const stalled = !paused && to === from && initiative.momentum !== "up";
  const daysLeft = initiative.targetDate
    ? differenceInCalendarDays(parseDateISO(initiative.targetDate), new Date())
    : null;

  return (
    <div
      className="glass-card flex items-center gap-3 rounded-md border px-3.5 py-2.5"
      style={{ borderColor: lead ? "var(--signal)" : "var(--line)", opacity: paused ? 0.55 : 1 }}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: domain?.color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium">{initiative.name}</div>
        <div className="mono truncate text-micro text-muted">
          {domain?.name}
          {initiative.outcome && ` · ${initiative.outcome}`}
        </div>
      </div>

      {stalled && (
        <span className="mono shrink-0 rounded-full border border-signal px-2 py-0.5 text-micro text-signal">
          stalled — commit, pause, or drop
        </span>
      )}

      <span className="mono shrink-0 text-label" style={{ color: to > from ? "var(--accent)" : "var(--muted)" }}>
        {to > from ? `${from}%→${to}%` : `${to}%`}
      </span>

      {daysLeft != null && (
        <span className="mono shrink-0 text-meta" style={{ color: daysLeft < 14 ? "var(--signal)" : "var(--muted)" }}>
          {daysLeft >= 0 ? `${daysLeft}d left` : `${-daysLeft}d over`}
        </span>
      )}

      <MomentumChip value={initiative.momentum} onChange={(m) => onUpdate({ momentum: m })} />

      {paused ? (
        <Btn onClick={() => onUpdate({ status: "in_progress" })}>resume</Btn>
      ) : (
        <>
          <button
            onClick={onToggleLead}
            disabled={!lead && leadFull}
            title={lead ? "Remove lead" : leadFull ? "Three leads already" : "Make this a lead initiative"}
            className="fast mono shrink-0 rounded-sm border px-2 py-1 text-meta disabled:opacity-30"
            style={{
              borderColor: lead ? "var(--signal)" : "var(--line)",
              color: lead ? "var(--signal)" : "var(--muted)",
              background: lead ? "var(--signal-soft)" : "transparent",
            }}
          >
            ★ lead
          </button>
          <Btn onClick={() => onUpdate({ status: "waiting" })}>pause</Btn>
          <Btn kind="signal" onClick={() => onUpdate({ status: "cancelled" })}>drop</Btn>
        </>
      )}
    </div>
  );
}

// ── the three sources, as the desktop lays them out ─────────────────────────
// Same three lanes as the phone, same order, same words — one act, two shells.

function InboxGroups({
  count,
  runs,
  theming,
  error,
  onTheme,
}: {
  count: number;
  runs: Batch[];
  theming: boolean;
  error: string | null;
  onTheme: () => void;
}) {
  if (count === 0 && runs.length === 0) {
    return <p className="text-body text-muted">Inbox clear.</p>;
  }
  return (
    <section>
      {count > 0 && (
        <>
          <button
            onClick={onTheme}
            disabled={theming}
            className="tap fast flex items-center justify-center gap-1.5 rounded-md px-4 py-2.5 text-body text-accent hover:brightness-105 disabled:opacity-50"
            style={{ background: "var(--accent-soft)" }}
          >
            {theming ? "Grouping…" : `✦ Group ${count} into blocks`}
          </button>
          {error && <p className="mt-1.5 text-meta text-signal">{error}</p>}
        </>
      )}

      {runs.length > 0 && (
        <div className="mt-5">
          <div className="section-label mb-1">
            Grouped <span className="mono normal-case tracking-normal text-muted">{runs.length}</span>
          </div>
          <div className="grid gap-x-8 md:grid-cols-2">
            {runs.map((r) => (
              <div key={r.id} className="flex items-baseline gap-2.5 border-b border-line py-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color ?? "var(--accent)" }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body">{r.name}</span>
                <span className="mono shrink-0 text-micro text-muted">
                  {r.taskIds.length} capture{r.taskIds.length === 1 ? "" : "s"} · {r.durationMins}m
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
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

/** Act 1 · the work belonging to the projects you named, under their names — so
 *  you SEE that bringing a project in brought its work with it. */
function ProjectWork({
  suggestions,
  kept,
  setKept,
  data,
}: {
  suggestions: PullSuggestion[];
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  data: VerticalData;
}) {
  const { updateTask } = useVertical();
  const toggle = useToggle(kept, setKept);

  const byProject = new Map<string, PullSuggestion[]>();
  const unassigned: PullSuggestion[] = [];
  for (const s of suggestions) {
    const pid = s.projectId;
    if (pid && projectById(data, pid)) {
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid)!.push(s);
    } else unassigned.push(s);
  }
  const on = suggestions.filter((s) => kept.has(s.task.id)).length;

  if (suggestions.length === 0) {
    return (
      <section>
        <h2 className="text-head masthead">The work that moves them</h2>
        <p className="mt-1 text-caption text-muted">Nothing open under this week's projects.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-head masthead">
          The work that moves them{" "}
          <span className="mono text-meta font-normal text-muted">{on}/{suggestions.length} in the week</span>
        </h2>
      </div>

      <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
        {[...byProject.entries()].map(([pid, rows]) => {
          const proj = projectById(data, pid)!;
          const color = domainById(data, proj.domainId)?.color ?? "var(--accent)";
          const kn = rows.filter((r) => kept.has(r.task.id)).length;
          const mins = rows
            .filter((r) => kept.has(r.task.id))
            .reduce((m, r) => m + plannedMinutes(r.task.durationMins, true), 0);
          const allOn = kn === rows.length;
          return (
            <div key={pid}>
              <div className="mb-1 flex items-baseline gap-2 border-b border-line pb-1">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body">{proj.name}</span>
                <button
                  onClick={() => {
                    const next = new Set(kept);
                    rows.forEach((r) => (allOn ? next.delete(r.task.id) : next.add(r.task.id)));
                    setKept(next);
                  }}
                  className="fast mono shrink-0 text-micro text-muted hover:text-accent"
                >
                  {allOn ? "none" : "all"}
                </button>
                <span className="mono shrink-0 text-micro text-muted">{kn}/{rows.length} · {hrs(mins)}h</span>
              </div>
              <div className="space-y-1">
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
            </div>
          );
        })}
      </div>

      {unassigned.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-line pt-2">
          <div className="section-label mb-1">Project work with no week set</div>
          {unassigned.map((r) => (
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
      )}
    </section>
  );
}

/** Step 2 · everything that isn't a project push and isn't raw capture: what
 *  rolled forward, what's due, and the domains going quiet. */
function Leftovers({
  suggestions,
  kept,
  setKept,
  data,
  onBundleCarried,
  bundling,
  bundleErr,
}: {
  suggestions: PullSuggestion[];
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  data: VerticalData;
  onBundleCarried: () => void;
  bundling: boolean;
  bundleErr: string | null;
}) {
  const { updateTask } = useVertical();
  const [showMore, setShowMore] = useState(false);
  const toggle = useToggle(kept, setKept);

  const suggestedIds = new Set(suggestions.map((s) => s.task.id));
  // everything else you could bring in, by hand — inbox first (loose captures),
  // then processed backlog; skip what's already here
  const more = useMemo(() => {
    const extra = [...inboxTasks(data), ...backlogTasks(data)].filter((t) => !suggestedIds.has(t.id));
    const seen = new Set<string>();
    return extra.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const carried = suggestions.filter((s) => s.task.rollCount > 0);
  const rest = suggestions.filter((s) => s.task.rollCount === 0);
  const carriedMins = carried.reduce((m, s) => m + s.task.durationMins, 0);

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

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-head masthead">
          Carried over, due, and quiet{" "}
          <span className="mono text-meta font-normal text-muted">{suggestions.length}</span>
        </h2>
        <button onClick={() => setShowMore((m) => !m)} className="fast mono text-meta text-muted hover:text-ink">
          {showMore ? "hide" : "＋ add more"}
        </button>
      </div>

      {suggestions.length === 0 && (
        <p className="py-1 text-caption text-muted">Nothing owed, nothing due.</p>
      )}

      <div className="grid gap-x-10 md:grid-cols-2">
      {carried.length > 0 && (
        <div className="mb-5">
          <div className="mb-2">
            <div className="section-label">
              Carried over <span className="mono normal-case tracking-normal text-signal">{carried.length} · {hrs(carriedMins)}h</span>
            </div>
            <button
              onClick={onBundleCarried}
              disabled={bundling}
              title="Group the kept carried work into a few named focus blocks, each sized to its tasks"
              className="tap fast mt-2 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption text-accent hover:bg-accent-soft disabled:opacity-50"
              style={{ background: "var(--accent-soft)" }}
            >
              {bundling ? "Grouping into blocks…" : "✦ Group into focus blocks"}
            </button>
            {bundleErr && <p className="mt-1 text-meta text-signal">{bundleErr}</p>}
          </div>
          <div className="space-y-1">{carried.map(row)}</div>
        </div>
      )}

      {rest.length > 0 && (
        <div>
          <div className="section-label mb-1">Due, or going quiet <span className="mono normal-case tracking-normal text-muted">{rest.length}</span></div>
          <div className="space-y-1">{rest.map(row)}</div>
        </div>
      )}
      </div>

      {showMore && (
        <div className="mt-2 max-h-[34vh] overflow-y-auto border-t border-line pt-2">
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
      <span className="min-w-0 flex-1 truncate text-caption" style={{ opacity: on ? 1 : 0.62 }}>
        {title}
      </span>
      {/* two glyphs where a clause used to be — the clause survives as the title */}
      {badge && (
        <span
          className="mono shrink-0 rounded-full px-1.5 text-micro"
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
        <span className="mono text-meta text-muted">
          {workingLabel} · {toMinLabel(workStart)}–{toMinLabel(workEnd)} · click to {open ? "hide" : "adjust"}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {/* working days — the recurring boundary; weekends off by default */}
          <div className="flex items-center gap-1.5">
            <span className="mono w-[78px] shrink-0 text-meta text-muted">working days</span>
            {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
              const on = workingDays.includes(dow);
              return (
                <button
                  key={dow}
                  onClick={() => toggleWorkingDay(dow)}
                  title={`${on ? "A working day" : "Off"} — click to toggle`}
                  className="fast mono h-6 w-7 rounded-sm border text-meta"
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
            <span className="mono ml-1 text-micro text-muted">— a setting, applies every week</span>
          </div>

          <label className="mono flex items-center gap-1.5 text-label text-muted">
            <span className="w-[78px] shrink-0">working hours</span>
            <input type="time" step={900} value={toMinLabel(workStart)} onChange={setWork("work_start_minutes")}
              className="border border-line bg-bg px-1.5 py-0.5 text-label outline-none focus:border-accent" />
            –
            <input type="time" step={900} value={toMinLabel(workEnd)} onChange={setWork("work_end_minutes")}
              className="border border-line bg-bg px-1.5 py-0.5 text-label outline-none focus:border-accent" />
          </label>

          {workingISOs.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="mono w-[78px] shrink-0 text-meta text-muted">this week</span>
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
                    className="fast mono flex-1 rounded-sm border px-1 py-1 text-meta disabled:opacity-25"
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
              <span className="mono hidden text-micro text-muted xl:inline">· normal ◐ light ✈ travel — off</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── the commit bar — confidence read + the one required click ────────────────
function CommitBar({
  goal,
  setGoal,
  lastGoal,
  conf,
  cal,
  plannedMins,
  keptCount,
  applying,
  onCommit,
}: {
  goal: string;
  setGoal: (g: string) => void;
  lastGoal: string;
  conf: ReturnType<typeof confidence>;
  cal: ReturnType<typeof calibrate>;
  plannedMins: number;
  keptCount: number;
  applying: boolean;
  onCommit: () => void;
}) {
  return (
    <footer className="shrink-0 border-t border-line px-8 py-3">
      <div className="mx-auto flex max-w-[1080px] items-center gap-4">
        <div className="min-w-0 flex-1">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={lastGoal ? `Last week: "${lastGoal}" — name this one` : "One line — what does a good week look like?"}
            className="w-full bg-transparent text-head font-medium outline-none placeholder:text-muted/60"
          />
          <div className="mono mt-0.5 text-meta text-muted">
            {conf && cal ? (
              <span style={{ color: conf.label === "stretch" ? "var(--signal)" : "var(--accent)" }}>
                {conf.pct}% · {conf.label} — {hrs(plannedMins)}h planned vs your ~{hrs(cal.avgWeeklyDoneMins)}h/wk pace
                {conf.deltaMins > 30 && ` · trim ~${hrs(conf.deltaMins)}h`}
              </span>
            ) : (
              <span>{keptCount} committed · a confidence read arrives after a week or two of history</span>
            )}
          </div>
        </div>
        <Btn kind="primary" onClick={onCommit} disabled={applying} className="shrink-0 px-4 py-2">
          {applying ? "committing…" : "Commit the week →"}
        </Btn>
      </div>
    </footer>
  );
}

// ── the week grid — a familiar week planner; OUR placements rendered strong ──
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
}

function WeekGrid({
  days,
  events,
  slots,
  locked,
  placements,
  slotById,
  data,
  workStartMin,
  workEndMin,
  dayContexts,
  onDrop,
  onMove,
  onResize,
}: {
  days: { iso: string; past: boolean }[];
  events: ExternalEvent[];
  slots: Slot[];
  locked: Task[];
  placements: Placement[];
  /** placements whose "task" is really a project slot, by synthetic id */
  slotById: Map<string, Batch>;
  data: VerticalData;
  workStartMin: number;
  workEndMin: number;
  dayContexts: Record<string, DayContext>;
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
      title: p.task.title,
      color: taskDomainColor(data, p.task),
      reason: p.reason,
      project: p.task.project_id ? projectById(data, p.task.project_id)?.name ?? null : null,
      holds: slot ? slot.taskIds.length : undefined,
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
  const totalH = ((hi - lo) / 60) * HOUR_PX;
  const yOf = (m: number) => ((m - lo) / 60) * HOUR_PX;

  // ── hand-editing — drag a placed block to move it, drag its edge to resize ──
  // Pointer events (Tauri swallows HTML5 DnD). The held block lifts into glass and
  // the destination column highlights — the drag-and-hold contract (design-language).
  const colRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<
    | { id: string; mode: "move" | "resize"; title: string; hue: string; dayISO: string; startMin: number; durationMin: number; grabOffsetMin: number }
    | null
  >(null);
  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);
  const drag = dragRef.current;

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
        d.dayISO = targetISO;
        d.startMin = start;
      } else {
        let end = snap(minAt(e.clientY, colTopOf(d.dayISO)));
        end = Math.max(d.startMin + 15, Math.min(hi, end));
        d.durationMin = end - d.startMin;
      }
      bump();
    };
    const onPointerUp = () => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === "move") onMove(d.id, d.dayISO, d.startMin);
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
    };
    bump();
  };

  return (
    <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: "62vh" }}>
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
            <div key={h} className="relative" style={{ height: HOUR_PX }}>
              <span className="mono absolute -top-1.5 right-1.5 text-micro text-muted">{formatHourLabel(Math.floor(h / 60))}</span>
            </div>
          ))}
        </div>
        {days.map((d) => {
          const items = (byDay.get(d.iso) ?? []).sort((a, b) => a.startMin - b.startMin);
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
              {items.map((it) => {
                const top = yOf(it.startMin);
                const height = Math.max(MIN_BLOCK_PX, yOf(it.endMin) - yOf(it.startMin));
                if (it.kind === "event") {
                  // immovable external commitments — a quiet neutral frost, no identity
                  return (
                    <div
                      key={`ev-${it.id}`}
                      className="absolute inset-x-1 overflow-hidden rounded-[5px] px-1.5 py-0.5"
                      style={{
                        top, height,
                        background: "color-mix(in srgb, var(--ink) 5%, transparent)",
                        borderLeft: "2px solid var(--line-strong)",
                        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
                      }}
                      title={it.title}
                    >
                      <div className="mono truncate text-micro leading-tight text-muted">{it.title}</div>
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
                return (
                  <div
                    key={`${it.kind}-${it.id}`}
                    onPointerDown={draggable ? (e) => startDrag(e, it, d.iso, "move") : undefined}
                    className={`group lift-anim absolute inset-x-1 overflow-hidden rounded-[6px] px-1.5 py-1 ${draggable ? "cursor-grab" : ""}`}
                    style={{
                      top: blkTop, height: blkHeight,
                      color: "var(--ink)",
                      background: `color-mix(in srgb, ${hue} ${isProject ? 26 : isNew ? 22 : isSlot ? 18 : 13}%, transparent)`,
                      borderLeft: `${isProject ? 4 : 3}px solid ${hue}`,
                      borderTop: moveSource ? "1px dashed var(--line-strong)" : undefined,
                      opacity: moveSource ? 0.3 : isNew || isSlot ? 1 : 0.85,
                      backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
                      // a project slot lifts a touch more — a real push, not errand time
                      boxShadow: !isNew || moveSource ? "none" : isProject ? `var(--shadow-lift), inset 3px 0 0 color-mix(in srgb, ${hue} 45%, transparent)` : "var(--shadow-lift)",
                      touchAction: draggable ? "none" : undefined,
                    }}
                    title={draggable ? `drag to move · drag the bottom edge to resize${isSplit ? " · one sitting of a split" : ""}` : isSlot ? "focus block — your batched work" : "already on the calendar — locked"}
                  >
                    {/* the eyebrow names the project — pointless on a project SLOT,
                        whose own title is already the project name */}
                    {isProject && !it.holds && blkHeight > 34 && (
                      <div
                        className="section-label truncate leading-none"
                        style={{ color: hue, letterSpacing: "0.06em" }}
                        title={it.project ?? undefined}
                      >
                        {it.project}
                      </div>
                    )}
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1 truncate text-meta font-semibold leading-tight">
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
                    {blkHeight > 30 && (
                      <div className="mono truncate text-micro leading-tight text-muted">
                        {fmtMinShort(it.startMin)}–{fmtMinShort(endMin)}
                        {it.holds ? ` · ${it.holds} task${it.holds === 1 ? "" : "s"}` : ""}
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
              {drag?.mode === "move" && drag.dayISO === d.iso && (
                <div
                  className="glass-grab pointer-events-none absolute inset-x-1 overflow-hidden rounded-[6px] px-1.5 py-1"
                  style={{
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

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-[460px] text-center">
        <div className="mono mb-2 text-micro uppercase tracking-wide" style={{ color: "var(--accent)" }}>{sprintLabel()}</div>
        <div className="text-display masthead">Your week is set.</div>
        {data.sprintGoal && <div className="mt-2 text-head text-muted">“{data.sprintGoal}”</div>}
        <div className="mono mt-3 text-label text-muted">
          {hrs(totalMins)}h committed · {committed.length} tasks · {split.length} domain{split.length === 1 ? "" : "s"} · ★ {data.focusInitiativeIds.length} lead initiative{data.focusInitiativeIds.length === 1 ? "" : "s"}
        </div>
        {split.length > 0 && (
          <div className="mx-auto mt-4 flex h-2 max-w-[300px] overflow-hidden rounded-full bg-surface">
            {split.map((x) => (
              <div
                key={x.domain.id}
                title={`${x.domain.name} · ${hrs(x.mins)}h`}
                style={{ width: `${(x.mins / Math.max(1, split.reduce((s, y) => s + y.mins, 0))) * 100}%`, background: x.domain.color }}
              />
            ))}
          </div>
        )}
        <div className="mt-6">
          <Btn kind="primary" onClick={onClose}>Begin the week</Btn>
        </div>
      </div>
    </div>
  );
}

