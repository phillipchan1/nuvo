// The rail in focus (D-242) — one block, its tasks, and the ring that closes
// when they're done. Everything else on the day folds to one line.
//
// It is a FACE of the rail, not a second list: tasks render through the rail's
// own `TaskRow` wiring (`renderTask`), so ticking, opening, the context menu and
// the keyboard are the day list's — never a reduced row (D-111, D-146). The
// hero is the kit's `UnitCrown`, the same finish ring the day closes with
// (D-231) — so finishing a block is the day's reward at the block's size, not a
// new celebration.
//
// Two states:
//   on    — the block: ring + name, one line (time left · then …), its tasks
//   pick  — nothing on the clock: today's blocks still ahead, and the day's
//           open tasks to pick a few from. The app asks; it never guesses (P4).

import { useMemo, useState, type ReactNode } from "react";
import type { Slot, Task } from "../../lib/types";
import type { BusyBlock } from "../../lib/now";
import { blocksAhead, dayBlocks, readFocus, thenAfter, type FocusRead, type FocusTarget } from "../../lib/focus";
import { focusStore, type FocusState } from "../../hooks/useFocus";
import { spanWords } from "../../lib/marks";
import { at, span } from "../mobile/dayPlan";
import { Icon } from "../Icon";
import { Button, Dot, IconButton, Row, SectionHeader, UnitCrown } from "../kit";

export const FOCUS_KEYS = ["⌘", "."] as const;

/** The line under the block's name — one fact at a time, in the clock's own
 *  spelling (`at` / `span`, D-122). */
export function focusLine(read: FocusRead, then: BusyBlock | null, now: Date): string {
  const t = now.getTime();
  if (read.closed) {
    const when = read.closedAt ? `Cleared at ${at(read.closedAt)}.` : "Cleared.";
    if (read.end && read.closedAt && read.end.getTime() - read.closedAt.getTime() >= 60_000) {
      return `${when} ${spanWords(Math.round((read.end.getTime() - read.closedAt.getTime()) / 60_000))} to spare.`;
    }
    return when;
  }
  const left = read.total - read.done;
  const parts: string[] = [];
  if (read.start && read.end) {
    if (t < read.start.getTime()) parts.push(`Starts ${at(read.start)}`);
    else if (t < read.end.getTime()) parts.push(`${spanWords(Math.max(1, Math.round((read.end.getTime() - t) / 60_000)))} left`);
    else parts.push(`Ended ${at(read.end)} · ${left} open`);
  }
  if (then) parts.push(`then ${then.title} at ${at(then.start)}`);
  return parts.join(" · ");
}

export default function FocusPanel({
  state,
  pool,
  today,
  slots,
  slotTitle,
  busy,
  now,
  renderTask,
  restCount,
}: {
  state: Exclude<FocusState, null>;
  /** every task the rail can see — today's (done included) and the inbox */
  pool: readonly Task[];
  /** today's tasks, slot children included */
  today: readonly Task[];
  slots: readonly Slot[];
  slotTitle?: (s: Slot, children: Task[]) => string;
  /** the day's busy time (toBusyBlocks) — for "then …" */
  busy: readonly BusyBlock[];
  now: Date;
  /** the rail's own row; in the picker, `picked` fills it and a click toggles it */
  renderTask: (t: Task, pick?: { picked: boolean; toggle: () => void }) => ReactNode;
  /** open tasks today outside the focus */
  restCount: number;
}) {
  const read = useMemo(
    () => (state.mode === "on" ? readFocus(state.target, pool, slots, slotTitle) : null),
    [state, pool, slots, slotTitle],
  );
  const then = useMemo(() => (read ? thenAfter(read, busy, now) : null), [read, busy, now]);

  if (state.mode === "pick" || !read) return <FocusPicker today={today} slots={slots} slotTitle={slotTitle} now={now} renderTask={renderTask} />;

  return (
    <div className="focus" data-focus="on" data-closed={read.closed || undefined}>
      <div className="focus-head">
        <UnitCrown
          title={read.title}
          outer={null}
          n={read.done}
          of={read.total}
          closed={read.closed}
          said={focusLine(read, then, now)}
          tier="day"
          attrs={{ "data-focus-crown": "" }}
        />
        <IconButton
          size="xs"
          className="focus-leave"
          label="Leave focus"
          shortcut={[...FOCUS_KEYS]}
          icon={<Icon name="close" size={12} />}
          onClick={focusStore.leave}
        />
      </div>

      <div className="focus-tasks" style={read.color ? { ["--slot-h" as string]: read.color } : undefined}>
        {read.tasks.map((t) => renderTask(t))}
      </div>

      {read.closed ? (
        <div className="focus-after">
          <Button size="sm" kind="primary" onClick={focusStore.pick}>
            Focus on the next
          </Button>
          <Button size="sm" kind="ghost" onClick={focusStore.leave}>
            Back to the day
          </Button>
        </div>
      ) : (
        restCount > 0 && (
          <button type="button" className="focus-rest" onClick={focusStore.leave}>
            {restCount} more today
          </button>
        )
      )}
    </div>
  );
}

/** Nothing on the clock — the blocks still ahead today, and the day's open
 *  tasks to pick a few from. */
function FocusPicker({
  today,
  slots,
  slotTitle,
  now,
  renderTask,
}: {
  today: readonly Task[];
  slots: readonly Slot[];
  slotTitle?: (s: Slot, children: Task[]) => string;
  now: Date;
  renderTask: (t: Task, pick?: { picked: boolean; toggle: () => void }) => ReactNode;
}) {
  const ahead = useMemo(() => blocksAhead(dayBlocks(today, slots, slotTitle), now), [today, slots, slotTitle, now]);
  // A lone timed task is already a block above — it isn't offered twice.
  const open = useMemo(() => {
    const blocks = new Set(ahead.flatMap((b) => (b.target.kind === "task" ? [b.target.taskId] : [])));
    return today.filter((t) => t.status !== "done" && t.status !== "trashed" && !blocks.has(t.id));
  }, [today, ahead]);
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const go = (target: FocusTarget) => focusStore.focus(target);
  const slotColor = (b: (typeof ahead)[number]) => {
    const t = b.target;
    return t.kind === "slot" ? (slots.find((s) => s.id === t.slotId)?.color ?? "var(--slot)") : "var(--accent)";
  };

  return (
    <div className="focus" data-focus="pick">
      <div className="focus-head">
        <h2 className="text-display masthead focus-pick-hero">Focus</h2>
        <IconButton
          size="xs"
          className="focus-leave"
          label="Leave focus"
          shortcut={[...FOCUS_KEYS]}
          icon={<Icon name="close" size={12} />}
          onClick={focusStore.leave}
        />
      </div>

      {ahead.length > 0 && (
        <section className="rail-section">
          <SectionHeader title="Up next" count={ahead.length} />
          {ahead.map((b) => (
            <Row
              key={b.target.kind === "slot" ? b.target.slotId : b.target.kind === "task" ? b.target.taskId : "set"}
              data-focus-block=""
              leading={<Dot color={slotColor(b)} />}
              title={b.title}
              meta={b.target.kind === "slot" ? `${span(b.start, b.end)} · ${b.open} open` : span(b.start, b.end)}
              onActivate={() => go(b.target)}
            />
          ))}
        </section>
      )}

      {open.length > 0 ? (
        <section className="rail-section">
          <SectionHeader title={ahead.length ? "Or pick a few" : "Pick a few"} count={open.length} />
          <div className="focus-pick-list">{open.map((t) => renderTask(t, { picked: picked.includes(t.id), toggle: () => toggle(t.id) }))}</div>
        </section>
      ) : (
        <p className="focus-empty">Nothing open today</p>
      )}

      {picked.length > 0 && (
        <div className="focus-after">
          <Button size="sm" kind="primary" full onClick={() => go({ kind: "set", taskIds: picked })}>
            Focus on {picked.length}
          </Button>
        </div>
      )}
    </div>
  );
}
