// Plan the week, on a phone — the same act the desktop ritual runs, laid out for
// a thumb.
//
// The desktop lays the week out as one wide board (intent left→right, then a
// seven-column grid you drag on). A phone can't hold that board, but the *act*
// isn't the board — it is three decisions in order:
//
//   1 · The slate   — which projects are you moving this week? (On Deck's derived
//                     membership: bringing one in writes its span, exactly like
//                     dropping it on this week's column — lib/priorities.ts)
//   2 · The pull    — which of their work comes with them? (suggestPull, kept)
//   3 · The shape   — where it lands, day by day, and the one honest read of
//                     whether the week can carry it. Then commit.
//
// Everything that decides *what* the week is comes from `useWeekDraft` — the same
// hook SundayRitual uses. This file only lays it out and offers taps: no drag,
// every move has a tap path (mobile golden rule #4), 44px targets, safe areas.

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useWeekDraft } from "../../hooks/useWeekDraft";
import { projectsOnDeck, weekPushes } from "../../lib/priorities";
import { lensGaps } from "../../lib/lenses";
import { domainById, taskDomainColor, type Project, type VerticalData } from "../../lib/vertical";
import { fmtHours as hrs, parseDateISO, planningWeekStartISO } from "../../lib/dates";
import { bringIntoWeekPatch, takeOffWeekPatch } from "../../../supabase/functions/_shared/planningRules.ts";
import { sprintLabel } from "../../lib/sprint";
import type { Placement } from "../../lib/compose";
import DurationSelect from "../DurationSelect";

type Step = "slate" | "pull" | "shape";

const STEPS: { id: Step; label: string }[] = [
  { id: "slate", label: "Slate" },
  { id: "pull", label: "Pull" },
  { id: "shape", label: "Shape" },
];

const fmtMinShort = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "pm" : "am", hh = ((h + 11) % 12) + 1;
  return mm === 0 ? `${hh}${ap}` : `${hh}:${String(mm).padStart(2, "0")}${ap}`;
};

export default function MobilePlanWeek({ onClose }: { onClose: () => void }) {
  const draft = useWeekDraft();
  const { updateProject } = useVertical();
  const [step, setStep] = useState<Step>("slate");

  const {
    data,
    weekStartISO,
    planningAhead,
    gridDays,
    suggestions,
    kept,
    setKept,
    keptTasks,
    dropBlock,
    routedCount,
    slotById,
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

  // The week's slate — derived from the On Deck spans, never stored. Bringing a
  // project in / taking it off IS the placement write, same as the deck's drop.
  const pushes = useMemo(() => weekPushes(data, weekStartISO), [data, weekStartISO]);
  const bringIn = (p: Project) => {
    const patch = bringIntoWeekPatch(p, weekStartISO);
    if (patch) updateProject(p.id, patch);
  };
  const takeOff = (p: Project) => updateProject(p.id, takeOffWeekPatch());

  const weekLabel = format(parseDateISO(weekStartISO), "MMMM d");

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

  return (
    <Overlay>
      {/* Header — transparent over the atmosphere, hairline only */}
      <header className="shrink-0 border-b border-line px-4 pb-2 pt-safe">
        <div className="flex items-start gap-2 pt-2">
          <div className="min-w-0 flex-1">
            <div className="section-label !p-0">
              <span style={{ color: "var(--accent)" }}>{sprintLabel(weekStartISO)}</span> ·{" "}
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
        <StepRail step={step} setStep={setStep} />
      </header>

      <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {step === "slate" && (
          <SlateStep
            data={data}
            weekStartISO={weekStartISO}
            pushes={pushes}
            gain={gain}
            onBringIn={bringIn}
            onTakeOff={takeOff}
          />
        )}
        {step === "pull" && (
          <PullStep
            data={data}
            suggestions={suggestions}
            kept={kept}
            setKept={setKept}
            keptMins={keptTasks.reduce((s, t) => s + (t.duration_minutes ?? 30), 0)}
            inboxCount={inboxCount}
            onThemeInbox={() => void themeInbox()}
            theming={theming}
            themeErr={themeErr}
            onThemeCarried={() => void themeCarried()}
            themingCarried={themingCarried}
            carriedErr={carriedErr}
          />
        )}
        {step === "shape" && (
          <ShapeStep
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
        {step === "shape" ? (
          <div className="flex items-center gap-3">
            <div className="mono min-w-0 flex-1 text-meta text-muted">
              {conf && cal ? (
                <span style={{ color: conf.label === "stretch" ? "var(--signal)" : "var(--accent)" }}>
                  {conf.pct}% · {conf.label} — {hrs(plannedMins)}h vs your ~{hrs(cal.avgWeeklyDoneMins)}h/wk
                  {conf.deltaMins > 30 && ` · trim ~${hrs(conf.deltaMins)}h`}
                </span>
              ) : (
                <span>{keptTasks.length} committed · {hrs(plannedMins)}h planned</span>
              )}
            </div>
            <PrimaryButton onClick={() => void commit()} disabled={applying} compact>
              {applying ? "committing…" : "Commit the week"}
            </PrimaryButton>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="mono min-w-0 flex-1 text-meta text-muted">
              {step === "slate"
                ? pushes.length > 0
                  ? `${pushes.length} on the slate`
                  : "nothing on the slate yet"
                : `${keptTasks.length} kept · ${hrs(keptTasks.reduce((s, t) => s + (t.duration_minutes ?? 30), 0))}h`}
            </div>
            <PrimaryButton onClick={() => setStep(step === "slate" ? "pull" : "shape")} compact>
              {step === "slate" ? "Pull the work" : "Shape the week"}
            </PrimaryButton>
          </div>
        )}
      </Footer>
    </Overlay>
  );
}

/** The Week segment's entry to the ritual — the slate's live read, then the act.
 *  Sits above the week's plan/review card: you set the week here, you watch it
 *  land there. */
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
            ? "Nothing on the slate yet — pick what moves"
            : `${pushes.length} on the slate · ${ready} ready to slot`}
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

function StepRail({ step, setStep }: { step: Step; setStep: (s: Step) => void }) {
  return (
    <div className="mt-2.5 flex gap-1">
      {STEPS.map((s, i) => {
        const on = step === s.id;
        return (
          <button
            key={s.id}
            onClick={() => setStep(s.id)}
            className={`tap fast flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-body font-medium ${
              on ? "bg-accent text-white" : "text-muted active:bg-surface-2"
            }`}
          >
            <span className={`mono text-micro ${on ? "opacity-80" : "opacity-60"}`}>{i + 1}</span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-caption text-muted">{children}</p>;
}

// ── 1 · the slate — what are you moving this week? ────────────────────────────

export function SlateStep({
  data,
  weekStartISO,
  pushes,
  gain,
  onBringIn,
  onTakeOff,
}: {
  data: VerticalData;
  weekStartISO: string;
  pushes: ReturnType<typeof weekPushes>;
  gain: { doneCount: number; doneMins: number; topMove: { name: string; from: number; to: number } | null; quiet: string[] };
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
  const needsSprint = open.filter((p) => !p.targetDate);
  const elsewhere = open.filter((p) => p.targetDate);

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

      <h2 className="masthead mt-4 text-head text-ink">What are you moving this week?</h2>

      {pushes.length > 0 ? (
        <div className="mt-3 border-t border-line">
          {pushes.map(({ project, shipped }) => {
            const color = domainById(data, project.domainId)?.color ?? "var(--accent)";
            const gaps = lensGaps(data, "project", project, new Date());
            const ready = gaps.length === 0;
            return (
              <div key={project.id} className="flex items-start gap-3 border-b border-line py-3">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={ready ? { background: color } : { border: "1.5px solid var(--line-strong)" }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-ink">{project.name}</div>
                  <div className="truncate text-caption text-muted">
                    {project.outcome?.trim() || "no outcome yet"}
                  </div>
                  <div className="mono mt-0.5 text-micro" style={{ color: ready ? color : "var(--muted)" }}>
                    {shipped ? "shipped this week" : ready ? "ready to slot" : gaps.map((g) => g.label).join(" · ")}
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
            );
          })}
        </div>
      ) : (
        <Empty>Nothing on the slate for this week — bring a project in below.</Empty>
      )}

      {(needsSprint.length > 0 || elsewhere.length > 0) && (
        <div className="mt-5">
          <div className="section-label mb-2 !p-0">Slot a project</div>
          <div className="flex flex-wrap gap-2">
            {needsSprint.map((p) => (
              <ProjectChip key={p.id} data={data} p={p} reason="needs a sprint" onTap={() => onBringIn(p)} />
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

// ── 2 · the pull — which work comes with them ────────────────────────────────

export function PullStep({
  data,
  suggestions,
  kept,
  setKept,
  keptMins,
  inboxCount,
  onThemeInbox,
  theming,
  themeErr,
  onThemeCarried,
  themingCarried,
  carriedErr,
}: {
  data: VerticalData;
  suggestions: ReturnType<typeof useWeekDraft>["suggestions"];
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  keptMins: number;
  inboxCount: number;
  onThemeInbox: () => void;
  theming: boolean;
  themeErr: string | null;
  onThemeCarried: () => void;
  themingCarried: boolean;
  carriedErr: string | null;
}) {
  const toggle = (id: string) => {
    const next = new Set(kept);
    next.has(id) ? next.delete(id) : next.add(id);
    setKept(next);
  };

  // The pull's own order, kept: carried work first (already-owed), then each
  // project's work under its name, then everything loose.
  const carried = suggestions.filter((s) => s.task.rollCount > 0);
  const carriedIds = new Set(carried.map((s) => s.task.id));
  const rest = suggestions.filter((s) => !carriedIds.has(s.task.id));
  const groups = new Map<string, typeof suggestions>();
  for (const s of rest) {
    const key = s.projectId ?? "loose";
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  return (
    <div>
      <h2 className="masthead text-head text-ink">What moves them?</h2>
      <p className="mt-1 text-caption text-muted">
        {kept.size} kept · {hrs(keptMins)}h. Tap to drop anything the week can't carry.
      </p>

      {suggestions.length === 0 && (
        <Empty>Nothing to pull — the slate's projects have no open work, or nothing is due.</Empty>
      )}

      {carried.length > 0 && (
        <section className="mt-4">
          <div className="section-label mb-1 flex items-baseline justify-between !p-0">
            <span>Carrying forward · {carried.length}</span>
            <button
              onClick={onThemeCarried}
              disabled={themingCarried}
              className="tap fast text-meta text-accent disabled:opacity-50"
            >
              {themingCarried ? "bundling…" : "bundle into focus blocks"}
            </button>
          </div>
          {carriedErr && <p className="text-meta text-signal">{carriedErr}</p>}
          <div className="border-t border-line">
            {carried.map((s) => (
              <PullRow key={s.task.id} data={data} s={s} on={kept.has(s.task.id)} onToggle={() => toggle(s.task.id)} />
            ))}
          </div>
        </section>
      )}

      {[...groups.entries()].map(([key, rows]) => {
        const project = key === "loose" ? null : data.projects.find((p) => p.id === key);
        return (
          <section key={key} className="mt-4">
            <div className="section-label mb-1 !p-0">
              {project ? project.name : "Loose work"} · {rows.length}
            </div>
            <div className="border-t border-line">
              {rows.map((s) => (
                <PullRow key={s.task.id} data={data} s={s} on={kept.has(s.task.id)} onToggle={() => toggle(s.task.id)} />
              ))}
            </div>
          </section>
        );
      })}

      {inboxCount > 0 && (
        <section className="mt-5 border-t border-line pt-3">
          <div className="text-caption text-muted">
            {inboxCount} loose capture{inboxCount === 1 ? "" : "s"} in the inbox. Nuvo can group them into named runs and
            drop each into open time.
          </div>
          <button
            onClick={onThemeInbox}
            disabled={theming}
            className="tap fast mt-2 flex min-h-[44px] items-center rounded-xl border border-line px-4 text-body text-ink active:bg-surface-2 disabled:opacity-50"
          >
            {theming ? "theming…" : "Theme the inbox"}
          </button>
          {themeErr && <p className="mt-1 text-meta text-signal">{themeErr}</p>}
        </section>
      )}
    </div>
  );
}

function PullRow({
  data,
  s,
  on,
  onToggle,
}: {
  data: VerticalData;
  s: ReturnType<typeof useWeekDraft>["suggestions"][number];
  on: boolean;
  onToggle: () => void;
}) {
  const { updateTask } = useVertical();
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
        <span className="mono block truncate text-micro text-muted">{s.reason}</span>
      </span>
      <DurationSelect
        value={s.task.durationMins}
        onChange={(m) => updateTask(s.task.id, { durationMins: m })}
        className="tap shrink-0 rounded px-1.5 py-1 pt-0.5 hover:bg-surface-2"
        title="Sitting length"
      />
    </button>
  );
}

// ── 3 · the shape — where it lands, day by day ───────────────────────────────

export function ShapeStep({
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
      <h2 className="masthead text-head text-ink">Here's the week</h2>
      <p className="mt-1 text-caption text-muted">
        {placements.length} placed · {unplaced.length} in the pool
        {routedCount > 0 && ` · ${routedCount} in standing slots`}. Tap a block to drop it.
      </p>

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
                        aria-label={`Drop ${title}`}
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
          <div className="section-label mb-1 !p-0">In the pool — committed, no time yet ({unplaced.length})</div>
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
