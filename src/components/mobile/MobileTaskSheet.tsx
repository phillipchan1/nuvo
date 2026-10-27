import { useEffect, useMemo, useRef, useState } from "react";
import type { Label, Task } from "../../lib/types";
import { DEFAULT_DURATION_MINUTES, DURATION_PRESETS, ruleOf } from "../../lib/types";
import type { useTaskMutations } from "../../hooks/useTasks";
import type { useVertical } from "../../hooks/useVertical";
import { useRecurrenceMutations, useRecurrences } from "../../hooks/useRecurrence";
import { todayISO, tomorrowISO, nextWeekISO, fmtDuration, parseDateISO } from "../../lib/dates";
import { domainById, initiativeById, isProjectComplete, projectById, taskDomainId, taskInitiativeId } from "../../lib/vertical";
import type { RecurrenceRule } from "../../lib/recurrence";
import { RepeatControl } from "../RecurrencePicker";
import ReminderSelect from "../ReminderSelect";
import TaskNotes from "../TaskNotes";
import TaskSteps from "../TaskSteps";
import Sheet from "./Sheet";
import { at, span } from "./dayPlan";
import { useSettings } from "../../hooks/useSettings";
import DomainSymbol from "../domain/DomainSymbol";
import { Icon } from "../Icon";
import {
  ActionRow,
  AutoText,
  Chip,
  ChipGrid,
  DestructiveRow,
  FactRow,
  MetaDot,
  PickSheet,
  RowList,
  SHEET_BODY,
  SHEET_SCROLL,
  SheetMast,
  SheetSection,
  dayWord,
  useSheetTitle,
} from "./sheetKit";

type Mutations = ReturnType<typeof useTaskMutations>;
type Vertical = ReturnType<typeof useVertical>["data"];

/** Explicit triage on phone — toast is the only undo path (no ⌘Z). */
const TRIAGE_UNDO = { undo: "toast" as const };

// The ONE phone surface for a task — the mobile stand-in for the desktop's
// anchored task popover. A Today row, a project's work, a slot's child, a block
// on the Day canvas: every tap on a task opens THIS (D-111, "one grammar per
// noun"). A block on the calendar used to open a second, thinner "Task block"
// sheet with an "Edit task" door into this one; the only thing it had that this
// lacked — taking the task back off the calendar — is a row here now.
//
// Order is what a thumb does in the first five seconds: finish it, move it, read
// or add the words (steps, notes) — and only then the properties, as hairline
// rows. The words used to sit two screens down, under eight duration chips, a
// Remind box and a chip for every project in the account.
export default function MobileTaskSheet({
  task,
  labels,
  vertical,
  mutations,
  accent,
  onClose,
  onAskNuvo,
}: {
  task: Task;
  labels: Label[];
  vertical: Vertical;
  mutations: Mutations;
  accent?: string | null;
  onClose: () => void;
  onAskNuvo?: (seed: string, say?: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const done = task.status === "done";
  const currentLabels = new Set((task.task_labels ?? []).map((tl) => tl.label_id));
  const [showDatePick, setShowDatePick] = useState(false);
  const [picker, setPicker] = useState<"project" | "domain" | null>(null);
  const { settings } = useSettings();
  const defaultDurationMins = settings?.default_task_duration_minutes ?? DEFAULT_DURATION_MINUTES;
  const { data: recurrences = [] } = useRecurrences();
  const recurrenceMutations = useRecurrenceMutations();
  const recurrence = useMemo(
    () => (task.recurrence_id ? recurrences.find((r) => r.id === task.recurrence_id) ?? null : null),
    [recurrences, task.recurrence_id],
  );
  const anchorISO = task.do_date ?? todayISO();
  const repeatRule: RecurrenceRule | null = recurrence ? ruleOf(recurrence) : null;

  const onRepeatChange = async (rule: RecurrenceRule | null) => {
    const template = {
      title: task.title,
      duration_minutes: task.duration_minutes ?? defaultDurationMins,
      time_of_day_minutes: task.start_time
        ? new Date(task.start_time).getHours() * 60 + new Date(task.start_time).getMinutes()
        : null,
      project_id: task.project_id,
      domain_id: task.domain_id,
      priority: task.priority,
    };
    if (!rule) {
      if (recurrence) await recurrenceMutations.stopSeries(recurrence, anchorISO);
      return;
    }
    if (recurrence) {
      await recurrenceMutations.updateSeries(recurrence, rule, template);
    } else {
      await recurrenceMutations.convertToSeries("task", task, rule, template);
    }
  };

  // What we last SENT, not what the prop says: the prop lags the write by a
  // render, so two commits in one tick (the field's blur, then the sheet
  // closing) would otherwise both see "changed" and write twice.
  const sent = useRef({ title: task.title, notes: task.notes });
  const commitRef = useRef<() => void>(() => {});

  const commitTitle = () => {
    const next = title.trim();
    // An emptied title isn't a rename — put the old one back rather than leave
    // a blank hero that was never saved.
    if (!next) {
      setTitle(sent.current.title);
      return;
    }
    if (next === sent.current.title) return;
    sent.current.title = next;
    mutations.patchTask(task.id, { title: next });
  };
  const commitNotes = () => {
    if (notes === sent.current.notes) return;
    sent.current.notes = notes;
    mutations.patchTask(task.id, { notes });
  };
  commitRef.current = () => {
    commitTitle();
    commitNotes();
  };

  // iOS fires no blur when the sheet closes, when the app is backgrounded or
  // when a tap lands on ✕ — a button never takes focus in Safari — so an edit
  // typed and then dismissed was lost. Every way out of the sheet flushes first.
  const close = () => {
    commitRef.current();
    onClose();
  };

  // Backgrounding the app mid-edit (home swipe, app switch) never fires blur on
  // iOS — commit on the way out so the edit isn't lost.
  useVisibilityFlush(() => commitRef.current());

  const planChips: { label: string; run: () => void; active?: boolean }[] = [
    { label: "Today", run: () => mutations.planFor(task, todayISO(), TRIAGE_UNDO), active: task.do_date === todayISO() },
    { label: "Tomorrow", run: () => mutations.planFor(task, tomorrowISO(), TRIAGE_UNDO), active: task.do_date === tomorrowISO() },
    { label: "Next week", run: () => mutations.planFor(task, nextWeekISO(), TRIAGE_UNDO) },
  ];

  // the domain the task actually counts toward — its parent's, not its own stale
  // copy (see `resolveDomainId`), so the chips agree with the hours ledger
  const effectiveDomainId = taskDomainId(vertical, task);
  const domain = domainById(vertical, effectiveDomainId);
  const project = projectById(vertical, task.project_id);
  const initiative = initiativeById(vertical, taskInitiativeId(vertical, task));
  // Parented by a project OR straight by an initiative: the domain is inherited,
  // so it is a read in the mast, never a control (setting it would do nothing).
  const parented = Boolean(project || initiative);

  const setDomain = (domainId: string) => {
    mutations.patchTask(task.id, { domain_id: domainId || null });
  };

  const setProject = (projectId: string) => {
    const p = projectById(vertical, projectId || null);
    mutations.patchTask(task.id, {
      project_id: p?.id ?? null,
      initiative_id: p?.initiativeId ?? null,
      domain_id: p?.domainId ?? task.domain_id,
      // filing an inbox capture processes it; un-filing a dateless backlog
      // task with no other parent sends it back to the inbox (never limbo)
      ...(task.status === "inbox" && p ? { status: "backlog" as const } : {}),
      ...(!p && task.status === "backlog" && !task.domain_id && !task.do_date
        ? { status: "inbox" as const }
        : {}),
    });
  };

  const priorities: { value: Task["priority"]; label: string; color: string }[] = [
    { value: "high", label: "High", color: "var(--signal)" },
    { value: "medium", label: "Medium", color: "var(--accent)" },
    { value: "low", label: "Low", color: "var(--muted)" },
    { value: "none", label: "None", color: "var(--line-strong)" },
  ];

  // The ONE muted line under the name: when it is, and how long it is.
  const start = task.start_time ? new Date(task.start_time) : null;
  const end = start && task.duration_minutes ? new Date(start.getTime() + task.duration_minutes * 60_000) : null;
  const when = start
    ? `${dayWord(start)} · ${end ? span(start, end) : at(start)}`
    : task.do_date
      ? dayWord(parseDateISO(task.do_date))
      : task.status === "inbox"
        ? "Inbox"
        : "No date";
  const length = start && end ? null : task.duration_minutes ? fmtDuration(task.duration_minutes) : null;

  const { title: sheetTitle, onContentScroll } = useSheetTitle("Task", title);

  const askNuvo = () => {
    if (!onAskNuvo) return;
    const seed = start
      ? `I have a task block: "${task.title}" at ${span(start, end ?? new Date(start.getTime() + 30 * 60_000))}. Help me think about it.`
      : `I have a task: "${task.title}". Help me think about it.`;
    onAskNuvo(seed, `Help me with “${task.title}”`);
    close();
  };

  const openProjects = vertical.projects.filter((p) => !isProjectComplete(p.status) || p.id === task.project_id);

  return (
    <>
      <Sheet onClose={close} title={sheetTitle} onContentScroll={onContentScroll} contentClassName={SHEET_SCROLL}>
        <div className={SHEET_BODY}>
          <SheetMast
            color={accent ?? domain?.color}
            crumb={
              parented ? (
                <>
                  <span className="flex shrink-0 items-center gap-1" style={{ color: domain?.color }}>
                    <DomainSymbol value={domain?.icon} size={13} />
                    {domain?.name ?? "Domain"}
                  </span>
                  {initiative && (
                    <>
                      <span aria-hidden>›</span>
                      <span className="truncate">{initiative.name}</span>
                    </>
                  )}
                  {project && (
                    <>
                      <span aria-hidden>›</span>
                      <span className="truncate">{project.name}</span>
                    </>
                  )}
                </>
              ) : undefined
            }
            meta={
              <>
                {done && (
                  <>
                    <span className="inline-flex items-center gap-1 text-ink">
                      <Icon name="check" size={12} />
                      Done
                    </span>
                    <MetaDot />
                  </>
                )}
                <span>{when}</span>
                {length && (
                  <>
                    <MetaDot />
                    <span>{length}</span>
                  </>
                )}
              </>
            }
          >
            <AutoText
              value={title}
              onChange={setTitle}
              onBlur={commitTitle}
              label="Task title"
              single
              className={`bg-transparent text-lead font-semibold leading-snug tracking-tight ${
                done ? "text-muted line-through decoration-muted/50" : "text-ink"
              }`}
            />
          </SheetMast>

          <button
            type="button"
            onClick={() => {
              done ? mutations.uncomplete(task) : mutations.complete(task);
              close();
            }}
            className={`tap fast mt-4 flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-head font-semibold active:translate-y-px ${
              done ? "border-line text-muted" : "border-accent bg-accent text-on-accent"
            }`}
          >
            <Icon name={done ? "refresh" : "check"} size={16} />
            {done ? "Reopen" : "Mark done"}
          </button>

          <SheetSection label="Plan">
            <ChipGrid cols={3}>
              {planChips.map((c) => (
                <Chip key={c.label} on={c.active} onClick={() => { c.run(); close(); }}>
                  {c.label}
                </Chip>
              ))}
              <Chip on={task.status === "inbox"} onClick={() => { mutations.backToInbox(task, TRIAGE_UNDO); close(); }}>
                Inbox
              </Chip>
              <Chip span={2} onClick={() => setShowDatePick((v) => !v)} on={showDatePick}>
                Pick date…
              </Chip>
            </ChipGrid>
            {showDatePick && <DateTimePicker task={task} mutations={mutations} onDone={close} />}
          </SheetSection>

          <SheetSection label="Duration">
            <ChipGrid cols={4}>
              {DURATION_PRESETS.map((m) => (
                <Chip
                  key={m}
                  on={(task.duration_minutes ?? defaultDurationMins) === m}
                  onClick={() => mutations.patchTask(task.id, { duration_minutes: m })}
                >
                  {fmtDuration(m)}
                </Chip>
              ))}
            </ChipGrid>
          </SheetSection>

          <SheetSection label="Steps">
            <TaskSteps task={task} mutations={mutations} touch />
          </SheetSection>

          <SheetSection label="Notes">
            <TaskNotes
              value={notes}
              onBlur={commitNotes}
              // The read face wears the textarea's box exactly — `.field`, three
              // rows tall — so a number turning tappable never moves the sheet.
              readClassName="field leading-relaxed"
              readStyle={{ minHeight: "calc(3 * 1.3em + 1rem + 2px)" }}
              renderEditor={({ inputRef, onFocus, onBlur }) => (
                <AutoText
                  value={notes}
                  onChange={setNotes}
                  onBlur={onBlur}
                  onFocus={onFocus}
                  inputRef={inputRef}
                  label="Notes"
                  placeholder="Add notes"
                  minRows={3}
                  className="field leading-relaxed"
                />
              )}
            />
          </SheetSection>

          <SheetSection>
            <RowList>
              <FactRow
                icon="package"
                label="Project"
                value={project?.name ?? "None"}
                valueColor={project ? "var(--ink)" : null}
                onClick={() => setPicker("project")}
              />
              {/* Loose only — see `parented`. */}
              {!parented && (
                <FactRow
                  lead={
                    <span style={{ color: domain?.color }}>
                      <DomainSymbol value={domain?.icon} size={16} />
                    </span>
                  }
                  label="Domain"
                  value={domain?.name ?? "None"}
                  valueColor={domain ? domain.color : null}
                  onClick={() => setPicker("domain")}
                />
              )}
              <RepeatControl anchorISO={anchorISO} value={repeatRule} onChange={(r) => void onRepeatChange(r)} variant="row" />
              {/* Remind — a block, a day, or a deadline. Untimed days have no default. */}
              {(task.start_time || task.do_date) && (
                <RemindRow caption={task.deadline ? "When it starts" : undefined}>
                  <ReminderSelect
                    block
                    chevron
                    target={{ targetKind: "task", targetId: task.id, anchor: "start", allDay: !task.start_time }}
                  />
                </RemindRow>
              )}
              {task.deadline && (
                <RemindRow caption="When it’s due">
                  <ReminderSelect block chevron target={{ targetKind: "task", targetId: task.id, anchor: "deadline" }} />
                </RemindRow>
              )}
            </RowList>
          </SheetSection>

          <SheetSection label="Priority">
            <ChipGrid cols={4}>
              {priorities.map((p) => (
                <Chip key={p.value} on={task.priority === p.value} onClick={() => mutations.patchTask(task.id, { priority: p.value })}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: task.priority === p.value ? "currentColor" : p.color }} />
                    {p.label}
                  </span>
                </Chip>
              ))}
            </ChipGrid>
          </SheetSection>

          {labels.length > 0 && (
            <SheetSection label="Labels">
              <div className="flex flex-wrap gap-1.5">
                {labels.map((l) => {
                  const on = currentLabels.has(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = new Set(currentLabels);
                        on ? next.delete(l.id) : next.add(l.id);
                        mutations.setLabels(task.id, [...next]);
                      }}
                      className="tap fast rounded-full border px-3.5 text-body font-medium"
                      style={{
                        borderColor: on ? l.color : "var(--line)",
                        background: on ? `color-mix(in srgb, ${l.color} 15%, var(--surface))` : "transparent",
                        color: on ? l.color : "var(--muted)",
                      }}
                    >
                      {l.name}
                    </button>
                  );
                })}
              </div>
            </SheetSection>
          )}

          {(task.start_time || onAskNuvo) && (
            <SheetSection>
              <RowList>
                {onAskNuvo && <ActionRow glyph="✦" label="Ask Nuvo" onClick={askNuvo} />}
                {task.start_time && (
                  <ActionRow
                    quiet
                    icon="calendar"
                    label="Remove from calendar"
                    onClick={() => {
                      mutations.unblock(task);
                      close();
                    }}
                  />
                )}
              </RowList>
            </SheetSection>
          )}

          <div className="mt-6">
            <DestructiveRow
              label="Trash"
              confirm={false}
              onConfirm={() => {
                mutations.trash(task);
                onClose();
              }}
            />
          </div>
        </div>
      </Sheet>

      {picker === "project" && (
        <PickSheet
          title="Project"
          rows={openProjects.map((p) => {
            const d = domainById(vertical, p.domainId);
            return { id: p.id, name: p.name, sub: d?.name, color: d?.color };
          })}
          value={task.project_id}
          noneLabel="No project"
          onPick={setProject}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "domain" && (
        <PickSheet
          title="Domain"
          note="Where this task’s time counts, when it isn’t part of a project."
          rows={vertical.domains.map((d) => ({
            id: d.id,
            name: d.name,
            color: d.color,
            lead: <DomainSymbol value={d.icon} size={18} />,
          }))}
          value={domain?.id ?? null}
          noneLabel="No domain"
          onPick={setDomain}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

/** Backgrounding the app never fires a blur on iOS; flush on the way out. */
function useVisibilityFlush(flush: () => void) {
  const ref = useRef(flush);
  ref.current = flush;
  useEffect(() => {
    const run = () => ref.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", run);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", run);
    };
  }, []);
}

/** A reminder row in the hairline list: the bell hangs in the same gutter as
 *  every other row's glyph, the wheel fills the rest. `caption` says WHICH
 *  reminder it is when there are two (a start and a deadline) — it was a tag
 *  stranded after the chevron, at the far edge, where nothing read it. */
function RemindRow({ children, caption }: { children: React.ReactNode; caption?: string }) {
  return (
    <div>
      {caption && <div className="pt-2.5 text-micro font-medium text-muted" style={{ paddingLeft: 32 }}>{caption}</div>}
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-5 shrink-0 items-center justify-center text-muted">
          <Icon name="bell" size={16} />
        </span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function DateTimePicker({
  task,
  mutations,
  onDone,
}: {
  task: Task;
  mutations: Mutations;
  onDone: () => void;
}) {
  const [date, setDate] = useState(task.do_date ?? todayISO());
  const [time, setTime] = useState(task.start_time ? task.start_time.slice(11, 16) : "");

  const apply = () => {
    if (time) {
      const [h, m] = time.split(":").map(Number);
      const [y, mo, d] = date.split("-").map(Number);
      mutations.block(task, new Date(y, mo - 1, d, h, m), undefined, TRIAGE_UNDO);
    } else {
      mutations.planFor(task, date, TRIAGE_UNDO);
    }
    onDone();
  };

  // Set sits ABOVE the pickers: the iOS wheel rises from the screen bottom and
  // covers the lower half of this bottom sheet, so a trailing button could
  // never be reached while a wheel was open.
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={apply}
        className="tap fast col-span-2 rounded-xl border border-accent bg-accent text-head font-semibold text-on-accent active:translate-y-px"
      >
        Set date{time ? " & time" : ""}
      </button>
      <input
        type="date"
        value={date}
        aria-label="Date"
        onChange={(e) => setDate(e.target.value)}
        className="field mono w-full min-w-0"
      />
      <input
        type="time"
        value={time}
        step={900}
        aria-label="Time"
        onChange={(e) => setTime(e.target.value)}
        className="field mono w-full min-w-0"
      />
    </div>
  );
}
