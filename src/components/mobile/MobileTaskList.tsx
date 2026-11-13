import { useMemo, useState, type ReactNode } from "react";
import type { Label, Slot, Task } from "../../lib/types";
import { restoreFromTrashPatch } from "../../lib/types";
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
import { undoAutoPatch } from "../../lib/grooming";
import {
  FileOffer,
  HoldOffer,
  HoldsProbe,
  fileCandidates,
  holdCandidates,
  holdable,
  useOfferBudget,
  useStableCandidates,
} from "../nuvo/RailOffers";
import { PHONE_OFFERS_MAX } from "../../lib/railOffers";
import type { Placement } from "../../lib/compose";
import { InboxAddressHint } from "../InboxAddress";
import SkeletonRows from "./Skeleton";
import { Button } from "../kit";
import { Icon } from "../Icon";
import { PhEmpty, TouchButton } from "./touch";
import SlotRunHeader, { slotRunFace } from "../tasks/SlotRunHeader";
import { clockEntries, type ClockEntry, type SlotRun } from "../../lib/slotRuns";
import { coverage } from "../../lib/selection";

const NO_SLOTS: readonly Slot[] = [];
const NO_IDS: ReadonlySet<string> = new Set();

type Mutations = ReturnType<typeof useTaskMutations>;
type Vertical = ReturnType<typeof useVertical>["data"];

const TRIAGE_UNDO = { undo: "toast" as const };

/** The Tasks screen's lenses. `trash` is the phone's half of the floor under
 *  delete — the same act as the desktop rail's Trash icon, over the same query,
 *  and it appears only when it holds something (D-136). */
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
  onRestored,
  slots = NO_SLOTS,
  slotTitle,
  onOpenSlot,
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
    /** A slot header's ring: fill the group, or (if whole) take it back out. */
    toggleMany: (ids: string[]) => void;
  };
  /** After Restore — follow the row (inbox when that's where it landed). */
  onRestored?: (face: "inbox" | "today") => void;
  /** TODAY's slots. The phone's day query leaves slot children out ("they show
   *  inside their slot"), so with no slot to show them inside they weren't on
   *  Today at all. With these, a slot is a header over its tasks (D-178). */
  slots?: readonly Slot[];
  slotTitle?: (s: Slot, children: Task[]) => string;
  /** Tap a header: open the slot's sheet. */
  onOpenSlot?: (run: SlotRun, title: string) => void;
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

  // ── Nuvo's offers at rest (D-205) — two per phone screen at most, ranked
  // by the same budget the desktop rail uses (lib/railOffers). Today's holds,
  // earliest first; the inbox's filings, top first. Never while selecting.
  const todaySectionsForOffers = useMemo(() => buildTodaySections(today, now), [today, now]);
  const today0 = todayISO(now);
  const holdPool = useMemo(
    () => (tab === "today" && !selecting ? holdable(todaySectionsForOffers.unblocked, today0) : []),
    [tab, selecting, todaySectionsForOffers.unblocked, today0],
  );
  const [holds, setHolds] = useState<Map<string, Placement>>(() => new Map());
  const offerCands = useStableCandidates(
    selecting
      ? []
      : [
          ...(tab === "today" ? holdCandidates(holds).filter((c) => holdPool.some((t) => t.id === c.rowId)) : []),
          ...(tab === "inbox" ? fileCandidates(inbox) : []),
        ],
  );
  const offers = useOfferBudget(offerCands, PHONE_OFFERS_MAX);
  const homeOfProject = (id: string) => {
    const p = projectById(vertical, id);
    return p ? { initiativeId: p.initiativeId, domainId: p.domainId } : null;
  };
  const offerFor = (t: Task): ReactNode => {
    const o = offers.get(t.id);
    if (!o) return undefined;
    if (o.kind === "hold") {
      const p = holds.get(t.id);
      return p ? <HoldOffer task={t} placement={p} mutations={mutations} phone /> : undefined;
    }
    if (o.kind === "file") return <FileOffer task={t} mutations={mutations} homeOfProject={homeOfProject} phone />;
    return undefined;
  };
  const probe = holdPool.length > 0 ? <HoldsProbe tasks={holdPool} now={now} onHolds={setHolds} /> : null;

  const rowProps = (t: Task, action?: React.ReactNode) => ({
    task: t,
    labels,
    now,
    selected: false,
    multiSelected: selection?.ids.has(t.id) ?? false,
    draggable: false,
    accent: taskDomainColor(vertical, t),
    meta: metaOf(t),
    offer: offerFor(t),
    onSelect: () => {},
    onLongPress: selection ? () => selection.begin(t.id) : undefined,
    // While a selection is live, a tap toggles instead of opening — the
    // convention every phone list uses, and the only way to add a second row
    // without a second gesture.
    onOpen: () => (selecting && selection ? selection.toggle(t.id) : onTapTask(t)),
    onToggleDone: () => (t.status === "done" ? mutations.uncomplete(t) : mutations.complete(t)),
    // Swipe right completes; swipe left snoozes to tomorrow (undo via toast).
    swipeActions: { onDefer: () => mutations.planFor(t, tomorrowISO(), TRIAGE_UNDO) },
    // Nuvo's guess on an inbox row is "File in <place>", one of the screen's
    // offers (D-205) — not an Accept / ✕ pair on every row.
    onUndoAutoFile: () => mutations.patchTask(t.id, undoAutoPatch(t)),
    // The Today face already says the day — the row doesn't say "today" again
    // (the desktop rail does the same).
    dayShown: tab === "today",
    action,
  });

  const todaySections = useMemo(() => buildTodaySections(today, now), [today, now]);
  // The day's clock with each slot whole — the same read the desktop rail draws
  // (lib/slotRuns — which leaves out a slot with nothing in it, D-188). Under a
  // filter a slot with nothing matching is dropped: it would claim an outcome the
  // filter only hid.
  const clock = useMemo(() => {
    const all = clockEntries(todaySections.scheduled, slots, todaySections.done);
    return filterNote ? all.filter((e) => e.kind === "task" || e.open.length > 0) : all;
  }, [todaySections.scheduled, todaySections.done, slots, filterNote]);
  const weekPool = useMemo(() => buildWeekPool(week), [week]);
  const [todayOpen, setTodayOpen] = useState({ planned: true, scheduled: true, done: true });
  const toggleToday = (key: keyof typeof todayOpen) =>
    setTodayOpen((s) => ({ ...s, [key]: !s[key] }));

  // A slot as the head of its tasks. The ring is the tap path for "everything in
  // this block" — there is no drag and no ⌘-click on a phone, and a hold on the
  // header would be a third meaning for the gesture (D-122's one-gesture rule).
  const renderSlotRun = (run: Extract<ClockEntry, { kind: "slot" }>) => {
    const title = slotTitle ? slotTitle(run.slot, run.open) : run.slot.title;
    const face = slotRunFace(run, title);
    const ids = run.open.map((t) => t.id);
    return (
      <div key={`slot:${run.slot.id}`}>
        <SlotRunHeader
          slotId={run.slot.id}
          {...face}
          coverage={coverage(selection?.ids ?? NO_IDS, ids)}
          selectable={Boolean(selection) && ids.length > 0}
          onOpen={() => onOpenSlot?.(run, face.title)}
          onToggleSelect={() => selection?.toggleMany(ids)}
        />
        {ids.length > 0 && (
          <div style={{ boxShadow: `inset 3px 0 0 ${face.color}` }}>
            {run.open.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
          </div>
        )}
      </div>
    );
  };

  if (tab === "trash") {
    return (
      <MobileTrash
        tasks={trashed}
        onRestore={(t) => {
          const { face } = restoreFromTrashPatch(t);
          mutations.restore(t);
          onRestored?.(face);
        }}
        onPurge={(t) => void mutations.purge(t)}
        onPurgeAll={() => void mutations.purgeAll(trashed)}
      />
    );
  }

  if (tab === "inbox") {
    if (pending && inbox.length === 0) return <SkeletonRows />;
    return (
      <div>
        {inbox.length === 0 && (
          filterNote ? (
            <PhEmpty>Nothing matches {filterNote}</PhEmpty>
          ) : (
            <>
              <PhEmpty icon="check">Inbox zero</PhEmpty>
              <InboxAddressHint />
            </>
          )
        )}
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
      clock.length === 0 &&
      todaySections.done.length === 0;
    if (pending && nothing) return <SkeletonRows />;
    return (
      <div>
        {probe}
        {nothing && (filterNote ? <PhEmpty>Nothing matches {filterNote}</PhEmpty> : <PhEmpty icon="check">Nothing planned</PhEmpty>)}
        {todaySections.pinned.length > 0 && (
          <>
            <ListSection count={todaySections.pinned.length}>Overdue</ListSection>
            {todaySections.pinned.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
          </>
        )}
        {todaySections.unblocked.length > 0 && (
          <>
            <ListSection
              open={todayOpen.planned}
              onToggle={() => toggleToday("planned")}
              count={todaySections.unblocked.length}
            >
              No time yet
            </ListSection>
            {todayOpen.planned &&
              todaySections.unblocked.map((t) => (
                <TaskRow key={t.id} {...rowProps(t)} />
              ))}
          </>
        )}
        {clock.length > 0 && (
          <>
            <ListSection
              open={todayOpen.scheduled}
              onToggle={() => toggleToday("scheduled")}
              count={todaySections.scheduled.length}
            >
              On the clock
            </ListSection>
            {todayOpen.scheduled &&
              clock.map((entry) =>
                entry.kind === "task" ? (
                  <TaskRow key={entry.task.id} {...rowProps(entry.task)} />
                ) : (
                  renderSlotRun(entry)
                ),
              )}
          </>
        )}
        {todaySections.done.length > 0 && (
          <>
            <ListSection
              open={todayOpen.done}
              onToggle={() => toggleToday("done")}
              count={todaySections.done.length}
            >
              Done
            </ListSection>
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
        // The week's one sentence, said once: a quiet name over it, never an
        // eyebrow restating the segment you are already on.
        <div className="border-b border-[var(--line-1)] px-4 py-3">
          <div className="text-caption font-semibold text-muted">Goal</div>
          <div className="mt-0.5 text-head font-medium text-ink">{vertical.sprintGoal}</div>
        </div>
      )}
      {empty && (filterNote ? <PhEmpty>Nothing matches {filterNote}</PhEmpty> : <PhEmpty>Nothing committed</PhEmpty>)}
      {weekPool.unplaced.length > 0 && (
        <>
          <ListSection count={weekPool.unplaced.length}>To place</ListSection>
          {weekPool.unplaced.map((t) => (
            <TaskRow
              key={t.id}
              {...rowProps(
                t,
                // A 28px kit button whose hit area blooms to 44px under a thumb
                // (`.tap-bloom`) — the row stays one height.
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    mutations.planFor(t, todayISO(now), TRIAGE_UNDO);
                  }}
                  title="Pull onto today"
                  icon={<Icon name="arrow-right" size={13} />}
                  className="tap-bloom shrink-0"
                >
                  Today
                </Button>,
              )}
            />
          ))}
        </>
      )}
      {weekPool.placed.length > 0 && (
        <>
          <ListSection count={weekPool.placed.length}>Placed on days</ListSection>
          {weekPool.placed.map((t) => (
            <TaskRow key={t.id} {...rowProps(t)} />
          ))}
        </>
      )}
      {weekPool.done.length > 0 && (
        <>
          <ListSection count={weekPool.done.length}>Done</ListSection>
          {weekPool.done.map((t) => (
            <TaskRow key={t.id} {...rowProps(t)} />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * A group's name and its count, in the phone's section voice (12/600, sentence
 * case — `ph-section`). With `onToggle` the whole header is a 44px disclosure;
 * the chevron turns, the count stays so a shut group still says what it holds.
 */
function ListSection({
  children,
  count,
  open,
  onToggle,
}: {
  children: React.ReactNode;
  count?: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const inner = (
    <>
      <span>{children}</span>
      {count != null && count > 0 && <span className="ph-section-count">{count}</span>}
    </>
  );
  if (onToggle && open != null) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="ph-section tap-h w-full border-0 bg-transparent text-left"
      >
        {inner}
        <span className="ph-grow" />
        <Icon
          name="chevron-down"
          size={14}
          className="fast self-center text-[var(--faint)]"
          style={{ transform: open ? undefined : "rotate(-90deg)" }}
        />
      </button>
    );
  }
  return <div className="ph-section">{inner}</div>;
}

/**
 * The phone's trash — the same two acts as the desktop rail's, in the thumb's
 * idiom: thumb-sized kit buttons rather than hover-revealed text, and the
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
  if (tasks.length === 0) return <PhEmpty icon="trash">Trash is empty</PhEmpty>;
  return (
    <div>
      {/* One fact — when they go — and the act that empties it. Restoring and
          deleting say what they do on their own buttons. */}
      <div className="flex items-center gap-3 border-b border-[var(--line-1)] px-4 py-3">
        <span className="min-w-0 flex-1 text-caption text-muted">
          Removed after {TRASH_RETENTION_DAYS} days
        </span>
        <TouchButton
          compact
          kind={emptyConfirm ? "danger-solid" : "danger"}
          onClick={() => {
            if (emptyConfirm) {
              onPurgeAll();
              setEmptyConfirm(false);
            } else {
              setEmptyConfirm(true);
            }
          }}
        >
          {emptyConfirm ? "Delete all forever?" : "Empty trash"}
        </TouchButton>
      </div>
      {tasks.map((t) => {
        const asking = confirming === t.id;
        return (
          <div key={t.id} className="border-b border-[var(--line-1)] px-4 pb-3 pt-3">
            <div className="ph-row-title text-muted">{t.title || "Untitled"}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <TouchButton compact full onClick={() => onRestore(t)}>
                Restore
              </TouchButton>
              <TouchButton
                compact
                full
                kind={asking ? "danger-solid" : "danger"}
                onClick={() => {
                  if (asking) {
                    onPurge(t);
                    setConfirming(null);
                  } else setConfirming(t.id);
                }}
              >
                {asking ? "Delete forever?" : "Delete forever"}
              </TouchButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function buildTodaySections(today: Task[], now: Date) {
  const active = today.filter((t) => t.status !== "done" && t.status !== "trashed");
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
