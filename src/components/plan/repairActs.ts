// The week, repaired in place (docs/plan-the-week-v2.md §7) — the acts, shared
// by the desktop's repair rail (RepairRail, a rail mode — docs/rail-modes.md §2)
// and the phone's card (MobileRepairCard). Which repairs show, which fit each
// one is on, take / leave / undo, and the dial's Handle. The dial itself is set
// in Settings → Schedule only (D-204); this reads it.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Repair } from "../../hooks/useWeekRepair";
import { useDial } from "../../lib/planDial";
import { useSettings } from "../../hooks/useSettings";
import { instantAt, whereSpan } from "./destinations";
import { useTaskMutations } from "../../hooks/useTasks";
import { useSlotMutations } from "../../hooks/useSlots";
import { toDateISO } from "../../lib/dates";

export const instantOf = instantAt;

const LEFT_KEY = "nuvo.repairsLeft.v1";
const readLeft = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(LEFT_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};
const LEFT_MAX = 300;
const writeLeft = (s: Set<string>) => {
  try {
    localStorage.setItem(LEFT_KEY, JSON.stringify([...s].slice(-LEFT_MAX)));
  } catch {
    /* forgetting a "leave it" only means it may be asked again */
  }
};

export interface RepairActs {
  /** move the broken block to a start (`mins`: the length the chosen time
   *  said, when it differs); returns an undo */
  apply: (r: Repair, start: Date, mins?: number) => () => void;
}

/** How a repair moves the week — ONE act for both shells (the Schedule's rail
 *  and the phone's card had a copy each). A task is re-blocked; a missed or
 *  displaced block moves whole; a block's leftover work (D-232) leaves the block
 *  where it was and moves on its own — one task as its own block, several as a
 *  new block of the same name. Each returns its undo. */
export function useRepairApply(): RepairActs {
  const mutations = useTaskMutations();
  const slotMutations = useSlotMutations();
  return useMemo(
    () => ({
      apply: (r: Repair, start: Date, chosen?: number) => {
        if (r.kind === "task" && r.task) {
          const task = r.task;
          const was = new Date(task.start_time!);
          mutations.block(task, start, r.from.durationMin);
          return () => mutations.block(task, was, r.from.durationMin);
        }
        if (r.kind === "leftover" && r.leftover?.length && r.slot) {
          const from = r.slot;
          const work = r.leftover;
          const snaps = work.map((t) => ({ id: t.id, status: t.status, do_date: t.do_date, start_time: t.start_time, slot_id: t.slot_id }));
          const back = () => snaps.forEach(({ id, ...snap }) => mutations.patchTask(id, snap, { undo: false }));
          const mins = chosen ?? r.moveMin ?? r.from.durationMin;
          if (work.length === 1) {
            mutations.block(work[0], start, mins, { undo: false });
            return back;
          }
          const slot = slotMutations.createSlot({
            title: from.title ?? "",
            do_date: toDateISO(start),
            start_time: start.toISOString(),
            duration_minutes: mins,
            project_id: from.project_id ?? null,
            domain_id: from.domain_id ?? null,
            color: from.color ?? null,
          });
          // the slot's insert is queued first, so nothing points at a row the
          // server hasn't seen yet (the outbox trap in CLAUDE.md)
          work.forEach((t) => mutations.assignToSlot(t, slot, { undo: false }));
          return () => {
            back();
            slotMutations.removeSlot(slot);
          };
        }
        const slot = r.slot!;
        const before = { start_time: slot.start_time, do_date: slot.do_date };
        slotMutations.updateSlot({ id: slot.id, patch: { start_time: start.toISOString(), do_date: toDateISO(start) } });
        return () => slotMutations.updateSlot({ id: slot.id, patch: before });
      },
    }),
    [mutations, slotMutations],
  );
}

/** The fit a repair is currently on (‹ › step through the composer's others). */
export const fitOf = (r: Repair, ix: Record<string, number>) => r.options[ix[r.key] ?? 0] ?? r.options[0];

export type RepairState = ReturnType<typeof useRepairs>;

/** Which repairs show, and the acts. One instance per shell, owned by the host. */
export function useRepairs(repairs: Repair[], acts: RepairActs) {
  const [dial] = useDial();
  // "Leave it where it is" is remembered per ACCOUNT (D-207): the settings row's
  // `repairs_left`, so the phone doesn't ask what the Mac was told. Until
  // migration 95 runs the column is absent and this device's list is used —
  // never a write to a missing column (it would park the outbox op).
  const { settings, update } = useSettings();
  const synced = Boolean(settings && "repairs_left" in settings);
  const accountLeft = settings?.repairs_left;
  const [local, setLocal] = useState<Set<string>>(readLeft);
  const left = useMemo(() => new Set([...local, ...(accountLeft ?? [])]), [local, accountLeft]);
  const [asked, setAsked] = useState(false);
  const [ix, setIx] = useState<Record<string, number>>({});
  const [applied, setApplied] = useState<{ key: string; label: string; undo: () => void }[]>([]);
  const handled = useRef<Set<string>>(new Set());

  const open = useMemo(() => repairs.filter((r) => !left.has(r.key) && !applied.some((a) => a.key === r.key)), [repairs, left, applied]);
  const staged = dial === "suggest" || (dial === "ask" && asked) ? open : [];

  const undo = (i: number) => {
    const a = applied[i];
    if (!a) return;
    a.undo();
    setApplied((prev) => prev.filter((_, j) => j !== i));
    toast("Undone · back where it was");
  };
  /** `at`: a time chosen in Other times instead of the fit on show (R13) */
  const take = (r: Repair, auto = false, at?: { dayISO: string; startMin: number; durationMin: number }) => {
    const o = at ?? fitOf(r, ix);
    const start = instantOf(o.dayISO, o.startMin);
    const undoIt = acts.apply(r, start, o.durationMin);
    handled.current.add(r.key);
    const label = `${r.title} → ${whereSpan(o)}`;
    setApplied((prev) => [...prev, { key: r.key, label, undo: undoIt }]);
    if (!auto)
      toast(`Moved · ${label}`, {
        action: {
          label: "Undo",
          onClick: () => {
            undoIt();
            setApplied((prev) => prev.filter((a) => a.key !== r.key));
          },
        },
      });
  };
  const leave = (r: Repair) => {
    const next = new Set(left);
    next.add(r.key);
    setLocal(next);
    writeLeft(next);
    if (synced) update({ repairs_left: [...next].slice(-LEFT_MAX) });
  };
  const cycle = (r: Repair, d: number) =>
    setIx((prev) => ({ ...prev, [r.key]: (((prev[r.key] ?? 0) + d) % r.options.length + r.options.length) % r.options.length }));

  // Handle: apply each break once, on its own, with an Undo (Q-14 — trial)
  useEffect(() => {
    if (dial !== "handle") return;
    const fresh = open.filter((r) => !handled.current.has(r.key));
    if (!fresh.length) return;
    for (const r of fresh) take(r, true);
    toast(`Moved ${fresh.length} for you · Review them from the rail`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dial, open]);

  return { dial, open, staged, asked, setAsked, ix, cycle, take, leave, applied, undo };
}
