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
// The steps used to be called **Slate → Pull → Shape** — three verbs that appear
// nowhere else in the product and that told a first-time reader nothing about what
// they were being asked. They're now named after the thing itself, and the header
// (`WeekIntakeBar`) draws the three sources pouring into one measured week, so the
// funnel is visible instead of implied.
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
import { LANE_QUESTION } from "../../lib/intake";
import type { Batch } from "../../lib/batch";
import type { Placement } from "../../lib/compose";
import WeekIntakeBar, { type WeekStep } from "../rituals/WeekIntake";
import DurationSelect from "../DurationSelect";

/** The forward beat out of each step — plain words for the thing you're going to. */
const NEXT: Partial<Record<WeekStep, { to: WeekStep; label: string }>> = {
  projects: { to: "loose", label: "Leftovers →" },
  loose: { to: "inbox", label: "Inbox →" },
  inbox: { to: "week", label: "The week →" },
};

const fmtMinShort = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "pm" : "am", hh = ((h + 11) % 12) + 1;
  return mm === 0 ? `${hh}${ap}` : `${hh}:${String(mm).padStart(2, "0")}${ap}`;
};

export default function MobilePlanWeek({ onClose }: { onClose: () => void }) {
  const draft = useWeekDraft();
  const { updateProject, updateTask } = useVertical();
  const [step, setStep] = useState<WeekStep>("projects");
  const [visited, setVisited] = useState<Set<WeekStep>>(new Set(["projects"]));
  const go = (s: WeekStep) => {
    setStep(s);
    setVisited((v) => new Set([...v, s]));
  };

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
    result,
    placements,
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

  // The week's projects — derived from the On Deck spans, never stored. Bringing a
  // project in / taking it off IS the placement write, same as the deck's drop.
  const pushes = useMemo(() => weekPushes(data, weekStartISO), [data, weekStartISO]);
  const bringIn = (p: Project) => {
    const patch = bringIntoWeekPatch(p, weekStartISO);
    if (patch) updateProject(p.id, patch);
  };
  const takeOff = (p: Project) => updateProject(p.id, takeOffWeekPatch());
  const setDuration = (taskId: string, mins: number) => updateTask(taskId, { durationMins: mins });

  const weekLabel = format(parseDateISO(weekStartISO), "MMMM d");
  const spanLabel = `${format(parseDateISO(weekStartISO), "MMM d")}–${format(addDays(parseDateISO(weekStartISO), 6), "MMM d")}`;

  if (committed) {
    return (
      <Overlay>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="section-label">{sprintLabel(weekStartISO)}</div>
          <h1 className="mt-2 text-display masthead leading-tight">The week is set</h1>
          <p className="mt-3 text-body text-muted">
            {placements.length} block{placements.length === 1 ? "" : "s"} placed · {keptTasks.length} committed
            {routedCount > 0 && ` · ${routedCount} in standing slots`}.
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
        <WeekIntakeBar intake={intake} step={step} onStep={go} visited={visited} waitingInbox={inboxCount} dense />
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
            onDrop={dropBlock}
            goal={goal}
            setGoal={setGoal}
            lastGoal={data.sprintGoal ?? ""}
          />
        )}
      </div>

      <Footer>
        <div className="flex items-center gap-3">
          <div className="mono min-w-0 flex-1 text-meta text-muted">
            {step === "week" && conf && cal ? (
              <span style={{ color: conf.label === "stretch" ? "var(--signal)" : "var(--accent)" }}>
                {conf.pct}% · {conf.label} — {hrs(plannedMins)}h vs your ~{hrs(cal.avgWeeklyDoneMins)}h/wk
                {conf.deltaMins > 30 && ` · trim ~${hrs(conf.deltaMins)}h`}
              </span>
            ) : (
              <span>
                {intake.loadMins > 0 ? `${hrs(intake.loadMins)}h in the week` : "nothing in the week yet"}
                {intake.overMins > 0 && (
                  <span style={{ color: "var(--signal)" }}> · {hrs(intake.overMins)}h over pace</span>
                )}
              </span>
            )}
          </div>
          {next ? (
            <PrimaryButton onClick={() => go(next.to)} compact>{next.label}</PrimaryButton>
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

function Footer({ children }: { children: React.ReactNode }) {
  return <footer className="shrink-0 border-t border-line px-4 py-3 pb-safe">{children}</footer>;
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

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-caption text-muted">{children}</p>;
}

/** Every step opens the same way: the question it answers, in the app's own
 *  reporting voice, then the evidence. One hero per surface. */
function StepHead({ question, note }: { question: string; note?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="masthead text-head text-ink">{question}</h2>
      {note && <p className="mt-1 text-caption text-muted">{note}</p>}
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
      <p className="text-caption text-muted">
        Last 7 days — <span className="text-ink">{gain.doneCount} done · {hrs(gain.doneMins)}h</span>.
        {gain.topMove && (
          <span style={{ color: "var(--accent)" }}> {gain.topMove.name} climbed {gain.topMove.from}→{gain.topMove.to}%.</span>
        )}
        {gain.quiet.length > 0 && (
          <span style={{ color: "var(--signal)" }}> {gain.quiet.join(" & ")} went quiet.</span>
        )}
      </p>

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
                    <div className="truncate text-body text-ink">{project.name}</div>
                    {/* a missing outcome is already reported by the gap line below —
                        saying it twice made the row look broken */}
                    {project.outcome?.trim() && (
                      <div className="truncate text-caption text-muted">{project.outcome.trim()}</div>
                    )}
                    <div className="mono mt-0.5 text-micro" style={{ color: ready ? color : "var(--muted)" }}>
                      {shipped ? "shipped this week" : ready ? "ready to schedule" : gaps.map((g) => g.label).join(" · ")}
                      {work.length > 0 && ` · ${on}/${work.length} of its work in`}
                    </div>
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
        <Empty>No projects on this week yet — bring one in below.</Empty>
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
              <ProjectChip key={p.id} data={data} p={p} reason="no week yet" onTap={() => onBringIn(p)} />
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
  reason: string;
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
      <span className="mono text-micro text-muted">{reason}</span>
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
        note="Work you already owed, dates that landed, and the domains that have gone quiet. Tap to drop anything the week can't carry."
      />

      {suggestions.length === 0 && (
        <Empty>Nothing owed and nothing due — last week closed clean.</Empty>
      )}

      {carried.length > 0 && (
        <section className="mt-1">
          <div className="section-label mb-1 !p-0">Carried over · {carried.length} · {hrs(carriedMins)}h</div>
          <p className="text-caption text-muted">
            It rolled forward with no time yet — it's already in the week, so Nuvo finds it new slots.
          </p>
          {/* a full-width 44px target, not an inline text link: the same action on
              the Inbox step is a real button, and a 14px tap zone fails golden rule 2 */}
          <button
            onClick={onBundleCarried}
            disabled={bundling}
            className="tap fast mb-2 mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 text-body text-accent active:opacity-80 disabled:opacity-50"
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
      <StepHead
        question={LANE_QUESTION.inbox}
        note={
          inboxCount === 0
            ? "The inbox is clear — nothing loose waiting for a time."
            : `${inboxCount} capture${inboxCount === 1 ? "" : "s"} with no time yet. Nuvo can group like with like into named blocks and drop each into open time.`
        }
      />

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
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-ink">{r.name}</div>
                  <div className="mono truncate text-micro text-muted">
                    {r.taskIds.length} capture{r.taskIds.length === 1 ? "" : "s"} · {r.durationMins}m — scheduled in step 4
                  </div>
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
  return (
    <button
      onClick={onToggle}
      className="tap fast flex w-full items-start gap-3 border-b border-line py-3 text-left active:bg-surface-2"
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
        {!hideReason && <span className="mono block truncate text-micro text-muted">{s.reason}</span>}
      </span>
      <DurationSelect
        value={s.task.durationMins}
        onChange={(m) => onDuration(s.task.id, m)}
        className="tap shrink-0 rounded px-1.5 py-1 pt-0.5 hover:bg-surface-2"
        title="Sitting length"
      />
    </button>
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
  onDrop,
  goal,
  setGoal,
  lastGoal,
}: {
  data: VerticalData;
  days: { iso: string; past: boolean }[];
  placements: Placement[];
  slotNameById: ReturnType<typeof useWeekDraft>["slotById"];
  unplaced: ReturnType<typeof useWeekDraft>["result"]["unplaced"];
  routedCount: number;
  onDrop: (taskId: string) => void;
  goal: string;
  setGoal: (g: string) => void;
  lastGoal: string;
}) {
  const byDay = new Map<string, Placement[]>();
  for (const p of placements) byDay.set(p.dayISO, [...(byDay.get(p.dayISO) ?? []), p]);
  for (const list of byDay.values()) list.sort((a, b) => a.startMin - b.startMin);

  return (
    <div>
      <StepHead
        question="Here's the week"
        note={
          <>
            {placements.length} scheduled · {unplaced.length} committed with no time yet
            {routedCount > 0 && ` · ${routedCount} in standing slots`}. Tap a block to take it out.
          </>
        }
      />

      {days.length === 0 && (
        <Empty>No working days set — choose your working days in Settings, then plan.</Empty>
      )}

      {days.map(({ iso, past }) => {
        const list = byDay.get(iso) ?? [];
        return (
          <section key={iso} className={`mt-4 ${past ? "opacity-50" : ""}`}>
            <div className="section-label mb-1 !p-0">{format(parseDateISO(iso), "EEEE, MMM d")}</div>
            {list.length === 0 ? (
              <p className="border-t border-line py-2.5 text-caption text-muted">open</p>
            ) : (
              <div className="border-t border-line">
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
                        <div className="mono truncate text-micro text-muted">
                          {p.durationMin}m
                          {slot && slot.taskIds.length > 1 && ` · ${slot.taskIds.length} steps`}
                          {p.reason && ` · ${p.reason}`}
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
          <div className="section-label mb-1 !p-0">Committed, no time yet ({unplaced.length})</div>
          {unplaced.map(({ task, reason }) => (
            <div key={task.id} className="flex items-baseline gap-2 py-1">
              <span className="min-w-0 flex-1 truncate text-caption text-muted">{task.title}</span>
              <span className="mono shrink-0 text-micro text-muted">{reason}</span>
            </div>
          ))}
        </section>
      )}

      <section className="mt-5 border-t border-line pt-4">
        <div className="section-label mb-1 !p-0">The week in one line</div>
        {/* plain text input — iOS dictation works out of the box (low-data-entry) */}
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder={lastGoal ? `Last week: “${lastGoal}”` : "What does a good week look like?"}
          className="min-h-[44px] w-full bg-transparent text-body text-ink outline-none placeholder:text-muted/60"
        />
      </section>
    </div>
  );
}
