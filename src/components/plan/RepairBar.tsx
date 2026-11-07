// The week, repaired in place (docs/plan-the-week-v2.md §7) — the desktop face.
//
// Floats over the Schedule only when the week broke. One row per broken block:
// a glyph for why (↯ a meeting landed on it · ◌ it was missed), its name, where
// the composer would put it, ‹ › for its other fits, ✓ take it, ✕ leave it. The
// focused row's target is drawn on the calendar as a ghost (CalendarPane `plan`).
// The dial decides how much happens on its own: Ask · Suggest · Handle.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Repair } from "../../hooks/useWeekRepair";
import { parseDateISO } from "../../lib/dates";
import { DIAL_NOTE, useDial } from "../../lib/planDial";
import { at } from "../mobile/dayPlan";
import type { PlanOverlay } from "./planOverlay";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const instantOf = (dayISO: string, min: number) => {
  const d = parseDateISO(dayISO);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d;
};
const LEFT_KEY = "nuvo.repairsLeft.v1";
const readLeft = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(LEFT_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};
const writeLeft = (s: Set<string>) => {
  try {
    localStorage.setItem(LEFT_KEY, JSON.stringify([...s].slice(-300)));
  } catch {
    /* forgetting a "leave it" only means it may be asked again */
  }
};

export interface RepairActs {
  /** move the broken block to a start; returns an undo */
  apply: (r: Repair, start: Date) => () => void;
}

/** Shared by the desktop bar and the phone card: which repairs show, and the acts. */
export function useRepairs(repairs: Repair[], acts: RepairActs) {
  const [dial] = useDial();
  const [left, setLeft] = useState<Set<string>>(readLeft);
  const [asked, setAsked] = useState(false);
  const [ix, setIx] = useState<Record<string, number>>({});
  const [applied, setApplied] = useState<{ key: string; label: string; undo: () => void }[]>([]);
  const handled = useRef<Set<string>>(new Set());

  const open = useMemo(() => repairs.filter((r) => !left.has(r.key) && !applied.some((a) => a.key === r.key)), [repairs, left, applied]);
  const staged = dial === "suggest" || (dial === "ask" && asked) ? open : [];

  const take = (r: Repair, auto = false) => {
    const o = r.options[ix[r.key] ?? 0] ?? r.options[0];
    const start = instantOf(o.dayISO, o.startMin);
    const undo = acts.apply(r, start);
    handled.current.add(r.key);
    setApplied((prev) => [...prev, { key: r.key, label: `${r.title} → ${DAY[start.getDay()]} ${at(start)}`, undo }]);
    if (!auto) toast(`Moved · ${r.title} → ${DAY[start.getDay()]} ${at(start)}`);
  };
  const leave = (r: Repair) => {
    const next = new Set(left);
    next.add(r.key);
    setLeft(next);
    writeLeft(next);
  };
  const cycle = (r: Repair, d: number) =>
    setIx((prev) => ({ ...prev, [r.key]: (((prev[r.key] ?? 0) + d) % r.options.length + r.options.length) % r.options.length }));
  const undo = (i: number) => {
    const a = applied[i];
    a.undo();
    setApplied((prev) => prev.filter((_, j) => j !== i));
    toast("Undone · back where it was");
  };

  // Handle: apply each break once, on its own, with an Undo (Q-14 — trial)
  useEffect(() => {
    if (dial !== "handle") return;
    const fresh = open.filter((r) => !handled.current.has(r.key));
    if (!fresh.length) return;
    for (const r of fresh) take(r, true);
    toast(`Moved ${fresh.length} for you · Undo is in the bar`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dial, open]);

  return { dial, open, staged, asked, setAsked, ix, cycle, take, leave, applied, undo };
}

export default function RepairBar({
  repairs,
  acts,
  onOverlay,
}: {
  repairs: Repair[];
  acts: RepairActs;
  onOverlay: (o: PlanOverlay | null) => void;
}) {
  const r = useRepairs(repairs, acts);
  const [, setDial] = useDial();
  const [focus, setFocus] = useState(0);
  const focused = r.staged[Math.min(focus, r.staged.length - 1)];

  // the focused repair's target, drawn on the calendar
  const overlay = useMemo<PlanOverlay | null>(() => {
    if (!focused) return null;
    const o = focused.options[r.ix[focused.key] ?? 0];
    return {
      blocks: [],
      ghosts: [
        {
          id: "repair",
          start: instantOf(o.dayISO, o.startMin).toISOString(),
          end: instantOf(o.dayISO, o.startMin + o.durationMin).toISOString(),
          label: `→ ${focused.title}`,
        },
      ],
      onSelect: () => {},
      onMove: () => {},
      onPickGhost: () => r.take(focused),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, r.ix]);
  useEffect(() => {
    onOverlay(overlay);
  }, [overlay, onOverlay]);
  useEffect(() => () => onOverlay(null), [onOverlay]);

  const broke = r.open.length;
  if (!r.staged.length && !r.applied.length && !(r.dial === "ask" && broke)) return null;

  return (
    <div className="glass-card absolute bottom-4 left-4 z-30 flex w-[340px] max-w-[calc(100%-2rem)] flex-col gap-2 rounded-[12px] border border-line p-3">
      <div className="flex items-center justify-between">
        <span className="section-label">The week broke</span>
        <div className="flex gap-0.5 rounded-[8px] border border-line p-0.5" role="group" aria-label="How much Nuvo moves">
          {(["ask", "suggest", "handle"] as const).map((v) => (
            <button
              key={v}
              aria-pressed={r.dial === v}
              title={DIAL_NOTE[v]}
              onClick={() => setDial(v)}
              className="rounded-[6px] px-1.5 text-micro capitalize"
              style={{ background: r.dial === v ? "var(--accent-soft)" : undefined, color: r.dial === v ? "var(--accent)" : "var(--muted)" }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {r.dial === "ask" && !r.asked && broke > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-muted">
            {broke} broke · nothing moved
          </span>
          <button className="rounded-full bg-accent px-3 py-1 text-caption text-on-accent" onClick={() => r.setAsked(true)}>
            Re-plan the rest of the week
          </button>
        </div>
      )}

      {r.staged.map((x, i) => {
        const o = x.options[r.ix[x.key] ?? 0];
        const s = instantOf(o.dayISO, o.startMin);
        return (
          <div
            key={x.key}
            className="-mx-1.5 flex min-h-[40px] items-center gap-1.5 rounded-[8px] px-1.5"
            style={{ background: focused?.key === x.key ? "var(--accent-soft)" : undefined }}
            onMouseEnter={() => setFocus(i)}
          >
            <span className="w-[16px] shrink-0 text-center text-accent" title={x.why === "missed" ? "missed" : `${x.event} landed on it`}>
              {x.why === "missed" ? "◌" : "↯"}
            </span>
            <span className="min-w-0 flex-1 truncate text-body" title={x.why === "missed" ? "Missed" : `${x.event} landed on it`}>
              {x.title}
            </span>
            <button aria-label="Earlier option" className="text-muted" onClick={() => r.cycle(x, -1)}>
              ‹
            </button>
            <span className="shrink-0 whitespace-nowrap rounded-full border border-accent px-2 text-micro">
              {DAY[s.getDay()]} {at(s)}
            </span>
            <button aria-label="Next option" className="text-muted" onClick={() => r.cycle(x, 1)}>
              ›
            </button>
            <button aria-label="Take it" onClick={() => r.take(x)} className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-[7px] bg-accent text-on-accent">
              ✓
            </button>
            <button aria-label="Leave it" onClick={() => r.leave(x)} className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-[7px] border border-line-strong">
              ✕
            </button>
          </div>
        );
      })}

      {r.applied.length > 0 && (
        <div className="flex flex-col border-t border-line pt-1">
          {r.applied.map((a, i) => (
            <div key={a.key} className="flex items-center justify-between gap-2 py-0.5 text-caption">
              <span className="min-w-0 truncate">✓ {a.label}</span>
              <button className="text-micro text-muted hover:text-text" onClick={() => r.undo(i)}>
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
      <span className="text-micro text-muted">↯ a meeting landed · ◌ missed · only the block that broke moves</span>
    </div>
  );
}
