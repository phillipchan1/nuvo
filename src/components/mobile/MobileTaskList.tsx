import { useMemo, useState } from "react";
import type { Label, Task } from "../../lib/types";
import { TRASH_RETENTION_DAYS, type useTaskMutations } from "../../hooks/useTasks";
import type { useVertical } from "../../hooks/useVertical";
import { isOverdue, todayISO, tomorrowISO } from "../../lib/dates";
import {
  domainById,
  initiativeById,
  projectById,
  taskDomainColor,
  taskDomainId,
  taskInitiativeId,
} from "../../lib/vertical";
import TaskRow, { type TaskMeta } from "../TaskRow";
import { SectionLabel } from "../ui";
import SkeletonRows from "./Skeleton";

type Mutations = ReturnType<typeof useTaskMutations>;
type Vertical = ReturnType<typeof useVertical>["data"];

const TRIAGE_UNDO = { undo: "toast" as const };

/** The Tasks screen's lenses. `trash` is the phone's half of the floor under
 *  delete — the same act as the desktop rail's Trash face, over the same query,
 *  and it appears only when it holds something. */
export type MobileTab = "today" | "week" | "inbox" | "trash";

export default function MobileTaskList({
  tab,
  inbox,
  today,
  week,
  trashed,
  labels,
  vertical,
  mutations,
  now,
  onTapTask,
  pending = false,
  filterNote = null,
  selection,
}: {
  tab: MobileTab;
  inbox: Task[];
  today: Task[];
  week: Task[];
  trashed: Task[];
  labels: Label[];
  vertical: Vertical;
  mutations: Mutations;
  now: Date;
  onTapTask: (t: Task) => void;
  /** the active tab's query hasn't resolved yet — never claim "nothing here". */
  pending?: boolean;
  /** A filter is narrowing these lists — the plain-English question it asks.
   *  Null when nothing is filtered. Empty states MUST say this instead of
   *  "Inbox zero": a short list reads as "you're on top of it", which is the
   *  one lie a planner can't tell. */
  filterNote?: string | null;
  /** Multi-select, entered by holding a row. Absent = selection is off for this
   *  surface (the trash, which has its own two acts). */
  selection?: {
    ids: Set<string>;
    /** Hold a row: start selecting, with that row picked. */
    begin: (id: string) => void;
    toggle: (id: string) => void;
  };
}) {
  const metaOf = (t: Task): TaskMeta => {
    const project = projectById(vertical, t.project_id);
    const initiative = initiativeById(vertical, taskInitiativeId(vertical, t));
    const domain = domainById(vertical, taskDomainId(vertical, t));
    return {
      project: project?.name ?? null,
      initiative: initiative?.name ?? null,
      domain: domain?.name ?? null,
      domainColor: domain?.color ?? null,
    };
  };

  const selecting = !!selection && selection.ids.size > 0;

  const rowProps = (t: Task, action?: React.ReactNode) => ({
    task: t,
    labels,
    now,
    selected: false,
    multiSelected: selection?.ids.has(t.id) ?? false,
    draggable: false,
    accent: taskDomainColor(vertical, t),
    meta: metaOf(t),
    onSelect: () => {},
    onLongPress: selection ? () => selection.begin(t.id) : undefined,
    // While a selection is live, a tap toggles instead of opening — the
    // convention every phone list uses, and the only way to add a second row
    // without a second gesture.
    onOpen: () => (selecting && selection ? selection.toggle(t.id) : onTapTask(t)),
    onToggleDone: () => (t.status === "done" ? mutations.uncomplete(t) : mutations.complete(t)),
    // Swipe right completes; swipe left snoozes to tomorrow (undo via toast).
    swipeActions: { onDefer: () => mutations.planFor(t, tomorrowISO(), TRIAGE_UNDO) },
    action,
  });

  const todaySections = useMemo(() => buildTodaySections(today, now), [today, now]);
  const weekPool = useMemo(() => buildWeekPool(week), [week]);
  const [todayOpen, setTodayOpen] = useState({ planned: true, scheduled: true, done: true });
  const toggleToday = (key: keyof typeof todayOpen) =>
    setTodayOpen((s) => ({ ...s, [key]: !s[key] }));

  if (tab === "trash") {
    return (
      <MobileTrash
        tasks={trashed}
        onRestore={(t) => mutations.restore(t)}
        onPurge={(t) => void mutations.purge(t)}
        onPurgeAll={() => void mutations.purgeAll(trashed)}
      />
    );
  }

  if (tab === "inbox") {
    if (pending && inbox.length === 0) return <SkeletonRows />;
    return (
      <div>
        {inbox.length === 0 && <Empty text={filterNote ? `Nothing in the inbox matches ${filterNote}.` : "Inbox zero. Tap ＋ to capture."} />}
        {inbox.map((t) => (
          <TaskRow key={t.id} {...rowProps(t)} />
        ))}
      </div>
    );
  }

  if (tab === "today") {
    const nothing =
      todaySections.pinned.length === 0 &&
      todaySections.unblocked.length === 0 &&
      todaySections.scheduled.length === 0 &&
      todaySections.done.length === 0;
    if (pending && nothing) return <SkeletonRows />;
    return (
      <div>
        {nothing && <Empty text={filterNote ? `Nothing today matches ${filterNote}.` : "Nothing planned for today. Pull from Week or tap ＋."} />}
        {todaySections.pinned.length > 0 && (
          <>
            <SectionLabel count={todaySections.pinned.length}>Overdue</SectionLabel>
            {todaySections.pinned.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
          </>
        )}
        {todaySections.unblocked.length > 0 && (
          <>
            <SectionLabel
              open={todayOpen.planned}
              onToggle={() => toggleToday("planned")}
              count={todaySections.unblocked.length}
            >
              Planned
            </SectionLabel>
            {todayOpen.planned &&
              todaySections.unblocked.map((t) => (
                <TaskRow key={t.id} {...rowProps(t)} />
              ))}
          </>
        )}
        {todaySections.scheduled.length > 0 && (
          <>
            <SectionLabel
              open={todayOpen.scheduled}
              onToggle={() => toggleToday("scheduled")}
              count={todaySections.scheduled.length}
            >
              On the clock
            </SectionLabel>
            {todayOpen.scheduled &&
              todaySections.scheduled.map((t) => (
                <TaskRow key={t.id} {...rowProps(t)} />
              ))}
          </>
        )}
        {todaySections.done.length > 0 && (
          <>
            <SectionLabel
              open={todayOpen.done}
              onToggle={() => toggleToday("done")}
              count={todaySections.done.length}
            >
              Done
            </SectionLabel>
            {todayOpen.done &&
              todaySections.done.map((t) => (
                <TaskRow key={t.id} {...rowProps(t)} />
              ))}
          </>
        )}
      </div>
    );
  }

  // ── Week ──
  const empty = weekPool.unplaced.length === 0 && weekPool.placed.length === 0 && weekPool.done.length === 0;
  if (pending && empty) return <SkeletonRows />;
  return (
    <div>
      {vertical.sprintGoal && (
        <div className="border-b border-line px-4 py-3">
          <div className="section-label mb-0.5 !p-0">This week</div>
          <div className="text-head font-medium">{vertical.sprintGoal}</div>
        </div>
      )}
      {empty && <Empty text={filterNote ? `Nothing this week matches ${filterNote}.` : "Nothing committed this week yet."} />}
      {weekPool.unplaced.length > 0 && (
        <>
          <SectionLabel>To place</SectionLabel>
          {weekPool.unplaced.map((t) => (
            <TaskRow
              key={t.id}
              {...rowProps(
                t,
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    mutations.planFor(t, todayISO(now), TRIAGE_UNDO);
                  }}
                  title="Pull onto today"
                  className="tap fast mono shrink-0 rounded-md border border-line px-2 text-caption text-muted active:border-accent active:text-accent"
                >
                  ▸ today
                </button>,
              )}
            />
          ))}
        </>
      )}
      {weekPool.placed.length > 0 && (
        <>
          <SectionLabel>Placed on days</SectionLabel>
          {weekPool.placed.map((t) => (
            <TaskRow key={t.id} {...rowProps(t)} />
          ))}
        </>
      )}
      {weekPool.done.length > 0 && (
        <>
          <SectionLabel>Done</SectionLabel>
          {weekPool.done.map((t) => (
            <TaskRow key={t.id} {...rowProps(t)} />
          ))}
        </>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-4 py-10 text-center text-body text-muted">{text}</div>;
}

/**
 * The phone's trash — the same two acts as the desktop rail's, in the thumb's
 * idiom: full-width 44px buttons rather than hover-revealed text, and the
 * destructive one asks in place (a hidden gesture must never be the only path
 * to an act, and this act has no undo at all).
 */
function MobileTrash({
  tasks,
  onRestore,
  onPurge,
  onPurgeAll,
}: {
  tasks: Task[];
  onRestore: (t: Task) => void;
  onPurge: (t: Task) => void;
  onPurgeAll: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [emptyConfirm, setEmptyConfirm] = useState(false);
  if (tasks.length === 0) return <Empty text="Nothing in the trash." />;
  return (
    <div>
      <div className="border-b border-line px-4 py-3">
        <div className="text-caption leading-snug text-muted">
          Deleted tasks rest here. Restoring puts one back where it belongs; deleting forever
          can't be undone. Items older than {TRASH_RETENTION_DAYS} days are removed automatically.
        </div>
        <button
          type="button"
          onClick={() => {
            if (emptyConfirm) {
              onPurgeAll();
              setEmptyConfirm(false);
            } else {
              setEmptyConfirm(true);
            }
          }}
          className={`tap-h fast mt-3 w-full rounded-lg border px-3 py-2.5 text-body font-medium ${
            emptyConfirm ? "border-signal text-signal" : "border-line text-muted active:bg-surface-2"
          }`}
        >
          {emptyConfirm ? "Delete all forever?" : "Empty trash"}
        </button>
      </div>
      {tasks.map((t) => {
        const asking = confirming === t.id;
        return (
          <div key={t.id} className="border-b border-line px-4 py-3">
            <div className="truncate text-body text-muted">{t.title || "Untitled"}</div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onRestore(t)}
                className="tap-h fast flex-1 rounded-lg border border-line bg-surface px-3 text-body font-medium text-ink active:bg-surface-2"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={() => {
                  if (asking) {
                    onPurge(t);
                    setConfirming(null);
                  } else setConfirming(t.id);
                }}
                className={`tap-h fast flex-1 rounded-lg border px-3 text-body font-medium ${
                  asking ? "border-signal text-signal" : "border-line text-muted active:bg-surface-2"
                }`}
              >
                {asking ? "Delete forever?" : "Delete forever"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function buildTodaySections(today: Task[], now: Date) {
  const active = today.filter((t) => t.status !== "done");
  const done = today.filter((t) => t.status === "done");
  // Overdue only — keep in step with LeftRail's twin: a rolled task dated today
  // with no time is today's plan, not a late one, and including it made the
  // group's label lie. Its ↻N still rides the row's gutter.
  const pinned = active
    .filter((t) => isOverdue(t, now))
    .sort((a, b) => b.roll_count - a.roll_count || (a.start_time ?? "").localeCompare(b.start_time ?? ""));
  const pinnedIds = new Set(pinned.map((t) => t.id));
  const unblocked = active.filter((t) => !t.start_time && !pinnedIds.has(t.id));
  const scheduled = active
    .filter((t) => t.start_time && !pinnedIds.has(t.id))
    .sort((a, b) => (a.start_time! < b.start_time! ? -1 : 1));
  return { pinned, unblocked, scheduled, done };
}

function buildWeekPool(week: Task[]) {
  const open = week.filter((t) => t.status !== "done");
  return {
    unplaced: open.filter((t) => !t.do_date),
    placed: open.filter((t) => t.do_date).sort((a, b) => (a.do_date! < b.do_date! ? -1 : 1)),
    done: week.filter((t) => t.status === "done"),
  };
}
