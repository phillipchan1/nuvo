// Plan projects — the rail's Plan mode on the project deck (D-216,
// docs/offer-rules.md §4). Plan the week's walk at a slower clock: the deck's
// not-Ready projects, rawest first, one at a time, two phases each.
//
//   1 · Tasks   Nuvo drafts what's missing (Draft the path's engine, D-193),
//               you shape it in place, one press adds them: "Add 4 tasks to …".
//   2 · Weeks   the work becomes a span at your usual pace in that domain (a
//               named default when there's none), offered as at most two spans
//               with their cost named, plus Park it. Pointing at a span draws it
//               on the deck; pressing writes it through the deck's own move.
//
// It opens only from your press (the crown's line, or its card in the stack)
// and writes nothing until you press. Esc leaves. The deck mounts this in
// place of its pool rail — one mode at a time.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAllTasks, useTaskMutations } from "../../hooks/useTasks";
import type { Task } from "../../lib/types";
import { domainById, resolveDomainId, projectById, type Project, type VerticalData } from "../../lib/vertical";
import type { OnDeckLane } from "../../lib/onDeck";
import { askScaffold, type AskScaffold } from "../../lib/scaffoldAsk";
import { fetchOutcomeDraft } from "../../lib/outcomeDraft";
import { fmtMins } from "../../lib/now";
import {
  domainPace,
  lineMins,
  lookLast,
  spanOffers,
  spanWeeks,
  type Occupant,
  type PlanLine,
} from "../../lib/planProjects";
import { Button, Dot } from "../kit";
import { FlowHead } from "../rituals/FlowShell";
import { usePlanDraft } from "./usePlanDraft";
import { SpanChoice, TasksPhase, WalkFinished, WalkShell } from "./PlanWalk";

/** The one write of the tasks phase: the kept lines become backlog tasks on
 *  the project (and a typed outcome lands with them). */
export type AddPlannedTasks = (project: Project, lines: PlanLine[], outcome: string | null) => void;

export interface PlanProjectsProps {
  data: VerticalData;
  /** the placed lanes, as the deck read them */
  lanes: readonly OnDeckLane[];
  /** the walk, fixed when it opened */
  order: readonly string[];
  ready: number;
  total: number;
  /** the deck's first week */
  base: Date;
  /** where each placed project sits, in week indexes from `base` */
  occupants: readonly Occupant[];
  cap: number;
  width?: string | number;
  ask?: AskScaffold;
  /** Nuvo's outcome draft for a project with none (a stand-in in the harness) */
  draftOutcome?: (projectId: string) => Promise<string>;
  addTasks: AddPlannedTasks;
  /** the deck's own move: start week index + width in weeks */
  place: (project: Project, start: number, weeks: number) => void;
  park: (project: Project) => void;
  /** draw (or clear) the pointed-at span on the deck */
  onPreview: (p: { id: string; start: number; end: number } | null) => void;
  /** which project the walk is on — the deck lights its card */
  onWalk: (id: string | null) => void;
  onClose: () => void;
}

export default function PlanProjectsRail(props: PlanProjectsProps) {
  const { data, order: initial, ready, total, onClose, onWalk, onPreview } = props;
  const [order, setOrder] = useState<string[]>(() => [...initial]);
  const [settled, setSettled] = useState<Set<string>>(() => new Set());
  const [phase, setPhase] = useState<"tasks" | "weeks">("tasks");
  const [added, setAdded] = useState(0);
  const currentId = order.find((id) => !settled.has(id)) ?? null;
  const project = currentId ? projectById(data, currentId) ?? null : null;
  const picker = useRef<((i: number) => void) | null>(null);

  useEffect(() => {
    onWalk(project?.id ?? null);
  }, [project?.id, onWalk]);
  useEffect(() => () => onWalk(null), [onWalk]);

  const next = (id: string) => {
    onPreview(null);
    setSettled((s) => new Set(s).add(id));
    setPhase("tasks");
    setAdded(0);
  };
  const later = (id: string) => {
    onPreview(null);
    setOrder((o) => lookLast(o, id));
    setPhase("tasks");
    setAdded(0);
  };

  // keys: J looks at it last; 1 · 2 pick a span (Esc is the shell's)
  const live = useRef({ project, later, phase });
  live.current = { project, later, phase };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.matches("input, textarea") || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { project: p, later: l, phase: ph } = live.current;
      if (!p) return;
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        l(p.id);
      } else if (ph === "weeks" && (e.key === "1" || e.key === "2") && picker.current) {
        e.preventDefault();
        picker.current(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <WalkShell title="Plan projects" ready={ready} total={total} width={props.width} onClose={onClose}>
      {!project ? (
        <WalkFinished ready={ready} total={total} onClose={onClose} />
      ) : phase === "tasks" ? (
        <TasksStep
          key={project.id}
          {...props}
          project={project}
          onCommitted={(mins) => {
            setAdded(mins);
            setPhase("weeks");
          }}
          onLater={() => later(project.id)}
        />
      ) : (
        <WeeksStep
          key={project.id}
          {...props}
          project={project}
          added={added}
          picker={picker}
          onSettled={() => next(project.id)}
          onLater={() => later(project.id)}
        />
      )}
    </WalkShell>
  );
}

function useStepFacts(data: VerticalData, project: Project) {
  const domain = domainById(data, project.domainId);
  const domainName = domain?.name ?? "this area";
  // The work already on it — open tasks, as context (not editable here).
  const existing = useMemo(
    () => data.tasks.filter((t) => t.projectId === project.id && t.status !== "done").map((t) => ({ id: t.id, title: t.title, mins: t.durationMins || 0 })),
    [data.tasks, project.id],
  );
  return { domain, domainName, existing };
}

function StepHead({ data, project, phase }: { data: VerticalData; project: Project; phase: "tasks" | "weeks" }) {
  const domain = domainById(data, project.domainId);
  return (
    <FlowHead
      kicker={
        <span className="inline-flex items-center gap-1.5">
          <Dot color={domain?.color ?? "var(--accent)"} />
          {domain?.name ?? "No area"}
        </span>
      }
      hero={project.name}
      fact={phase === "tasks" ? "First, the tasks." : "Then, the weeks."}
    />
  );
}

function TasksStep({
  data,
  project,
  ask = askScaffold,
  draftOutcome = (id: string) => fetchOutcomeDraft("project", id),
  addTasks,
  onCommitted,
  onLater,
}: PlanProjectsProps & { project: Project; onCommitted: (mins: number) => void; onLater: () => void }) {
  const { domainName, existing } = useStepFacts(data, project);
  // Finished work in the same domain — what Draft the path sizes from.
  const finished = useMemo(
    () =>
      data.tasks
        .filter(
          (t) =>
            t.status === "done" &&
            t.durationMins > 0 &&
            resolveDomainId(t.domainId, t.projectId, t.initiativeId, (id) => projectById(data, id)?.domainId, (id) => data.initiatives.find((i) => i.id === id)?.domainId) ===
              project.domainId,
        )
        .map((t) => ({ title: t.title, duration_minutes: t.durationMins })),
    [data, project.domainId],
  );
  const noHistory = finished.length === 0;
  const [outcome, setOutcome] = useState("");
  const hasOutcome = project.outcome.trim() !== "";
  // A project with no outcome can't be Ready: Nuvo proposes one (the deck's
  // own outcome drafter). A failure is quiet — the field is still yours.
  const [suggested, setSuggested] = useState<string | null>(null);
  // The drafter by ref: a default argument is a new function every render,
  // and the request must run once per project, not once per render.
  const drafter = useRef(draftOutcome);
  drafter.current = draftOutcome;
  useEffect(() => {
    if (hasOutcome) return;
    let live = true;
    setSuggested(null);
    drafter.current(project.id).then(
      (t) => live && setSuggested(t),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [project.id, hasOutcome]);
  // No outcome and no history: no draft, just the add line (§4).
  const draft = usePlanDraft({ projectId: project.id, canDraft: hasOutcome || !noHistory, noHistory, finished }, ask);
  return (
    <>
      <StepHead data={data} project={project} phase="tasks" />
      {hasOutcome && <p className="pw-said">{project.outcome}</p>}
      <TasksPhase
        projectName={project.name}
        domainName={domainName}
        noHistory={noHistory}
        existing={existing}
        draft={draft}
        outcome={hasOutcome ? null : { value: outcome, set: setOutcome, suggested, onDraft: () => void draft.draft(`The outcome: ${outcome.trim()}`) }}
        onCommit={() => {
          const lines = draft.lines;
          const typed = !hasOutcome && outcome.trim() ? outcome.trim() : null;
          if (lines.length || typed) addTasks(project, lines, typed);
          onCommitted(existing.reduce((sum, t) => sum + t.mins, 0) + lineMins(lines));
        }}
        onLater={onLater}
      />
    </>
  );
}

function WeeksStep({
  data,
  lanes,
  project,
  added,
  base,
  occupants,
  cap,
  place,
  park,
  onPreview,
  picker,
  onSettled,
  onLater,
}: PlanProjectsProps & {
  project: Project;
  added: number;
  picker: React.MutableRefObject<((i: number) => void) | null>;
  onSettled: () => void;
  onLater: () => void;
}) {
  const { domain, domainName, existing } = useStepFacts(data, project);
  const lane = lanes.find((l) => l.project.id === project.id) ?? null;
  // The tasks just added may not be in `data` yet: `added` is the work the
  // tasks phase left on the project (what was there + what it added).
  const pace = domainPace(domain ?? { name: domainName });
  const haveNow = existing.reduce((s, t) => s + t.mins, 0);
  const totalMins = Math.max(haveNow, added);
  const weeks = spanWeeks(totalMins, pace.minsPerWeek);
  const self = occupants.find((o) => o.id === project.id);
  const earliest = Math.max(0, self?.start ?? 0);
  const offers = spanOffers({ base, id: project.id, domainId: project.domainId, weeks, earliest, others: occupants, cap });
  const pick = (i: number) => {
    const o = offers[i];
    if (!o) return;
    onPreview(null);
    place(project, o.start, o.weeks);
    onSettled();
  };
  picker.current = pick;
  useEffect(() => () => void (picker.current = null), [picker]);
  return (
    <>
      <StepHead data={data} project={project} phase="weeks" />
      <p className="f-fact">
        {totalMins > 0 ? (
          <>
            {fmtMins(totalMins)} of work {pace.said}: {weeks === 1 ? "one week" : `${weeks} weeks`}.
          </>
        ) : (
          <>No tasks yet, so one week holds it.</>
        )}
      </p>
      {lane?.readyTier === "ready" && <p className="pw-said">Ready.</p>}
      <div className="grid gap-3">
        {offers.map((o, i) => (
          <SpanChoice
            key={`${o.start}:${o.weeks}`}
            verb="Place"
            name={o.label}
            cost={o.cost}
            reason={o.reason}
            primary={i === 0}
            shortcut={offers.length > 1 ? String(i + 1) : undefined}
            onPick={() => pick(i)}
            onPoint={(on) => onPreview(on ? { id: project.id, start: o.start, end: o.start + o.weeks - 1 } : null)}
          />
        ))}
      </div>
      <div className="grid gap-1.5">
        <Button
          size="sm"
          kind="ghost"
          full
          onClick={() => {
            onPreview(null);
            park(project);
            onSettled();
          }}
          title="Off the deck until you resume it"
        >
          Park it
        </Button>
        <Button size="sm" kind="ghost" full shortcut="J" onClick={onLater}>
          Look at it last
        </Button>
      </div>
    </>
  );
}

/** The live write: Draft the path's own write (`mutations.create`, a backlog
 *  row on the project, never a week — P2), one Undo for the lot. */
export function useLiveAddTasks(updateOutcome: (p: Project, outcome: string) => void): AddPlannedTasks {
  const mutations = useTaskMutations();
  const { data: all } = useAllTasks();
  return (project, lines, outcome) => {
    if (outcome) updateOutcome(project, outcome);
    if (!lines.length) return;
    const top = Math.max(0, ...(all ?? []).filter((t) => t.project_id === project.id).map((t) => t.sort_order ?? 0));
    const made: Promise<Task>[] = lines.map((l, i) =>
      mutations.create(
        {
          title: l.title,
          duration_minutes: l.mins,
          project_id: project.id,
          initiative_id: project.initiativeId ?? null,
          domain_id: project.domainId ?? null,
          status: "backlog",
          sort_order: top + i + 1,
          clientId: crypto.randomUUID(),
        },
        { undo: false, label: `Added — ${l.title}` },
      ),
    );
    const n = lines.length;
    toast(`Added ${n} task${n === 1 ? "" : "s"} to ${project.name}. None went on a week.`, {
      action: {
        label: "Undo",
        onClick: () => void Promise.all(made).then((ts) => ts.forEach((t) => mutations.trash(t, { undo: false }))),
      },
    });
  };
}

/** The rail over the live writer — what the deck mounts outside a harness. */
export function LivePlanProjectsRail(props: Omit<PlanProjectsProps, "addTasks"> & { updateOutcome: (p: Project, outcome: string) => void }) {
  const { updateOutcome, ...rest } = props;
  const addTasks = useLiveAddTasks(updateOutcome);
  return <PlanProjectsRail {...rest} addTasks={addTasks} />;
}
