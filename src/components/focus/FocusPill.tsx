// The focus pill (D-242) — focus, small enough to stay with you while the work
// happens somewhere else.
//
// One line: the finish ring, the task you're on, the block's line (time left ·
// then …), and its check. Ticking moves it to the next open task; the last tick
// closes the ring with the ember stop, exactly as the rail's crown does — the
// same read (`readFocus` / `thenAfter` / `focusLine`), never a second rule.
//
// It is NOT a list: the block's other tasks stay in the rail (one row, D-111),
// and the title takes you there.
//
// Two mounts, ONE view (`FocusPillView`, drawn from a `FocusPillSnapshot`):
//   • in the app, floating while you're off the Schedule (`FocusPill`, below);
//   • on the desktop, in its own always-on-top window over every other app
//     (`FocusPillWindow`), fed the same snapshot by the main window.

import { useMemo } from "react";
import type { Slot, Task } from "../../lib/types";
import type { BusyBlock } from "../../lib/now";
import { readFocus, thenAfter, type FocusTarget } from "../../lib/focus";
import { pillRead, pillSnapshot, type FocusPillAct, type FocusPillSnapshot } from "../../lib/focusPill";
import { focusStore } from "../../hooks/useFocus";
import { Icon } from "../Icon";
import { Button, FinishRing, IconButton, Stop, TaskCheck } from "../kit";
import { FOCUS_KEYS, focusLine } from "./FocusPanel";

/** The pill, from a snapshot. Every tap is an act the host performs. */
export function FocusPillView({
  snap,
  now,
  onAct,
  className,
}: {
  snap: FocusPillSnapshot;
  now: Date;
  onAct: (a: FocusPillAct) => void;
  className?: string;
}) {
  const { read, then } = pillRead(snap);
  // How many are left is the ring's to say, not the line's.
  const line = focusLine(read, then, now);
  const said = [snap.named && !snap.closed ? snap.title : null, line || null].filter(Boolean).join(" · ");
  const task = snap.task;

  return (
    <div
      className={["focus-pill pop-in", className].filter(Boolean).join(" ")}
      role="status"
      aria-label="Focus"
      data-focus-pill=""
      data-closed={snap.closed || undefined}
    >
      <div className="focus-pill-row">
        <FinishRing outer={null} inner={snap.total ? snap.done / snap.total : 0} n={snap.done} of={snap.total} closed={snap.closed} tier="day" size={34} />
        <button type="button" className="focus-pill-body" onClick={() => onAct({ act: "show" })} title="Show the block">
          <span className="focus-pill-title">
            {snap.closed || !task ? snap.title : task.title}
            <Stop on={snap.closed} />
          </span>
          <span className="focus-pill-line">{said}</span>
        </button>
        {task && !snap.closed && (
          <TaskCheck checked={false} onChange={() => onAct({ act: "complete", taskId: task.id })} label={`Mark done — ${task.title}`} />
        )}
        <IconButton
          size="xs"
          className="focus-pill-leave"
          label="Leave focus"
          shortcut={[...FOCUS_KEYS]}
          icon={<Icon name="close" size={12} />}
          onClick={() => onAct({ act: "leave" })}
        />
      </div>
      {snap.closed && (
        <div className="focus-pill-after">
          <Button size="sm" kind="primary" onClick={() => onAct({ act: "next" })}>
            Focus on the next
          </Button>
          <Button size="sm" kind="ghost" onClick={() => onAct({ act: "leave" })}>
            Back to the day
          </Button>
        </div>
      )}
    </div>
  );
}

/** The theme the main window is wearing — the pill window wears it too. */
export function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Read a focus into the pill's snapshot (null when it's gone). */
export function useFocusPillSnapshot({
  target,
  pool,
  slots,
  slotTitle,
  busy,
  now,
}: {
  target: FocusTarget | null;
  pool: readonly Task[];
  slots: readonly Slot[];
  slotTitle?: (s: Slot, children: Task[]) => string;
  busy: readonly BusyBlock[];
  now: Date;
}): FocusPillSnapshot | null {
  return useMemo(() => {
    if (!target) return null;
    const read = readFocus(target, pool, slots, slotTitle);
    if (!read) return null;
    return pillSnapshot(target, read, thenAfter(read, busy, now), currentTheme());
  }, [target, pool, slots, slotTitle, busy, now]);
}

/** Perform a pill's act against the host's own mutations. */
export function performPillAct(
  a: FocusPillAct,
  pool: readonly Task[],
  { complete, show, next }: { complete: (t: Task) => void; show: () => void; next: () => void },
) {
  if (a.act === "complete") {
    const t = pool.find((x) => x.id === a.taskId);
    if (t && t.status !== "done") complete(t);
  } else if (a.act === "show") show();
  else if (a.act === "next") {
    focusStore.pick();
    next();
  } else focusStore.leave();
}

/** The in-app pill: floats while you're off the Schedule. */
export default function FocusPill({
  target,
  pool,
  slots,
  slotTitle,
  busy,
  now,
  onComplete,
  onShow,
  onNext,
}: {
  target: FocusTarget;
  /** today's tasks (done included) + the inbox — what the rail reads */
  pool: readonly Task[];
  slots: readonly Slot[];
  slotTitle?: (s: Slot, children: Task[]) => string;
  busy: readonly BusyBlock[];
  now: Date;
  onComplete: (t: Task) => void;
  /** take me to the block (the Schedule, rail in focus) */
  onShow: () => void;
  /** the block closed: pick the next one (the Schedule's picker) */
  onNext: () => void;
}) {
  const snap = useFocusPillSnapshot({ target, pool, slots, slotTitle, busy, now });
  if (!snap) return null;
  return <FocusPillView snap={snap} now={now} onAct={(a) => performPillAct(a, pool, { complete: onComplete, show: onShow, next: onNext })} />;
}
