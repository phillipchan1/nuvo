import { useMemo, useState } from "react";
import type { Label, Task } from "../../lib/types";
import type { useTaskMutations } from "../../hooks/useTasks";
import type { useVertical } from "../../hooks/useVertical";
import { isOverdue, todayISO, tomorrowISO } from "../../lib/dates";
import {
  domainById,
  initiativeById,
  projectById,
  taskDomainColor,
} from "../../lib/vertical";
import TaskRow, { type TaskMeta } from "../TaskRow";
import { SectionLabel } from "../ui";
import SkeletonRows from "./Skeleton";

type Mutations = ReturnType<typeof useTaskMutations>;
type Vertical = ReturnType<typeof useVertical>["data"];

const TRIAGE_UNDO = { undo: "toast" as const };

export type MobileTab = "today" | "week" | "inbox";

export default function MobileTaskList({
  tab,
  inbox,
  today,
  week,
  labels,
  vertical,
  mutations,
  now,
  onTapTask,
  pending = false,
}: {
  tab: MobileTab;
  inbox: Task[];
  today: Task[];
  week: Task[];
  labels: Label[];
  vertical: Vertical;
  mutations: Mutations;
  now: Date;
  onTapTask: (t: Task) => void;
  /** the active tab's query hasn't resolved yet — never claim "nothing here". */
  pending?: boolean;
}) {
  const metaOf = (t: Task): TaskMeta => {
    const project = projectById(vertical, t.project_id);
    const initiative = initiativeById(vertical, t.initiative_id ?? project?.initiativeId ?? null);
    const domain = domainById(vertical, t.domain_id ?? project?.domainId ?? initiative?.domainId ?? null);
    return {
      project: project?.name ?? null,
      initiative: initiative?.name ?? null,
      domain: domain?.name ?? null,
      domainColor: domain?.color ?? null,
    };
  };

  const rowProps = (t: Task, action?: React.ReactNode) => ({
    task: t,
    labels,
    now,
    selected: false,
    draggable: false,
    accent: taskDomainColor(vertical, t),
    meta: metaOf(t),
    onSelect: () => {},
    onOpen: () => onTapTask(t),
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

  if (tab === "inbox") {
    if (pending && inbox.length === 0) return <SkeletonRows />;
    return (
      <div>
        {inbox.length === 0 && <Empty text="Inbox zero. Tap ＋ to capture." />}
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
        {nothing && <Empty text="Nothing planned for today. Pull from Week or tap ＋." />}
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
      {empty && <Empty text="Nothing committed this week yet." />}
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
