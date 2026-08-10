// The Record modal — a project or initiative's command centre, and the ONLY
// single-record surface for both (neither rung has a full page).
//
// ── The shape, and why ───────────────────────────────────────────────────────
// ONE skeleton at both altitudes: identity → the work → the Log, with a rail of
// standing beside it. A project and a bet are the same object at two clock
// speeds (D-048), so the two records may differ in what fills the slots, never
// in their frame.
//
//   1. ONE SPINE. Every control hangs in a 26px gutter so the section label,
//      every row and every composer share one left edge. Three ragged left edges
//      — label, composer-box padding, checkbox — was most of what read as
//      "disjointed".
//   2. ONE INPUT IDIOM. Tasks, key results, projects and the Log all compose
//      through the same hairline row with a glyph in the gutter. There used to be
//      three (a raised card, a bordered row, a filled box).
//   3. THE RULE IS THE METER. The hairline under each section heading fills to
//      the domain hue — progress drawn, not dialled. It replaces the 54px ring,
//      which was a second hero beside the masthead AND meant two different things
//      (ticked tasks for a project, KR attainment for a bet, silently falling
//      back to child progress with no KRs — an undisclosed basis switch,
//      Principle 6).
//   4. PLACEMENT, NOT DATES. `start ▸ … → target ▸ …` in a muted strip was the
//      only thing deciding which sprint column a project occupies on On Deck,
//      rendered smaller than a task's duration. D-030 decided a record "opens on
//      a scale of the next four sprints… not two date fields"; only the phone
//      ever got it. Now both shells wear `PlacementBand`.
//   5. THE RAIL IS ANNOTATION. Its every enclosure and every saturated colour is
//      gone — no bordered chips, no fills, no chroma — and it rests at 78%,
//      coming full on approach. Weight has to follow importance, and the work is
//      what the reader came for; the rail only helps them place it.
//
// The old footer (Delete · Assess · Done) is gone with the meta strip: `esc`,
// the scrim and ✕ all close, so a mulberry "Done" was the loudest thing on a
// sheet where `--accent` is supposed to mean *your intent*. Delete and status
// live in the ··· overflow, where a destructive act belongs.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useVertical } from "../../hooks/useVertical";
import {
  domainById,
  initiativeById,
  initiativeAttainment,
  isStatusOverride,
  isProjectComplete,
  projectById,
  projectProgress,
  projectsOf,
  tasksOf,
  type KeyResult,
  type Momentum,
  type Project,
  type ProjectStatus,
} from "../../lib/vertical";
import { projectReadinessAxes } from "../../lib/lenses";
import { weekName } from "../../lib/week";
import { ProjectShipAssess, type LeftoverVerdict } from "./ShipAssess";
import { suggestForInitiative, suggestForProject, type Suggestion } from "../../lib/belonging";
import {
  DeleteBtn,
  DomainPicker,
  FloatingMenu,
  InitiativePicker,
  InlineNumber,
  InlineText,
  PROJECT_STATUS_COLORS,
  ProjectAttachPicker,
} from "../floors/parts";
import TaskList, { isTypingIn } from "../floors/TaskList";
import DeckCard, { deckWeight } from "../ondeck/DeckCard";
import { ShipStamp } from "../ShipStamp";
import { QuarterBand, WeekBand } from "./PlacementBand";
import { RecordLog } from "./RecordLog";
import { AssessLayer, type AssessFinding } from "./AssessLayer";
import {
  Body,
  GUT,
  GUT_PAD,
  Head,
  IconBtn,
  MenuItem,
  RailSec,
  ReadyTicks,
  RecordScrim,
  Sec,
  Sheet,
  useRecordKeys,
} from "./recordFrame";

export type RecordKind = "project" | "initiative";

export default function RecordModal({
  kind,
  id,
  onClose,
  onOpenProject,
  onOpenInitiative,
}: {
  kind: RecordKind;
  id: string;
  onClose: () => void;
  onOpenProject: (id: string) => void;
  onOpenInitiative: (id: string) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useRecordKeys(sheetRef, onClose);

  return (
    <RecordScrim onClose={onClose}>
      {kind === "project" ? (
        <ProjectRecord sheetRef={sheetRef} id={id} onClose={onClose} onOpenInitiative={onOpenInitiative} />
      ) : (
        <InitiativeRecord sheetRef={sheetRef} id={id} onClose={onClose} onOpenProject={onOpenProject} />
      )}
    </RecordScrim>
  );
}

/** "Belongs here" — the loose work that looks like it wants a home. A count, a
 *  title and a ＋. The explainer line, the reason line and the "+ fold in" link
 *  became a badge and a tooltip. */
function Suggestions({ suggestions, onFold }: { suggestions: Suggestion[]; onFold: (taskId: string) => void }) {
  if (suggestions.length === 0) return null; // a silence, not an apology (D-035)
  return (
    <RailSec label="Belongs here" right={<span className="mono text-meta font-semibold text-muted opacity-80">{suggestions.length}</span>}>
      <div>
        {suggestions.map((s) => (
          <div key={s.task.id} className="flex items-center gap-2 border-b border-line py-1.5 last:border-b-0">
            <span
              className="min-w-0 flex-1 text-meta leading-snug text-muted"
              style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
              title={s.reasons.join(" · ")}
            >
              {s.task.title || "Untitled"}
            </span>
            <button
              onClick={() => onFold(s.task.id)}
              title="Fold it in"
              aria-label="Fold it in"
              className="fast flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-caption text-muted opacity-70 hover:bg-surface hover:text-accent hover:opacity-100"
            >
              ＋
            </button>
          </div>
        ))}
      </div>
    </RailSec>
  );
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  backlog: "Idea",
  in_progress: "In motion",
  waiting: "Waiting",
  cancelled: "Cancelled",
  complete: "Shipped",
};

const MOMENTUM_LABEL: Record<Momentum, string> = { up: "↑ Rising", flat: "→ Steady", down: "↓ Stalled" };

// ── Project record ───────────────────────────────────────────────────────────
function ProjectRecord({
  id,
  onClose,
  onOpenInitiative,
  sheetRef,
}: {
  id: string;
  onClose: () => void;
  onOpenInitiative: (id: string) => void;
  sheetRef: RefObject<HTMLDivElement>;
}) {
  const store = useVertical();
  const { data, updateProject, updateTask, deleteProject, routeTask } = store;
  const project = projectById(data, id);
  const [assessing, setAssessing] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [grooming, setGrooming] = useState(false);
  const [menu, setMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const taskRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLTextAreaElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);

  // t = tasks · c = comments · s = sprint. Bare letters, gated on "not typing".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const target = k === "t" ? taskRef.current : k === "c" || k === "l" ? logRef.current : k === "s" ? bandRef.current : null;
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!project) onClose();
  }, [project, onClose]);
  if (!project) return null;

  const applyAssess = (f: AssessFinding) => {
    if (!f.patch) return;
    if (f.patch.kind === "outcome" && f.patch.outcome) updateProject(project.id, { outcome: f.patch.outcome });
    else if (f.patch.kind === "title" && f.patch.title && f.anchor.startsWith("task:")) {
      updateTask(f.anchor.slice(5), { title: f.patch.title });
    }
  };

  const domain = domainById(data, project.domainId);
  const initiative = initiativeById(data, project.initiativeId);
  const domains = [...data.domains].sort((a, b) => a.sort - b.sort);
  // An initiative lives in one domain (D-073's cascade rule), so the picker
  // only ever offers ones that could actually hold this project.
  const domainInitiatives = data.initiatives
    .filter((i) => i.domainId === project.domainId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const accent = domain?.color ?? "var(--accent)";
  const tasks = tasksOf(data, project.id);
  const done = tasks.filter((t) => t.status === "done").length;
  const openMins = tasks.filter((t) => t.status !== "done").reduce((s, t) => s + (t.durationMins || 0), 0);
  const suggestions = suggestForProject(data, project);
  const axes = projectReadinessAxes(data, project, new Date());
  const manual = isStatusOverride(project.storedStatus);
  const shipped = isProjectComplete(project.status);

  const setStatus = (s: ProjectStatus) => {
    setMenu(false);
    if (s === "complete") setShipping(true);
    else updateProject(project.id, { status: s });
  };

  return (
    <Sheet variant="marked" spine={accent} wide={assessing} sheetRef={sheetRef}>
      <Head
        crumbs={
          <>
            {/* Routing this to the right area is a primary act, not a crumb —
                it used to be set at the same weight as the text beside it. */}
            <DomainPicker
              domains={domains}
              value={project.domainId}
              size="lg"
              onChange={(domainId) => {
                // An initiative lives in one domain — crossing domains detaches
                // the project, or it stays nested under the old bet.
                const init = initiativeById(data, project.initiativeId);
                const crossDomain = Boolean(init && init.domainId !== domainId);
                updateProject(project.id, { domainId, ...(crossDomain ? { initiativeId: null, keyResultId: null } : {}) });
              }}
            />
            {(initiative || domainInitiatives.length > 0) && (
              <>
                <span className="text-meta text-muted">›</span>
                <InitiativePicker
                  initiatives={domainInitiatives}
                  value={project.initiativeId}
                  size="lg"
                  onOpen={onOpenInitiative}
                  onChange={(initiativeId) => updateProject(project.id, { initiativeId })}
                />
              </>
            )}
          </>
        }
        acts={
          <span className="flex items-center gap-0.5">
            <IconBtn glyph="✦" label="Assess — have Nuvo review this and show where to sharpen it" onClick={() => setAssessing(true)} />
            <span className="mx-1 h-3.5 w-px bg-line" />
            <IconBtn glyph="···" label="Groom, status, delete" btnRef={menuRef} onClick={() => setMenu((o) => !o)} />
            <IconBtn glyph="✕" label="Close" onClick={onClose} />
            <FloatingMenu open={menu} anchorRef={menuRef} align="right" minWidth={170} onClose={() => setMenu(false)}>
              <MenuItem onClick={() => { setGrooming(true); setMenu(false); }}>
                <span style={{ color: accent }}>✦</span> Groom the steps
              </MenuItem>
              <div className="my-1 h-px bg-line" />
              <MenuItem onClick={() => setStatus("waiting")} color={PROJECT_STATUS_COLORS.waiting}>Mark waiting</MenuItem>
              <MenuItem onClick={() => setStatus("cancelled")} color={PROJECT_STATUS_COLORS.cancelled}>Mark cancelled</MenuItem>
              <MenuItem onClick={() => setStatus("complete")} color={PROJECT_STATUS_COLORS.complete}>Ship it…</MenuItem>
              {manual && <MenuItem onClick={() => setStatus("in_progress")}>↺ Back to auto</MenuItem>}
              <div className="my-1 h-px bg-line" />
              <div className="px-2.5 py-1">
                <DeleteBtn what="project" onDelete={() => { deleteProject(project.id); onClose(); }} />
              </div>
            </FloatingMenu>
          </span>
        }
        name={project.name}
        onName={(v) => updateProject(project.id, { name: v })}
        titlePrefix={
          <button
            onClick={() => (shipped ? updateProject(project.id, { status: "in_progress" }) : setShipping(true))}
            aria-label={shipped ? "Reopen project" : "Ship project — mark complete"}
            title={shipped ? "Shipped — tap to reopen" : "Finished — ship it"}
            className="group/chk fast mt-[5px] flex h-[22px] w-[22px] shrink-0 items-center justify-center"
          >
            <ShipStamp shipped={shipped} size={22} />
          </button>
        }
        outcome={project.outcome}
        onOutcome={(v) => updateProject(project.id, { outcome: v })}
        outcomePlaceholder="What does done look like, in one line?"
      />

      <Body
        assessing={assessing}
        scrollRef={scrollRef}
        main={
          <>
            <Sec
              label="Tasks"
              spine={accent}
              fill={projectProgress(data, project)}
              meter={tasks.length ? `${done}/${tasks.length}${openMins ? ` · ${deckWeight(openMins)}` : ""}` : null}
            >
              <div data-assess-anchor="tasks">
                <TaskList
                  tasks={tasks}
                  parent={{ projectId: project.id, initiativeId: project.initiativeId, domainId: project.domainId }}
                  accent={accent}
                  spine
                  keyboardNav
                  composerRef={taskRef}
                  refining={grooming}
                  onRefining={setGrooming}
                />
              </div>
            </Sec>

            <Sec label="Comments" spine={accent}>
              <RecordLog kind="project" id={project.id} accent={accent} spine composerRef={logRef} />
            </Sec>
          </>
        }
        overlay={
          assessing && (
            <AssessLayer
              kind="project"
              id={project.id}
              scrollRef={scrollRef}
              accent={accent}
              onAccept={applyAssess}
              onExit={() => setAssessing(false)}
            />
          )
        }
        rail={
          assessing ? null : (
            <>
              <WeekBand p={project} store={store} color={accent} bandRef={bandRef} />
              <ReadyTicks
                axes={[
                  { label: "Outcome", met: project.outcome.trim() !== "" },
                  { label: "Steps", met: axes.planned },
                ]}
              />
              <Suggestions suggestions={suggestions} onFold={(taskId) => routeTask(taskId, { projectId: project.id })} />
            </>
          )
        }
      />

      {shipping && <ProjectShipAssess id={project.id} onClose={() => setShipping(false)} onShipped={(_v: LeftoverVerdict | null) => onClose()} />}
    </Sheet>
  );
}

// ── Initiative record ────────────────────────────────────────────────────────
function krPct(kr: KeyResult) {
  if (kr.target === kr.baseline) return kr.current >= kr.target ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((kr.current - kr.baseline) / (kr.target - kr.baseline)) * 100)));
}

/** The project composer, on the same spine as everything else. */
function ProjectComposer({
  domainId,
  initiativeId,
  addProject,
  onOpenProject,
  accent,
  inputRef,
}: {
  domainId: string;
  initiativeId: string;
  addProject: (domainId: string, initiativeId: string | null, init?: Partial<Project>) => Promise<Project>;
  onOpenProject: (id: string) => void;
  accent: string;
  inputRef: RefObject<HTMLInputElement>;
}) {
  const [draft, setDraft] = useState("");

  const submit = (open = false) => {
    const name = draft.trim();
    if (!name) return;
    void addProject(domainId, initiativeId, { name }).then((p) => { if (open) onOpenProject(p.id); });
    setDraft("");
    inputRef.current?.focus();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const names = e.clipboardData
      .getData("text")
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-*•\d.)\]]+\s*/, "").trim())
      .filter(Boolean);
    if (names.length < 2) return;
    e.preventDefault();
    names.forEach((name) => void addProject(domainId, initiativeId, { name }));
    setDraft("");
    inputRef.current?.focus();
  };

  return (
    <div className="flex items-center" style={{ minHeight: 36 }}>
      <span className={`flex shrink-0 items-center text-body ${GUT}`} style={{ color: accent }}>＋</span>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(e.metaKey || e.ctrlKey); }
          if (e.key === "Escape") { e.stopPropagation(); setDraft(""); e.currentTarget.blur(); }
        }}
        onPaste={onPaste}
        placeholder="Add a project… ⌘↵ to open it"
        className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted"
        style={{ caretColor: accent }}
      />
    </div>
  );
}

function InitiativeRecord({
  id,
  onClose,
  onOpenProject,
  sheetRef,
}: {
  id: string;
  onClose: () => void;
  onOpenProject: (id: string) => void;
  sheetRef: RefObject<HTMLDivElement>;
}) {
  const store = useVertical();
  const {
    data, updateInitiative, deleteInitiative, addProject, updateProject,
    addKeyResult, updateKeyResult, deleteKeyResult, routeTask,
  } = store;
  const initiative = initiativeById(data, id);
  const [assessing, setAssessing] = useState(false);
  const [menu, setMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const projRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLTextAreaElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const [krFocus, setKrFocus] = useState(0);

  // p = projects · l = log · q = quarter · k = add a key result.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") { e.preventDefault(); addKeyResult(id); setKrFocus((n) => n + 1); return; }
      const target = k === "p" ? projRef.current : k === "c" || k === "l" ? logRef.current : k === "q" ? bandRef.current : null;
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addKeyResult, id]);

  useEffect(() => {
    if (!initiative) onClose();
  }, [initiative, onClose]);
  if (!initiative) return null;

  const domain = domainById(data, initiative.domainId);
  const accent = domain?.color ?? "var(--accent)";
  const domains = [...data.domains].sort((a, b) => a.sort - b.sort);

  const applyAssess = (f: AssessFinding) => {
    if (!f.patch) return;
    if (f.patch.kind === "outcome" && f.patch.outcome) updateInitiative(initiative.id, { outcome: f.patch.outcome });
    else if (f.patch.kind === "kr" && f.anchor.startsWith("kr:")) {
      const krId = f.anchor.slice(3);
      const p: Record<string, unknown> = {};
      if (f.patch.name != null) p.name = f.patch.name;
      if (f.patch.baseline != null && !Number.isNaN(f.patch.baseline)) p.baseline = f.patch.baseline;
      if (f.patch.target != null && !Number.isNaN(f.patch.target)) p.target = f.patch.target;
      if (f.patch.unit != null) p.unit = f.patch.unit;
      if (Object.keys(p).length) updateKeyResult(initiative.id, krId, p);
    }
  };
  const changeDomain = (domainId: string) => {
    updateInitiative(initiative.id, { domainId });
    projectsOf(data, initiative.id).forEach((p) => updateProject(p.id, { domainId }));
  };

  const projects = projectsOf(data, initiative.id);
  // The downward half of linking a project ↔ initiative: any other project
  // that could actually join this bet (same domain — D-073's cascade rule —
  // and not already here). Includes projects reparenting from another bet.
  const attachable = data.projects
    .filter((p) => p.domainId === initiative.domainId && p.initiativeId !== initiative.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const suggestions = suggestForInitiative(data, initiative);
  const attainment = initiative.keyResults.length ? initiativeAttainment(data, initiative) : null;
  const childPct = projects.length
    ? Math.round(projects.reduce((s, p) => s + projectProgress(data, p), 0) / projects.length)
    : 0;
  const shipped = isProjectComplete(initiative.status);

  return (
    <Sheet variant="bounded" spine={accent} wide={assessing} sheetRef={sheetRef}>
      <Head
        crumbs={<DomainPicker domains={domains} value={initiative.domainId} size="lg" onChange={changeDomain} />}
        acts={
          <span className="flex items-center gap-0.5">
            <IconBtn glyph="✦" label="Assess — have Nuvo review this and show where to sharpen it" onClick={() => setAssessing(true)} />
            <span className="mx-1 h-3.5 w-px bg-line" />
            <IconBtn glyph="···" label="Momentum, status, delete" btnRef={menuRef} onClick={() => setMenu((o) => !o)} />
            <IconBtn glyph="✕" label="Close" onClick={onClose} />
            <FloatingMenu open={menu} anchorRef={menuRef} align="right" minWidth={170} onClose={() => setMenu(false)}>
              {(["up", "flat", "down"] as Momentum[]).map((m) => (
                <MenuItem key={m} onClick={() => { updateInitiative(initiative.id, { momentum: m }); setMenu(false); }}>
                  {MOMENTUM_LABEL[m]}
                  {initiative.momentum === m && <span className="ml-2 text-micro opacity-60">✓</span>}
                </MenuItem>
              ))}
              <div className="my-1 h-px bg-line" />
              {(["waiting", "cancelled", "complete"] as ProjectStatus[]).map((s) => (
                <MenuItem
                  key={s}
                  color={PROJECT_STATUS_COLORS[s]}
                  onClick={() => { updateInitiative(initiative.id, { status: s }); setMenu(false); }}
                >
                  Mark {STATUS_LABEL[s].toLowerCase()}
                </MenuItem>
              ))}
              <div className="my-1 h-px bg-line" />
              <div className="px-2.5 py-1">
                <DeleteBtn what="initiative" onDelete={() => { deleteInitiative(initiative.id); onClose(); }} />
              </div>
            </FloatingMenu>
          </span>
        }
        name={initiative.name}
        onName={(v) => updateInitiative(initiative.id, { name: v })}
        titlePrefix={
          // A bet outweighs a project (D-048's "scope reads as mass") — the same
          // stamp as ProjectRecord's, just bigger, so a shipped initiative
          // visibly carries more weight at rest.
          <button
            onClick={() => updateInitiative(initiative.id, { status: shipped ? "in_progress" : "complete" })}
            aria-label={shipped ? "Reopen initiative" : "Ship initiative — mark complete"}
            title={shipped ? "Shipped — tap to reopen" : "Finished — ship it"}
            className="group/chk fast mt-[3px] flex h-[26px] w-[26px] shrink-0 items-center justify-center"
          >
            <ShipStamp shipped={shipped} size={26} />
          </button>
        }
        outcome={initiative.outcome}
        onOutcome={(v) => updateInitiative(initiative.id, { outcome: v })}
        outcomePlaceholder="The outcome, one inspiring line — not a task"
      />

      <Body
        assessing={assessing}
        scrollRef={scrollRef}
        main={
          <>
            {/* The Objective used to head this section as its own block; it's now
                the record's lead line, where an outcome belongs at every altitude. */}
            <div data-assess-anchor="objective" />

            <Sec
              label="Key results"
              spine={accent}
              fill={attainment ?? 0}
              meter={attainment != null ? `${attainment}%` : null}
            >
              {initiative.keyResults.map((kr, i) => (
                <div
                  key={kr.id}
                  data-assess-anchor={`kr:${kr.id}`}
                  className="group fast -mx-2 rounded-[var(--radius-sm)] border-b border-line px-2 py-2 last:border-b-0 hover:bg-accent-soft/40"
                >
                  <div className="flex items-center">
                    <span className={`shrink-0 text-meta text-muted ${GUT}`}>◇</span>
                    <InlineText
                      value={kr.name}
                      onChange={(v) => updateKeyResult(initiative.id, kr.id, { name: v })}
                      placeholder="What number moves?"
                      autoFocusEmpty={i === initiative.keyResults.length - 1 && krFocus > 0}
                      className="min-w-0 flex-1 text-body font-medium"
                    />
                    <span className="mono shrink-0 pl-3 text-meta text-muted">{krPct(kr)}%</span>
                    <span className="ml-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                      <DeleteBtn what="result" onDelete={() => deleteKeyResult(initiative.id, kr.id)} />
                    </span>
                  </div>
                  <div className={`mt-1.5 flex items-center gap-3 ${GUT_PAD}`}>
                    <span className="mono flex shrink-0 items-center gap-1 text-meta text-muted">
                      <InlineNumber value={kr.baseline} onChange={(v) => updateKeyResult(initiative.id, kr.id, { baseline: v })} />
                      <span className="opacity-50">→</span>
                      <span style={{ color: accent }}>
                        <InlineNumber value={kr.current} onChange={(v) => updateKeyResult(initiative.id, kr.id, { current: v })} />
                      </span>
                      <span className="opacity-50">→</span>
                      <InlineNumber value={kr.target} onChange={(v) => updateKeyResult(initiative.id, kr.id, { target: v })} />
                      <InlineText
                        value={kr.unit}
                        onChange={(v) => updateKeyResult(initiative.id, kr.id, { unit: v })}
                        placeholder="unit"
                        className="ml-0.5 w-10"
                      />
                    </span>
                    <span className="h-0.5 flex-1 rounded-full" style={{ background: "var(--line)" }}>
                      <span
                        className="fast block h-full rounded-full"
                        style={{ width: `${krPct(kr)}%`, background: accent }}
                      />
                    </span>
                  </div>
                </div>
              ))}
              <div className="flex items-center" style={{ minHeight: 36 }}>
                <span className={`flex shrink-0 items-center text-body ${GUT}`} style={{ color: accent }}>＋</span>
                <button
                  onClick={() => { addKeyResult(initiative.id); setKrFocus((n) => n + 1); }}
                  className="fast flex-1 text-left text-body text-muted hover:text-ink"
                >
                  Add a key result…
                </button>
              </div>
            </Sec>

            <Sec
              label="Projects feeding it"
              spine={accent}
              fill={childPct}
              meter={projects.length ? `${projects.length} · ${childPct}%` : null}
            >
              {/* The same card the deck behind this modal shows — one object, not
                  a bespoke tile in a half-empty two-column grid. */}
              {projects.map((p) => {
                const pAxes = projectReadinessAxes(data, p, new Date());
                const pOpen = tasksOf(data, p.id).filter((t) => t.status !== "done");
                const pDomain = domainById(data, p.domainId);
                return (
                  <div key={p.id} data-assess-anchor={`project:${p.id}`} className="mt-2">
                    <DeckCard
                      variant="marked"
                      spine={pDomain?.color ?? accent}
                      eyebrow={pDomain?.name ?? "—"}
                      title={p.name}
                      weight={deckWeight(pOpen.reduce((s, t) => s + (t.durationMins || 0), 0))}
                      status={
                        p.status === "complete"
                          ? { label: "shipped", tone: "ready" }
                          : p.targetDate
                            ? { label: weekName(new Date(p.targetDate + "T12:00:00")), tone: "muted" }
                            : null
                      }
                      pips={p.status === "complete" ? undefined : [pAxes.defined, pAxes.planned, pAxes.fits ?? true]}
                      pipTone="muted"
                      dim={p.status === "cancelled"}
                      shipped={p.status === "complete"}
                      className="cursor-pointer"
                      onClick={() => onOpenProject(p.id)}
                    />
                  </div>
                );
              })}
              <div className="mt-1">
                <ProjectComposer
                  domainId={initiative.domainId}
                  initiativeId={initiative.id}
                  addProject={addProject}
                  onOpenProject={onOpenProject}
                  accent={accent}
                  inputRef={projRef}
                />
              </div>
              <div className={GUT_PAD}>
                <ProjectAttachPicker
                  candidates={attachable}
                  accent={accent}
                  onAttach={(projectId) => updateProject(projectId, { initiativeId: initiative.id })}
                />
              </div>
            </Sec>

            <Sec label="Comments" spine={accent}>
              <RecordLog kind="initiative" id={initiative.id} accent={accent} spine composerRef={logRef} />
            </Sec>
          </>
        }
        overlay={
          assessing && (
            <AssessLayer
              kind="initiative"
              id={initiative.id}
              scrollRef={scrollRef}
              accent={accent}
              onAccept={applyAssess}
              onExit={() => setAssessing(false)}
            />
          )
        }
        rail={
          assessing ? null : (
            <>
              <QuarterBand i={initiative} store={store} color={accent} bandRef={bandRef} />
              <ReadyTicks
                axes={[
                  { label: "Objective", met: initiative.outcome.trim() !== "" },
                  { label: "A number moving", met: initiative.keyResults.length > 0 },
                ]}
              />
              <Suggestions
                suggestions={suggestions}
                onFold={(taskId) => routeTask(taskId, { projectId: null, initiativeId: initiative.id })}
              />
            </>
          )
        }
      />
    </Sheet>
  );
}
