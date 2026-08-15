// Groom — the phone's second face of the Build altitudes, the twin of the
// desktop `GroomFloor` / `InitiativeGroomFloor`.
//
// On Deck answers WHEN (which week / quarter does this land in). Groom answers
// WHAT: shape the thing until it's ready to be pulled. Until now this face
// existed only at a desk, which meant the phone could *place* work it could not
// *shape* — you could commit a raw project to next week on the train and then
// had to be at a laptop to say what "done" meant.
//
// Translation, not a port. The desktop stands each record up as a column on a
// horizontal wall; a 375px screen has no room for columns, so the same records
// become a vertical stack of cards, **thinnest first** (the desktop's ordering,
// kept), each one carrying exactly the fields that close its open checks:
//   · a project — the outcome line (Defined) and a step composer (Planned)
//   · an initiative — the objective + finish line (Defined) and key results (Measured)
// Everything else about the record stays one tap away in the record itself.
//
// Reuse-first, like the desktop floors: the lanes come from `readOnDeck` /
// `allOpenInitiativeLanes`, the axes from the same readiness helpers, the task
// line from the record's own `TaskComposer`. This file only arranges them for a
// thumb.

import { useMemo } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { readOnDeck, type OnDeckLane } from "../../lib/onDeck";
import { allOpenInitiativeLanes, type InitiativeLane } from "../../lib/initiativeDeck";
import { initiativeReadinessAxes } from "../../lib/lenses";
import { domainById, tasksOf, type VerticalData } from "../../lib/vertical";
import { READY } from "../floors/ReadinessBanner";
import { PROJECT_STATUS_COLORS } from "../floors/parts";
import { AreaField, Hint, TaskComposer, type Store } from "./detail/verticalDetail";
import SkeletonRows from "./Skeleton";
import { useRecordActions } from "./MobileRecordActions";

const CAUTION = PROJECT_STATUS_COLORS.waiting;
// Same horizon the desktop groom wall reads over — grooming looks further out
// than the phone's six-week deck, because shaping runs ahead of placing.
const HORIZON = 8;

/** The colour of a "how shaped is this" mark, by how many checks are met. */
function tierColor(met: number, total: number): string {
  if (met >= total) return READY;
  return met > 0 ? CAUTION : "var(--line-strong)";
}

export default function MobileGroom({
  scope,
  onOpenItem,
}: {
  scope: "project" | "initiative";
  onOpenItem: (kind: "project" | "initiative" | "domain", id: string) => void;
}) {
  const store = useVertical();
  const { data: d, ready } = store;
  const { byWeek, weeklyAvgMins } = useCapacity();
  const now = useMemo(() => new Date(), []);
  const { actionProps, sheet } = useRecordActions(onOpenItem);

  const projectLanes = useMemo(
    () =>
      scope === "project"
        ? readOnDeck(d, byWeek, weeklyAvgMins, now, HORIZON).lanes.filter((l) => l.readyTier !== "done")
        : [],
    [scope, d, byWeek, weeklyAvgMins, now],
  );
  const initiativeLanes = useMemo(
    () => (scope === "initiative" ? allOpenInitiativeLanes(d, now) : []),
    [scope, d, now],
  );

  // Thinnest first — the rawest work presents itself, exactly as the desktop
  // wall orders its columns. Parked rests at the end either way.
  const projects = useMemo(
    () =>
      [...projectLanes].sort((a, b) => {
        const park = Number(a.readyTier === "parked") - Number(b.readyTier === "parked");
        return park || a.readyCount - b.readyCount || a.project.name.localeCompare(b.project.name);
      }),
    [projectLanes],
  );
  const initiatives = useMemo(
    () =>
      [...initiativeLanes].sort((a, b) => {
        const park = Number(a.state === "parked") - Number(b.state === "parked");
        const met = (l: InitiativeLane) => {
          const ax = initiativeReadinessAxes(d, l.initiative);
          return (ax.defined ? 1 : 0) + (ax.planned ? 1 : 0);
        };
        return park || met(a) - met(b) || a.initiative.name.localeCompare(b.initiative.name);
      }),
    [initiativeLanes, d],
  );

  if (!ready) return <SkeletonRows rows={4} />;

  const rollup =
    scope === "project"
      ? countBy(projects.filter((l) => l.readyTier !== "parked").map((l) => l.readyCount), 3)
      : countBy(
          initiatives
            .filter((l) => l.state !== "parked")
            .map((l) => {
              const ax = initiativeReadinessAxes(d, l.initiative);
              return (ax.defined ? 1 : 0) + (ax.planned ? 1 : 0);
            }),
          2,
        );

  const empty = scope === "project" ? projects.length === 0 : initiatives.length === 0;

  return (
    <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto fab-clear">
      <div className="px-4 pt-4">
        <h1 className="text-display masthead leading-none">
          {scope === "project" ? "Groom" : "Grooming"}
        </h1>
        <p className="mt-1.5 text-caption text-muted">
          {scope === "project"
            ? "Shape the work — say what done is, break it down. Thinnest first."
            : "Shape the bets — define the objective, set the measures. Thinnest first."}
        </p>
        {!empty && <Rollup {...rollup} />}
      </div>

      {empty ? (
        <div className="px-4 pt-6">
          <Hint>
            {scope === "project"
              ? "Nothing in flight to shape. Start a project on On Deck."
              : "No open bets to shape. Start one on On Deck."}
          </Hint>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-4 pt-4">
          {scope === "project"
            ? projects.map((l) => (
                <ProjectGroomCard
                  key={l.project.id}
                  d={d}
                  store={store}
                  lane={l}
                  hold={actionProps("project", l.project.id)}
                  onOpen={() => onOpenItem("project", l.project.id)}
                />
              ))
            : initiatives.map((l) => (
                <InitiativeGroomCard
                  key={l.initiative.id}
                  d={d}
                  store={store}
                  lane={l}
                  hold={actionProps("initiative", l.initiative.id)}
                  onOpen={() => onOpenItem("initiative", l.initiative.id)}
                />
              ))}
        </div>
      )}
      {sheet}
    </div>
  );
}

function countBy(mets: number[], total: number) {
  let ready = 0,
    grooming = 0,
    raw = 0;
  for (const m of mets) {
    if (m >= total) ready += 1;
    else if (m > 0) grooming += 1;
    else raw += 1;
  }
  return { ready, grooming, raw };
}

/** The desktop header's three-count read, at phone width. */
function Rollup({ ready, grooming, raw }: { ready: number; grooming: number; raw: number }) {
  const marks: { n: number; color: string; label: string }[] = [
    { n: ready, color: READY, label: "ready" },
    { n: grooming, color: CAUTION, label: "grooming" },
    { n: raw, color: "var(--line-strong)", label: "raw" },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {marks.map((m) => (
        <span key={m.label} className="flex items-center gap-1.5 text-caption">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
          <span style={{ color: m.n ? "var(--ink)" : "var(--muted)" }}>
            {m.n} {m.label}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── One project, shaped in place ─────────────────────────────────────────────
function ProjectGroomCard({
  d,
  store,
  lane,
  hold,
  onOpen,
}: {
  d: VerticalData;
  store: Store;
  lane: OnDeckLane;
  hold: Record<string, unknown>;
  onOpen: () => void;
}) {
  const p = lane.project;
  const accent = domainById(d, p.domainId)?.color ?? "var(--accent)";
  const steps = tasksOf(d, p.id).filter((t) => t.status !== "done");
  const axes = [lane.axes.defined, lane.axes.planned, lane.axes.fits === true];
  const met = axes.filter(Boolean).length;

  return (
    <GroomCard
      accent={accent}
      name={p.name}
      eyebrow={domainById(d, p.domainId)?.name ?? "no area"}
      met={met}
      total={3}
      dim={lane.readyTier === "parked"}
      hold={hold}
      onOpen={onOpen}
    >
      {/* Defined — the outcome line. Same field and same write as the record's,
          so a line typed here is the line you read there. */}
      <Field label="Outcome" met={lane.axes.defined}>
        {/* A <label> around the auto-growing field: one line of text computes to
            ~21px, so the writable band was half a thumb. The label gives the
            whole 44px row to the caret without drawing a box around it. */}
        <label className="tap-h flex flex-col justify-center">
          <AreaField
            className="text-body"
            style={{ caretColor: accent }}
            value={p.outcome}
            placeholder="What does done look like, in one line?"
            onCommit={(v) => store.updateProject(p.id, { outcome: v })}
          />
        </label>
      </Field>

      {/* Planned — the steps. The record's composer verbatim: free text in,
          structure out, a plain input so dictation works. */}
      <Field label={steps.length ? `Steps · ${steps.length}` : "Steps"} met={lane.axes.planned}>
        {steps.length > 0 && (
          <ul className="mb-1 flex flex-col gap-1">
            {steps.slice(0, 4).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-caption text-muted">
                <span className="shrink-0 text-meta" style={{ color: accent }}>
                  ◦
                </span>
                <span className="min-w-0 truncate">{t.title}</span>
              </li>
            ))}
            {steps.length > 4 && (
              <li className="pl-4 text-meta text-muted">+{steps.length - 4} more</li>
            )}
          </ul>
        )}
        <TaskComposer
          parent={{ projectId: p.id, initiativeId: p.initiativeId, domainId: p.domainId }}
          store={store}
          accent={accent}
          placeholder={steps.length ? "…and the next" : "First step…"}
        />
      </Field>
    </GroomCard>
  );
}

// ── One initiative, shaped in place ──────────────────────────────────────────
function InitiativeGroomCard({
  d,
  store,
  lane,
  hold,
  onOpen,
}: {
  d: VerticalData;
  store: Store;
  lane: InitiativeLane;
  hold: Record<string, unknown>;
  onOpen: () => void;
}) {
  const i = lane.initiative;
  const accent = domainById(d, i.domainId)?.color ?? "var(--accent)";
  const ax = initiativeReadinessAxes(d, i);
  const met = (ax.defined ? 1 : 0) + (ax.planned ? 1 : 0);

  return (
    <GroomCard
      accent={accent}
      name={i.name}
      eyebrow={domainById(d, i.domainId)?.name ?? "no area"}
      met={met}
      total={2}
      dim={lane.state === "parked"}
      hold={hold}
      onOpen={onOpen}
    >
      <Field label="Objective" met={ax.defined}>
        <label className="tap-h flex flex-col justify-center">
          <AreaField
            className="text-body"
            style={{ caretColor: accent }}
            value={i.outcome}
            placeholder="What does this bet win, in one line?"
            onCommit={(v) => store.updateInitiative(i.id, { outcome: v })}
          />
        </label>
        {/* "Defined" needs a finish line as well as a sentence, so the card says
            when one is missing rather than leaving the check quietly unmet. */}
        {!i.targetDate && (
          <button
            onClick={onOpen}
            className="tap-h fast mt-1 text-caption text-muted underline decoration-dotted underline-offset-2 active:text-accent"
          >
            No finish line yet — set a quarter
          </button>
        )}
      </Field>

      <Field label={i.keyResults.length ? `Key results · ${i.keyResults.length}` : "Key results"} met={ax.planned}>
        {i.keyResults.length > 0 && (
          <ul className="mb-1 flex flex-col gap-1">
            {i.keyResults.slice(0, 3).map((kr) => (
              <li key={kr.id} className="flex items-center gap-2 text-caption text-muted">
                <span className="shrink-0 text-meta" style={{ color: accent }}>
                  ◦
                </span>
                <span className="min-w-0 truncate">{kr.name || "Unnamed"}</span>
                <span className="mono ml-auto shrink-0 text-micro tabular-nums">
                  {kr.current}/{kr.target}
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={() => void store.addKeyResult(i.id)}
          className="tap fast mt-1 flex w-full items-center gap-3 rounded-xl border border-dashed border-line px-3 text-left"
        >
          <span className="shrink-0 text-body" style={{ color: accent }}>
            ＋
          </span>
          <span className="flex-1 py-2.5 text-body text-muted">
            {i.keyResults.length ? "Another number to move…" : "A number to move…"}
          </span>
        </button>
      </Field>
    </GroomCard>
  );
}

// ── The card frame — one shaped record ───────────────────────────────────────
function GroomCard({
  accent,
  name,
  eyebrow,
  met,
  total,
  dim,
  hold,
  onOpen,
  children,
}: {
  accent: string;
  name: string;
  eyebrow: string;
  met: number;
  total: number;
  dim?: boolean;
  hold: Record<string, unknown>;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  const color = tierColor(met, total);
  return (
    <div
      className="glass-card relative overflow-hidden rounded-xl border border-line"
      style={dim ? { opacity: 0.6 } : undefined}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
        style={{ background: accent }}
      />
      {/* The head is the tap path INTO the record; the fields below stay live
          inputs, so tapping one must not also navigate. */}
      <button
        onClick={onOpen}
        {...hold}
        className="tap fast flex w-full items-center gap-2.5 px-4 py-3 text-left active:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-meta uppercase text-muted" style={{ letterSpacing: "0.08em" }}>
            {eyebrow}
          </span>
          <span className="block truncate text-head font-medium text-ink">{name}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1" aria-label={`${met} of ${total} checks met`}>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full"
              style={i < met ? { background: color } : { border: `1px solid ${color}`, opacity: 0.5 }}
            />
          ))}
        </span>
        <span aria-hidden className="shrink-0 text-muted">
          ›
        </span>
      </button>
      <div className="flex flex-col gap-3 border-t border-line px-4 pb-3.5 pt-3">{children}</div>
    </div>
  );
}

/** One shaping field, with the check it closes marked beside its label. */
function Field({ label, met, children }: { label: string; met: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={met ? { background: READY } : { border: "1px solid var(--line-strong)" }}
        />
        <span className="section-label !p-0">{label}</span>
      </div>
      {children}
    </div>
  );
}
