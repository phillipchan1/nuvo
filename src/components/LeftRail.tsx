import { useEffect, useMemo, useRef, useState } from "react";
import type { Label, Task } from "../lib/types";
import { isOverdue, nextWeekISO, todayISO, tomorrowISO } from "../lib/dates";
import { parseCapture } from "../lib/nlp";
import type { NewTaskInput, useTaskMutations } from "../hooks/useTasks";
import TaskRow from "./TaskRow";
import { Keycap, SectionLabel } from "./ui";

export type RailTab = "inbox" | "today";
type Mutations = ReturnType<typeof useTaskMutations>;

export default function LeftRail({
  tab,
  setTab,
  inbox,
  today,
  labels,
  mutations,
  onOpenTask,
  hotkeysEnabled,
  now,
  railRef,
}: {
  tab: RailTab;
  setTab: (t: RailTab) => void;
  inbox: Task[];
  today: Task[];
  labels: Label[];
  mutations: Mutations;
  onOpenTask: (t: Task) => void;
  hotkeysEnabled: boolean;
  now: Date;
  railRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [labelPickerFor, setLabelPickerFor] = useState<Task | null>(null);
  const [schedulePickerFor, setSchedulePickerFor] = useState<Task | null>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [capture, setCapture] = useState("");

  const todaySections = useMemo(() => buildTodaySections(today, now), [today, now]);

  const visible: Task[] =
    tab === "inbox"
      ? inbox
      : [...todaySections.pinned, ...todaySections.unblocked, ...todaySections.scheduled, ...todaySections.done];

  const selected = visible.find((t) => t.id === selectedId) ?? null;

  // Keyboard-first quick actions
  useEffect(() => {
    if (!hotkeysEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const idx = selected ? visible.findIndex((t) => t.id === selected.id) : -1;
      const move = (delta: number) => {
        const next = visible[Math.min(visible.length - 1, Math.max(0, idx + delta))];
        if (next) setSelectedId(next.id);
      };

      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          idx === -1 ? visible[0] && setSelectedId(visible[0].id) : move(1);
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          idx === -1 ? visible[0] && setSelectedId(visible[0].id) : move(-1);
          break;
        case "Enter":
          if (selected) onOpenTask(selected);
          break;
        case "e":
          if (selected) mutations.planFor(selected, todayISO());
          break;
        case "t":
          if (selected) mutations.planFor(selected, tomorrowISO());
          break;
        case "w":
          if (selected) mutations.planFor(selected, nextWeekISO());
          break;
        case "d":
          if (selected)
            selected.status === "done" ? mutations.uncomplete(selected) : mutations.complete(selected);
          break;
        case "x":
          if (selected) {
            mutations.trash(selected);
            setSelectedId(null);
          }
          break;
        case "s":
          if (selected) setSchedulePickerFor(selected);
          break;
        case "#":
          if (selected) {
            e.preventDefault();
            setLabelPickerFor(selected);
          }
          break;
        case "1":
          setTab("inbox");
          break;
        case "2":
          setTab("today");
          break;
        case "c":
          e.preventDefault();
          captureRef.current?.focus();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeysEnabled, selected, visible, mutations, onOpenTask, setTab]);

  const submitCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = capture.trim();
    if (!text) return;
    const p = parseCapture(text);
    const labelIds = p.labels
      .map((name) => labels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id)
      .filter((id): id is string => Boolean(id));
    const input: NewTaskInput = {
      title: p.title || text,
      do_date: p.doDate,
      start_time: p.startTime?.toISOString() ?? null,
      duration_minutes: p.durationMinutes,
      priority: p.priority,
      labelIds,
    };
    setCapture("");
    await mutations.create(input);
  };

  const rowProps = (t: Task) => ({
    task: t,
    labels,
    selected: t.id === selectedId,
    draggable: true,
    onSelect: () => setSelectedId(t.id),
    onOpen: () => onOpenTask(t),
    onToggleDone: () => (t.status === "done" ? mutations.uncomplete(t) : mutations.complete(t)),
  });

  return (
    <div ref={railRef} className="flex h-full w-[360px] shrink-0 flex-col border-r border-line bg-surface">
      {/* Tabs */}
      <div className="flex border-b border-line">
        {(["inbox", "today"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`fast flex-1 px-3 py-2 text-[12px] font-medium ${
              tab === t ? "border-b-2 border-accent text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {t === "inbox" ? "Inbox" : "Today"}
            <span className="mono ml-1.5 text-[10px] text-muted">
              {t === "inbox" ? inbox.length : today.filter((x) => x.status !== "done").length}
            </span>
          </button>
        ))}
      </div>

      {/* Capture */}
      <form onSubmit={submitCapture} className="border-b border-line p-2">
        <input
          ref={captureRef}
          value={capture}
          onChange={(e) => setCapture(e.target.value)}
          placeholder='Capture… try "call David tomorrow 9am 30m #work !high"'
          className="w-full border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted/70 focus:border-accent"
        />
      </form>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "inbox" && (
          <>
            {inbox.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
            {inbox.length === 0 && <EmptyState text="Inbox zero. Capture with C or ⌘K." />}
          </>
        )}

        {tab === "today" && (
          <>
            {todaySections.pinned.length > 0 && (
              <>
                <SectionLabel>Needs you</SectionLabel>
                {todaySections.pinned.map((t) => (
                  <TaskRow key={t.id} {...rowProps(t)} />
                ))}
              </>
            )}
            <SectionLabel>Planned</SectionLabel>
            {todaySections.unblocked.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
            {todaySections.unblocked.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-muted">Nothing unblocked.</div>
            )}
            <SectionLabel>Scheduled on calendar</SectionLabel>
            {todaySections.scheduled.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
            {todaySections.scheduled.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-muted">Drag tasks onto the calendar to block time.</div>
            )}
            {todaySections.done.length > 0 && (
              <>
                <SectionLabel>Done</SectionLabel>
                {todaySections.done.map((t) => (
                  <TaskRow key={t.id} {...rowProps(t)} />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Shortcut hints */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-3 py-2 text-[10px] text-muted">
        <span className="flex items-center gap-1"><Keycap>E</Keycap> today</span>
        <span className="flex items-center gap-1"><Keycap>T</Keycap> tomorrow</span>
        <span className="flex items-center gap-1"><Keycap>W</Keycap> next wk</span>
        <span className="flex items-center gap-1"><Keycap>S</Keycap> pick</span>
        <span className="flex items-center gap-1"><Keycap>D</Keycap> done</span>
        <span className="flex items-center gap-1"><Keycap>X</Keycap> trash</span>
        <span className="flex items-center gap-1"><Keycap>#</Keycap> label</span>
      </div>

      {labelPickerFor && (
        <LabelPicker
          task={labelPickerFor}
          labels={labels}
          onClose={() => setLabelPickerFor(null)}
          onSet={(ids) => mutations.setLabels(labelPickerFor.id, ids)}
        />
      )}
      {schedulePickerFor && (
        <SchedulePicker
          task={schedulePickerFor}
          onClose={() => setSchedulePickerFor(null)}
          mutations={mutations}
        />
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-3 py-6 text-center text-[12px] text-muted">{text}</div>;
}

function buildTodaySections(today: Task[], now: Date) {
  const active = today.filter((t) => t.status !== "done");
  const done = today.filter((t) => t.status === "done");
  const pinned = active
    .filter((t) => isOverdue(t, now) || (t.roll_count > 0 && !t.start_time))
    .sort((a, b) => Number(isOverdue(b, now)) - Number(isOverdue(a, now)) || b.roll_count - a.roll_count);
  const pinnedIds = new Set(pinned.map((t) => t.id));
  const unblocked = active.filter((t) => !t.start_time && !pinnedIds.has(t.id));
  const scheduled = active
    .filter((t) => t.start_time && !pinnedIds.has(t.id))
    .sort((a, b) => (a.start_time! < b.start_time! ? -1 : 1));
  return { pinned, unblocked, scheduled, done };
}

function LabelPicker({
  task,
  labels,
  onClose,
  onSet,
}: {
  task: Task;
  labels: Label[];
  onClose: () => void;
  onSet: (ids: string[]) => void;
}) {
  const current = new Set((task.task_labels ?? []).map((tl) => tl.label_id));
  return (
    <Popover onClose={onClose} title={`Labels — ${task.title}`}>
      {labels.length === 0 && (
        <div className="px-1 py-2 text-[12px] text-muted">No labels yet. Add them in Settings.</div>
      )}
      {labels.map((l) => (
        <label key={l.id} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-[13px] hover:bg-bg">
          <input
            type="checkbox"
            defaultChecked={current.has(l.id)}
            onChange={(e) => {
              const next = new Set(current);
              e.target.checked ? next.add(l.id) : next.delete(l.id);
              onSet([...next]);
            }}
          />
          <span style={{ color: l.color }}>{l.name}</span>
        </label>
      ))}
    </Popover>
  );
}

function SchedulePicker({
  task,
  onClose,
  mutations,
}: {
  task: Task;
  onClose: () => void;
  mutations: Mutations;
}) {
  const [date, setDate] = useState(task.do_date ?? todayISO());
  const [time, setTime] = useState(task.start_time ? task.start_time.slice(11, 16) : "");

  const apply = () => {
    if (time) {
      const [h, m] = time.split(":").map(Number);
      const [y, mo, d] = date.split("-").map(Number);
      mutations.block(task, new Date(y, mo - 1, d, h, m));
    } else {
      mutations.planFor(task, date);
    }
    onClose();
  };

  return (
    <Popover onClose={onClose} title={`Schedule — ${task.title}`}>
      <div className="flex items-center gap-2 py-1">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mono border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent"
        />
        <input
          type="time"
          value={time}
          step={900}
          onChange={(e) => setTime(e.target.value)}
          className="mono border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent"
        />
        <button onClick={apply} className="fast border border-accent bg-accent px-2.5 py-1 text-[12px] text-white">
          Set
        </button>
      </div>
      <div className="pt-1 text-[11px] text-muted">Leave time empty to plan the day without a block.</div>
    </Popover>
  );
}

function Popover({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="absolute bottom-12 left-2 z-30 w-[330px] border border-line bg-surface p-2">
      <div className="mb-1 flex items-center justify-between">
        <div className="truncate pr-2 text-[11px] font-medium text-muted">{title}</div>
        <button onClick={onClose} className="text-[11px] text-muted hover:text-ink">esc</button>
      </div>
      {children}
    </div>
  );
}
