// The Record modal — a project or initiative's command centre, and the ONLY
// single-record surface for both (neither rung has a full page).
//
// ── The shape, and why ───────────────────────────────────────────────────────
// The DOCUMENT layout (D-190, recordFrame.tsx): a 48px bar (Domain /
// Initiative / Name · ⋯ · ✕), a main column (the name as the one hero, the
// outcome as its lead, then the work and its comments) and a property panel.
// A project and a bet are the same object at two clock speeds (D-048), so the
// two records differ in what fills the slots, never in their frame.
//
//   1. EVERY PROPERTY IS A ROW whose value opens its picker — status, domain,
//      initiative, placement, target, momentum. Nothing that files the record
//      lives in the main column, and nothing in the main column is a form.
//   2. PLACEMENT, NOT DATES. The Week / Quarter property opens `PlacementBand`,
//      the scale of the next four sprints D-030 decided a record opens on.
//      The exact target date is its own row, for the finish line that isn't
//      week-shaped.
//   3. PROGRESS IS DRAWN ONCE — the Pace row is the same `PaceTrack` the week
//      crowns use: pieces done in the domain's hue, the pace tick where the
//      record's span stands today (D-187). No second meter on the page.
//   4. ONE HERO. The name is 30px; the sections are kit SectionHeaders.
//
// Delete and Assess live in the ⋯ overflow, where an occasional act belongs;
// `esc`, the scrim and ✕ all close, so there is no Done button.

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { format, parseISO } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useSettings, firstDayOfWeek } from "../../hooks/useSettings";
import {
  domainById,
  initiativeById,
  initiativeAttainment,
  isStatusOverride,
  isProjectComplete,
  projectById,
  projectProgress,
  projectsOf,
  redealSortOrder,
  tasksOf,
  type KeyResult,
  type Momentum,
  type Project,
  type ProjectStatus,
} from "../../lib/vertical";
import { initiativeReadinessAxes, projectReadinessAxes } from "../../lib/lenses";
import { weekName } from "../../lib/week";
import { sprintSpanWeeks } from "../../lib/onDeck";
import { quarterName } from "../../lib/initiativeDeck";
import { spanElapsed, deckWeight } from "../../lib/pace";
import { ProjectShipAssess, type LeftoverVerdict } from "./ShipAssess";
import { suggestForInitiative, suggestForProject, type Suggestion } from "../../lib/belonging";
import {
  DeleteBtn,
  DomainPicker,
  FloatingMenu,
  InitiativePicker,
  InlineNumber,
  InlineText,
  ProjectAttachPicker,
} from "../floors/parts";
import TaskList, { isTypingIn } from "../floors/TaskList";
import DeckCard from "../ondeck/DeckCard";
import { QuarterBand, WeekBand } from "./PlacementBand";
import { RecordLog } from "./RecordLog";
import type { TaskComposerHandle } from "../tasks/TaskComposer";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useAllTasks, useTaskMutations } from "../../hooks/useTasks";
import { useRecurrenceMutations, useRecurrences } from "../../hooks/useRecurrence";
import { useLabels } from "../../hooks/useCalendar";
import type { Task } from "../../lib/types";
import { Icon } from "../Icon";
import {
  Button,
  Dot,
  IconButton,
  Menu,
  MenuItem as KitMenuItem,
  MenuSeparator,
  MiniMonth,
  PaceTrack,
  Property,
  Readiness,
  SectionHeader,
  type ReadinessStep,
} from "../kit";

const TaskPopover = lazy(() => import("../SlideOver").then((m) => ({ default: m.TaskPopover })));
import { AssessLayer, type AssessFinding } from "./AssessLayer";
import {
  Bar,
  Body,
  Head,
  IconBtn,
  MenuItem,
  PopProp,
  PropSlot,
  ReadyTicks,
  RecordScrim,
  Sec,
  Sheet,
  readinessStep,
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
 *  title and a ＋; the reasons ride the tooltip. */
function Suggestions({ suggestions, onFold }: { suggestions: Suggestion[]; onFold: (taskId: string) => void }) {
  if (suggestions.length === 0) return null; // a silence, not an apology (D-035)
  return (
    <>
      <div className="doc-props-sep" />
      <SectionHeader title="Belongs here" count={suggestions.length} />
      {suggestions.map((s) => (
        <div key={s.task.id} className="doc-suggest" title={s.reasons.join(" · ")}>
          <span>{s.task.title || "Untitled"}</span>
          <IconButton size="xs" label="Fold it in" icon={<Icon name="plus" size={12} />} onClick={() => onFold(s.task.id)} />
        </div>
      ))}
    </>
  );
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  backlog: "Idea",
  in_progress: "In motion",
  waiting: "Waiting",
  cancelled: "Cancelled",
  complete: "Shipped",
};

const MOMENTUM_LABEL: Record<Momentum, string> = { up: "Rising", flat: "Steady", down: "Stalled" };
const MOMENTUM_GLYPH: Record<Momentum, string> = { up: "↑", flat: "→", down: "↓" };

/** A property whose value opens a kit Menu (status, momentum). */
function MenuProp({ label, value, children }: { label: string; value: ReactNode; children: ReactNode }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="k-prop">
      <span className="k-prop-label">{label}</span>
      <button ref={btn} type="button" className="k-prop-value" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {value}
      </button>
      <Menu anchor={btn.current} open={open} onClose={() => setOpen(false)} placement="left-start" label={label}>
        {children}
      </Menu>
    </div>
  );
}

/** The finish line: a date you pick on a month, or clear. */
function TargetProp({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  const { settings } = useSettings();
  const date = value ? parseISO(value) : null;
  return (
    <PopProp
      label="Target"
      empty={!date}
      value={
        <>
          <Icon name="calendar" size={14} style={{ color: "var(--muted)" }} />
          {date ? format(date, "EEE, MMM d") : "Set target"}
        </>
      }
    >
      {(close) => (
        <div className="doc-place">
          <MiniMonth
            value={date}
            weekStartsOn={firstDayOfWeek(settings)}
            onChange={(d) => {
              onChange(format(d, "yyyy-MM-dd"));
              close();
            }}
          />
          {date && (
            <div className="flex justify-end px-1 pt-1">
              <Button
                kind="ghost"
                size="xs"
                onClick={() => {
                  onChange(null);
                  close();
                }}
              >
                Clear
              </Button>
            </div>
          )}
        </div>
      )}
    </PopProp>
  );
}

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
  const [weekOpen, setWeekOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const taskRef = useRef<TaskComposerHandle>(null);
  const logRef = useRef<HTMLTextAreaElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const recordTask = useRecordTask();

  // t = tasks · c = comments · s = sprint. Bare letters, gated on "not typing".
  // With a row under the task list's cursor, `t` is that row's When menu —
  // the list spends the key first and marks it. `s` opens the Week property
  // and hands the band the keys (← → walk it, ⇧ resizes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isTypingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        setWeekOpen(true);
        requestAnimationFrame(() => requestAnimationFrame(() => bandRef.current?.focus()));
        return;
      }
      const target = k === "t" ? taskRef.current : k === "c" || k === "l" ? logRef.current : null;
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Don't snap the sheet shut the instant the row is missing. Create used to
  // race a refetch that hadn't seen the insert yet, which closed the record
  // and took the new tasks with it. Give the optimistic row a beat to land;
  // if this was a delete, DeleteBtn already called onClose.
  useEffect(() => {
    if (project) return;
    const t = window.setTimeout(onClose, 800);
    return () => window.clearTimeout(t);
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
  const step: ReadinessStep = shipped ? "shipped" : readinessStep([axes.defined, axes.planned, axes.fits ?? true]);
  const placedAt = project.startDate ?? project.targetDate;
  const span = sprintSpanWeeks(project);
  const weight = deckWeight(openMins);

  const setStatus = (s: ProjectStatus) => {
    if (s === "complete") setShipping(true);
    else updateProject(project.id, { status: s });
  };

  return (
    <Sheet wide={assessing} sheetRef={sheetRef} label={project.name || "Project"}>
      <Bar
        trail={[
          <>
            <Dot color={accent} />
            {domain?.name ?? "No domain"}
          </>,
          initiative && (
            <button type="button" className="doc-crumb-link" onClick={() => onOpenInitiative(initiative.id)}>
              {initiative.name}
            </button>
          ),
          project.name || "Untitled",
        ]}
        actions={
          <>
            <Button
              size="sm"
              icon={<Icon name={shipped ? "refresh" : "check"} size={14} />}
              onClick={() => (shipped ? updateProject(project.id, { status: "in_progress" }) : setShipping(true))}
              title={shipped ? "Shipped — reopen it" : "Finished — ship it"}
            >
              {shipped ? "Reopen" : "Ship"}
            </Button>
            <IconBtn glyph="···" label="Assess, groom, delete" btnRef={menuRef} onClick={() => setMenu((o) => !o)} />
            <IconBtn glyph="✕" label="Close" onClick={onClose} />
            <FloatingMenu open={menu} anchorRef={menuRef} align="right" minWidth={200} onClose={() => setMenu(false)}>
              <div className="doc-menu">
                <MenuItem icon={<Icon name="sparkles" size={14} />} onClick={() => { setAssessing(true); setMenu(false); }}>
                  Assess with Nuvo
                </MenuItem>
                <MenuItem icon={<Icon name="sparkles" size={14} />} onClick={() => { setGrooming(true); setMenu(false); }}>
                  Groom the steps
                </MenuItem>
                <div className="k-msep" />
                <div className="doc-menu-del">
                  <DeleteBtn what="project" onDelete={() => { deleteProject(project.id); onClose(); }} />
                </div>
              </div>
            </FloatingMenu>
          </>
        }
      />

      <Body
        assessing={assessing}
        scrollRef={scrollRef}
        main={
          <>
            <Head
              name={project.name}
              onName={(v) => updateProject(project.id, { name: v })}
              outcome={project.outcome}
              onOutcome={(v) => updateProject(project.id, { outcome: v })}
              outcomePlaceholder="What does done look like, in one line?"
            />

            <Sec
              label="Tasks"
              count={tasks.length ? `${done}/${tasks.length}${weight ? ` · ${weight}` : ""}` : undefined}
              onAdd={() => taskRef.current?.focus()}
              addLabel="Add a task (T)"
            >
              <div data-assess-anchor="tasks">
                <TaskList
                  tasks={tasks}
                  parent={{ projectId: project.id, initiativeId: project.initiativeId, domainId: project.domainId }}
                  accent={accent}
                  spine
                  keyboardNav={!recordTask.openId}
                  composerRef={taskRef}
                  refining={grooming}
                  onRefining={setGrooming}
                  onOpenTask={recordTask.open}
                />
                {recordTask.openId && (
                  <RecordTaskPopover taskId={recordTask.openId} anchor={recordTask.anchor} onClose={recordTask.close} />
                )}
              </div>
            </Sec>

            <Sec label="Comments">
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
        props={
          assessing ? null : (
            <>
              <MenuProp
                label="Status"
                value={
                  <>
                    <Readiness step={step} />
                    {STATUS_LABEL[project.status]}
                  </>
                }
              >
                <KitMenuItem checked={project.status === "waiting"} onSelect={() => setStatus("waiting")}>
                  Waiting
                </KitMenuItem>
                <KitMenuItem checked={project.status === "cancelled"} onSelect={() => setStatus("cancelled")}>
                  Cancelled
                </KitMenuItem>
                <KitMenuItem checked={shipped} onSelect={() => setStatus("complete")}>
                  Ship it…
                </KitMenuItem>
                {manual && (
                  <>
                    <MenuSeparator />
                    <KitMenuItem icon={<Icon name="refresh" size={14} />} onSelect={() => setStatus("in_progress")}>
                      Back to auto
                    </KitMenuItem>
                  </>
                )}
              </MenuProp>
              {/* Routing this to the right area is a primary act — the shared
                  picker, dressed as the property's value. */}
              <PropSlot label="Domain">
                <DomainPicker
                  domains={domains}
                  value={project.domainId}
                  size="lg"
                  align="right"
                  onChange={(domainId) => {
                    // An initiative lives in one domain — crossing domains detaches
                    // the project, or it stays nested under the old bet.
                    const init = initiativeById(data, project.initiativeId);
                    const crossDomain = Boolean(init && init.domainId !== domainId);
                    updateProject(project.id, { domainId, ...(crossDomain ? { initiativeId: null, keyResultId: null } : {}) });
                  }}
                />
              </PropSlot>
              <PropSlot label="Initiative">
                {initiative || domainInitiatives.length > 0 ? (
                  <InitiativePicker
                    initiatives={domainInitiatives}
                    value={project.initiativeId}
                    size="lg"
                    align="right"
                    onOpen={onOpenInitiative}
                    onChange={(initiativeId) => updateProject(project.id, { initiativeId })}
                  />
                ) : (
                  <span className="doc-prop-empty">None</span>
                )}
              </PropSlot>
              <PopProp
                label="Week"
                empty={!placedAt}
                open={weekOpen}
                onOpenChange={setWeekOpen}
                value={
                  <>
                    <Icon name="clock" size={14} style={{ color: "var(--muted)" }} />
                    {placedAt ? `${weekName(placedAt)}${span > 1 ? ` · ${span}w` : ""}` : "Not placed"}
                  </>
                }
              >
                {() => (
                  <div className="doc-place">
                    <WeekBand p={project} store={store} color={accent} bandRef={bandRef} />
                  </div>
                )}
              </PopProp>
              <TargetProp value={project.targetDate} onChange={(targetDate) => updateProject(project.id, { targetDate })} />
              <Property label="Pace" empty={tasks.length === 0}>
                {tasks.length ? (
                  <>
                    <PaceTrack
                      done={done}
                      total={tasks.length}
                      color={accent}
                      elapsed={shipped ? null : spanElapsed(project, new Date())}
                      width={120}
                    />
                    <span className="text-caption tabular-nums text-muted">
                      {done}/{tasks.length}
                    </span>
                  </>
                ) : (
                  "No tasks"
                )}
              </Property>

              <div className="doc-props-sep" />
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

/** The project composer — the same row shape as every add line on the page. */
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
    <div className="doc-compose">
      <Icon name="plus" size={14} />
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(e.metaKey || e.ctrlKey); }
          if (e.key === "Escape") { e.stopPropagation(); setDraft(""); e.currentTarget.blur(); }
        }}
        onPaste={onPaste}
        placeholder="Add a project"
        aria-label="Add a project (⌘↵ opens it)"
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
    addKeyResult, updateKeyResult, deleteKeyResult, routeTask, reorderProjects,
  } = store;
  const initiative = initiativeById(data, id);
  const [assessing, setAssessing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [quarterOpen, setQuarterOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const projRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLTextAreaElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const [krFocus, setKrFocus] = useState(0);
  const projListRef = useRef<HTMLDivElement>(null);
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [projReorderLineTop, setProjReorderLineTop] = useState<number | null>(null);
  const projTargetIndexRef = useRef(0);

  // p = projects · l = log · q = quarter · k = add a key result.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") { e.preventDefault(); addKeyResult(id); setKrFocus((n) => n + 1); return; }
      if (k === "q") {
        e.preventDefault();
        setQuarterOpen(true);
        requestAnimationFrame(() => requestAnimationFrame(() => bandRef.current?.focus()));
        return;
      }
      const target = k === "p" ? projRef.current : k === "c" || k === "l" ? logRef.current : null;
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addKeyResult, id]);

  useEffect(() => {
    if (initiative) return;
    const t = window.setTimeout(onClose, 800);
    return () => window.clearTimeout(t);
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

  // Drag the grip to reorder the projects feeding this bet — pointer events
  // (Tauri's webview swallows HTML5 DnD), same shape as TaskList's own.
  const startReorderProject = (e: React.PointerEvent, pid: string) => {
    if (projects.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    setDragProjectId(pid);
    document.body.classList.add("wb-noselect");
    const insertLineTop = (clientY: number) => {
      const list = projListRef.current;
      if (!list) return null;
      const rows = [...list.querySelectorAll<HTMLElement>("[data-project-id]")].filter(
        (r) => r.getAttribute("data-project-id") !== pid,
      );
      let k = 0;
      for (const r of rows) {
        const b = r.getBoundingClientRect();
        if (clientY > b.top + b.height / 2) k++;
      }
      projTargetIndexRef.current = k;
      const contTop = list.getBoundingClientRect().top;
      if (!rows.length) return 0;
      if (k < rows.length) return rows[k].getBoundingClientRect().top - contTop;
      return rows[rows.length - 1].getBoundingClientRect().bottom - contTop;
    };
    setProjReorderLineTop(insertLineTop(e.clientY));
    const move = (ev: PointerEvent) => setProjReorderLineTop(insertLineTop(ev.clientY));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("wb-noselect");
      setDragProjectId(null);
      setProjReorderLineTop(null);
      const ids = projects.map((p) => p.id);
      const from = ids.indexOf(pid);
      const to = projTargetIndexRef.current;
      if (from < 0) return;
      const next = [...ids];
      next.splice(from, 1);
      next.splice(Math.max(0, Math.min(to, next.length)), 0, pid);
      if (next.some((x, i) => x !== ids[i])) {
        const entries = redealSortOrder(projects, next);
        if (entries.length) reorderProjects(entries);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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
  const axes = initiativeReadinessAxes(data, initiative);
  const step: ReadinessStep = shipped ? "shipped" : readinessStep([axes.defined, axes.planned]);
  // The needle, not the activity: KR attainment when there is a number to move,
  // the projects' progress otherwise — and the row says which.
  const pace = attainment ?? (projects.length ? childPct : null);

  return (
    <Sheet wide={assessing} sheetRef={sheetRef} label={initiative.name || "Initiative"}>
      <Bar
        trail={[
          <>
            <Dot color={accent} />
            {domain?.name ?? "No domain"}
          </>,
          initiative.name || "Untitled",
        ]}
        actions={
          <>
            <Button
              size="sm"
              icon={<Icon name={shipped ? "refresh" : "check"} size={14} />}
              onClick={() => updateInitiative(initiative.id, { status: shipped ? "in_progress" : "complete" })}
              title={shipped ? "Shipped — reopen it" : "Finished — ship it"}
            >
              {shipped ? "Reopen" : "Ship"}
            </Button>
            <IconBtn glyph="···" label="Assess, delete" btnRef={menuRef} onClick={() => setMenu((o) => !o)} />
            <IconBtn glyph="✕" label="Close" onClick={onClose} />
            <FloatingMenu open={menu} anchorRef={menuRef} align="right" minWidth={200} onClose={() => setMenu(false)}>
              <div className="doc-menu">
                <MenuItem icon={<Icon name="sparkles" size={14} />} onClick={() => { setAssessing(true); setMenu(false); }}>
                  Assess with Nuvo
                </MenuItem>
                <div className="k-msep" />
                <div className="doc-menu-del">
                  <DeleteBtn what="initiative" onDelete={() => { deleteInitiative(initiative.id); onClose(); }} />
                </div>
              </div>
            </FloatingMenu>
          </>
        }
      />

      <Body
        assessing={assessing}
        scrollRef={scrollRef}
        main={
          <>
            <Head
              name={initiative.name}
              onName={(v) => updateInitiative(initiative.id, { name: v })}
              outcome={initiative.outcome}
              onOutcome={(v) => updateInitiative(initiative.id, { outcome: v })}
              outcomePlaceholder="The outcome, one inspiring line — not a task"
            />
            {/* The Objective used to head its own block; it's the record's lead
                line now, where an outcome belongs at every altitude. */}
            <div data-assess-anchor="objective" />

            <Sec
              label="Key results"
              count={attainment != null ? `${attainment}%` : undefined}
              onAdd={() => { addKeyResult(initiative.id); setKrFocus((n) => n + 1); }}
              addLabel="Add a key result (K)"
            >
              {initiative.keyResults.map((kr, i) => (
                <div key={kr.id} data-assess-anchor={`kr:${kr.id}`} className="doc-kr" style={{ ["--h" as string]: accent }}>
                  <div className="doc-kr-top">
                    <Icon name="arrow-right" size={14} style={{ color: "var(--faint)" }} />
                    <InlineText
                      value={kr.name}
                      onChange={(v) => updateKeyResult(initiative.id, kr.id, { name: v })}
                      placeholder="What number moves?"
                      autoFocusEmpty={i === initiative.keyResults.length - 1 && krFocus > 0}
                      className="doc-kr-name"
                    />
                    <span className="doc-kr-pct">{krPct(kr)}%</span>
                    <span className="doc-kr-del">
                      <DeleteBtn what="result" onDelete={() => deleteKeyResult(initiative.id, kr.id)} />
                    </span>
                  </div>
                  <div className="doc-kr-line">
                    <span className="doc-kr-nums">
                      <InlineNumber value={kr.baseline} onChange={(v) => updateKeyResult(initiative.id, kr.id, { baseline: v })} />
                      <span aria-hidden>→</span>
                      <span className="text-ink">
                        <InlineNumber value={kr.current} onChange={(v) => updateKeyResult(initiative.id, kr.id, { current: v })} />
                      </span>
                      <span aria-hidden>→</span>
                      <InlineNumber value={kr.target} onChange={(v) => updateKeyResult(initiative.id, kr.id, { target: v })} />
                      <InlineText
                        value={kr.unit}
                        onChange={(v) => updateKeyResult(initiative.id, kr.id, { unit: v })}
                        placeholder="unit"
                        className="ml-0.5 w-10"
                      />
                    </span>
                    <span className="doc-kr-track" aria-hidden>
                      <span style={{ width: `${krPct(kr)}%` }} />
                    </span>
                  </div>
                </div>
              ))}
              {initiative.keyResults.length === 0 && (
                <div className="doc-compose">
                  <Icon name="plus" size={14} />
                  <button
                    type="button"
                    className="doc-compose-btn"
                    onClick={() => { addKeyResult(initiative.id); setKrFocus((n) => n + 1); }}
                  >
                    Add a key result
                  </button>
                </div>
              )}
            </Sec>

            <Sec
              label="Projects"
              count={projects.length ? `${projects.length} · ${childPct}%` : undefined}
              onAdd={() => projRef.current?.focus()}
              addLabel="Add a project (P)"
            >
              {/* The same card the deck behind this modal shows — one object, not
                  a bespoke tile. */}
              <div ref={projListRef} className="relative">
                {projReorderLineTop != null && (
                  <div className="reorder-insert-line" style={{ top: projReorderLineTop }} aria-hidden />
                )}
                {projects.map((p) => {
                  const pAxes = projectReadinessAxes(data, p, new Date());
                  const pOpen = tasksOf(data, p.id).filter((t) => t.status !== "done");
                  const pDomain = domainById(data, p.domainId);
                  const dragging = dragProjectId === p.id;
                  return (
                    <div
                      key={p.id}
                      data-assess-anchor={`project:${p.id}`}
                      data-project-id={p.id}
                      className="mt-2"
                      style={dragging ? { opacity: 0.6 } : undefined}
                    >
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
                        className=""
                        onClick={() => onOpenProject(p.id)}
                      >
                        {projects.length > 1 && (
                          <span
                            onPointerDown={(e) => startReorderProject(e, p.id)}
                            className="absolute right-2 top-2 z-10 cursor-grab touch-none select-none rounded-[var(--r-chip)] px-1 text-micro leading-none text-muted opacity-0 transition-opacity group-hover/card:opacity-100 active:cursor-grabbing"
                            title="Drag to reorder"
                            aria-hidden
                          >
                            ⠿
                          </span>
                        )}
                      </DeckCard>
                    </div>
                  );
                })}
              </div>
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
              <div className="pl-[22px]">
                <ProjectAttachPicker
                  candidates={attachable}
                  accent={accent}
                  onAttach={(projectId) => updateProject(projectId, { initiativeId: initiative.id })}
                />
              </div>
            </Sec>

            <Sec label="Comments">
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
        props={
          assessing ? null : (
            <>
              <MenuProp
                label="Status"
                value={
                  <>
                    <Readiness step={step} title={shipped ? "Shipped" : `${[axes.defined, axes.planned].filter(Boolean).length} of 2 set`} />
                    {STATUS_LABEL[initiative.status]}
                  </>
                }
              >
                {(["waiting", "cancelled", "complete"] as ProjectStatus[]).map((s) => (
                  <KitMenuItem key={s} checked={initiative.status === s} onSelect={() => updateInitiative(initiative.id, { status: s })}>
                    {STATUS_LABEL[s]}
                  </KitMenuItem>
                ))}
              </MenuProp>
              <PropSlot label="Domain">
                <DomainPicker domains={domains} value={initiative.domainId} size="lg" align="right" onChange={changeDomain} />
              </PropSlot>
              <PopProp
                label="Quarter"
                empty={!initiative.targetDate}
                open={quarterOpen}
                onOpenChange={setQuarterOpen}
                value={
                  <>
                    <Icon name="clock" size={14} style={{ color: "var(--muted)" }} />
                    {initiative.targetDate ? quarterName(new Date(initiative.targetDate + "T12:00:00")) : "Not placed"}
                  </>
                }
              >
                {() => (
                  <div className="doc-place">
                    <QuarterBand i={initiative} store={store} color={accent} bandRef={bandRef} />
                  </div>
                )}
              </PopProp>
              <TargetProp value={initiative.targetDate} onChange={(targetDate) => updateInitiative(initiative.id, { targetDate })} />
              <MenuProp label="Momentum" value={<>{MOMENTUM_GLYPH[initiative.momentum]} {MOMENTUM_LABEL[initiative.momentum]}</>}>
                {(["up", "flat", "down"] as Momentum[]).map((m) => (
                  <KitMenuItem key={m} checked={initiative.momentum === m} onSelect={() => updateInitiative(initiative.id, { momentum: m })}>
                    {`${MOMENTUM_GLYPH[m]} ${MOMENTUM_LABEL[m]}`}
                  </KitMenuItem>
                ))}
              </MenuProp>
              <Property label="Pace" empty={pace == null} title={attainment != null ? "Key results attained" : "Projects' progress"}>
                {pace != null ? (
                  <>
                    <PaceTrack
                      done={pace}
                      total={100}
                      color={accent}
                      elapsed={shipped ? null : spanElapsed(initiative, new Date())}
                      width={120}
                    />
                    <span className="text-caption tabular-nums text-muted">{pace}%</span>
                  </>
                ) : (
                  "Nothing to measure"
                )}
              </Property>

              <div className="doc-props-sep" />
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

/**
 * A task opened from a record's list. It rides the record as a sub-overlay
 * (`overlaySubId`, the same slot the slot popover uses), so the record stays
 * open underneath, back / Escape close the task first, and a reload lands on
 * both.
 */
function useRecordTask() {
  const { nav, openSlotTask, closeOverlay } = useAppNavigation();
  const [anchor, setAnchor] = useState<{ rect: DOMRect; el: HTMLElement | null } | null>(null);
  const open = (t: Task, rect: DOMRect, el: HTMLElement | null) => {
    setAnchor({ rect, el });
    openSlotTask(t.id);
  };
  return { openId: nav.overlaySubId, anchor, open, close: closeOverlay };
}

function RecordTaskPopover({
  taskId,
  anchor,
  onClose,
}: {
  taskId: string;
  anchor: { rect: DOMRect; el: HTMLElement | null } | null;
  onClose: () => void;
}) {
  const { data: all } = useAllTasks();
  const { labels } = useLabels();
  const mutations = useTaskMutations();
  const recurrenceMutations = useRecurrenceMutations();
  const { data: recurrences = [] } = useRecurrences();
  const task = all?.find((t) => t.id === taskId) ?? null;
  if (!task) return null;
  const rect = anchor?.rect ?? new DOMRect(window.innerWidth / 2 - 20, window.innerHeight / 2 - 20, 40, 40);
  return (
    // The marker tells the record's Escape to let this close first.
    <div data-nested-surface="">
      <Suspense fallback={null}>
        <TaskPopover
          task={task}
          anchor={rect}
          anchorEl={anchor?.el ?? null}
          labels={labels}
          mutations={mutations}
          recurrence={task.recurrence_id ? (recurrences.find((r) => r.id === task.recurrence_id) ?? null) : null}
          recurrenceMutations={recurrenceMutations}
          onClose={onClose}
          raised
        />
      </Suspense>
    </div>
  );
}
