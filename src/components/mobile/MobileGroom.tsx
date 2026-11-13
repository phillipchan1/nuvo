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
import GroomingSessionAction from "../floors/GroomingSessionAction";
import { AreaField, TaskComposer, type Store } from "./detail/verticalDetail";
import SkeletonRows from "./Skeleton";
import { useRecordActions } from "./MobileRecordActions";
import { Button, Card, Readiness, type ReadinessStep } from "../kit";
import { Icon } from "../Icon";
import { PhEmpty } from "./touch";

// Same horizon the desktop groom wall reads over — grooming looks further out
// than the phone's six-week deck, because shaping runs ahead of placing.
const HORIZON = 8;

/** How shaped a record is, as the kit's readiness pie (raw → ⅓ → ⅔ → ready).
 *  An initiative has two checks, so one of two reads as the ⅔ step's half-way. */
function pieStep(met: number, total: number): ReadinessStep {
  if (met >= total) return 3;
  return Math.min(2, Math.round((met / total) * 3)) as ReadinessStep;
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

  // No hero here: the top bar already names the place, and the face switch
  // names the face. The page opens on its one read — how shaped the open work
  // is — and then the work itself, thinnest first.
  return (
    <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto fab-clear">
      {empty ? (
        <PhEmpty icon="check">Nothing to shape</PhEmpty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
            <Rollup {...rollup} />
            <div className="ml-auto">
              <GroomingSessionAction kind={scope} />
            </div>
          </div>
        <div className="flex flex-col gap-3 px-4 pt-3">
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
        </>
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

/** The desktop header's three-count read, at phone width — each count beside
 *  the readiness pie it counts, so the cards below read without a legend. */
function Rollup({ ready, grooming, raw }: { ready: number; grooming: number; raw: number }) {
  const marks: { n: number; step: ReadinessStep; label: string }[] = [
    { n: ready, step: 3, label: "ready" },
    { n: grooming, step: 1, label: "grooming" },
    { n: raw, step: 0, label: "raw" },
  ];
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1">
      {marks.map((m) => (
        <span key={m.label} className="flex items-center gap-1.5 text-caption tabular-nums">
          <Readiness step={m.step} title={m.label} />
          <span className={m.n ? "font-semibold text-ink" : "text-[var(--faint)]"}>{m.n}</span>
          <span className="text-muted">{m.label}</span>
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
            placeholder="Done looks like…"
            onCommit={(v) => store.updateProject(p.id, { outcome: v })}
          />
        </label>
      </Field>

      {/* Planned — the steps. The record's composer verbatim: free text in,
          structure out, a plain input so dictation works. */}
      <Field label={steps.length ? `Steps · ${steps.length}` : "Steps"} met={lane.axes.planned}>
        {steps.length > 0 && (
          <ul className="mb-1 flex flex-col">
            {steps.slice(0, 4).map((t) => (
              <li key={t.id} className="flex min-h-7 items-center gap-2.5 text-body text-[var(--ink-2)]">
                <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
                <span className="min-w-0 truncate">{t.title}</span>
              </li>
            ))}
            {steps.length > 4 && (
              <li className="pl-3.5 text-caption tabular-nums text-muted">+{steps.length - 4} more</li>
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
            placeholder="This bet wins…"
            onCommit={(v) => store.updateInitiative(i.id, { outcome: v })}
          />
        </label>
        {/* "Defined" needs a finish line as well as a sentence, so the card says
            when one is missing rather than leaving the check quietly unmet. */}
        {!i.targetDate && (
          <Button
            size="sm"
            kind="ghost"
            onClick={onOpen}
            icon={<Icon name="calendar" size={14} />}
            className="tap-bloom -ml-2.5 mt-1"
          >
            Set a finish line
          </Button>
        )}
      </Field>

      <Field label={i.keyResults.length ? `Key results · ${i.keyResults.length}` : "Key results"} met={ax.planned}>
        {i.keyResults.length > 0 && (
          <ul className="mb-1 flex flex-col">
            {i.keyResults.slice(0, 3).map((kr) => (
              <li key={kr.id} className="flex min-h-7 items-center gap-2.5 text-body text-[var(--ink-2)]">
                <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
                <span className="min-w-0 truncate">{kr.name || "Unnamed"}</span>
                <span className="ml-auto shrink-0 text-caption tabular-nums text-muted">
                  {kr.current}/{kr.target}
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => void store.addKeyResult(i.id)}
          className="fast mt-1 flex h-11 w-full items-center gap-2 rounded-[var(--r-card)] border border-[var(--line-2)] px-3 text-left text-body text-muted"
        >
          <Icon name="plus" size={16} className="shrink-0" style={{ color: accent }} />
          Add a key result
        </button>
      </Field>
    </GroomCard>
  );
}

// ── The card frame — one shaped record ───────────────────────────────────────
// The kit Card at thumb scale. The record's mark rides its left edge (the same
// 3px spine the deck card wears); the head is the tap into the record and
// carries its readiness pie; the fields below stay live inputs.
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
  return (
    <Card className="ph-card relative overflow-hidden !gap-0 !p-0" style={dim ? { opacity: 0.6 } : undefined}>
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-3 left-1.5 top-3 w-[3px] rounded-[2px]"
        style={{ background: accent }}
      />
      {/* The head is the tap path INTO the record; the fields below stay live
          inputs, so tapping one must not also navigate. */}
      <button
        type="button"
        onClick={onOpen}
        {...hold}
        className="row-hover fast flex min-h-14 w-full items-center gap-3 py-3 pl-5 pr-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-caption text-muted">{eyebrow}</span>
          <span className="block truncate text-head font-semibold text-ink">{name}</span>
        </span>
        <span className="flex shrink-0">
          <Readiness step={pieStep(met, total)} title={`${met} of ${total} checks met`} />
        </span>
        <Icon name="chevron-right" size={16} className="shrink-0 text-[var(--faint)]" />
      </button>
      <div className="flex flex-col gap-4 border-t border-[var(--line-1)] pb-4 pl-5 pr-4 pt-3">{children}</div>
    </Card>
  );
}

/** One shaping field, with the check it closes marked beside its name — met
 *  is a tick in the verdict colour, missing is an empty ring. */
function Field({ label, met, children }: { label: string; met: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-caption font-semibold text-muted">
        {met ? (
          <Icon name="check" size={13} strokeWidth={2.25} style={{ color: READY }} />
        ) : (
          <span className="mx-[3px] h-[7px] w-[7px] shrink-0 rounded-full border-[1.5px] border-[var(--line-2)]" aria-hidden />
        )}
        <span>{label}</span>
        <span className="sr-only">{met ? "(met)" : "(missing)"}</span>
      </div>
      {children}
    </div>
  );
}
