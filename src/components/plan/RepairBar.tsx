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
import { Button, Chip, IconButton, Segmented } from "../kit";
import { Icon } from "../Icon";

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
    <div className="f-dock absolute bottom-4 left-4 z-30 w-[352px] max-w-[calc(100%-2rem)] pop-in" style={{ ["--pop-origin" as string]: "bottom left" }}>
      <div className="flex items-center gap-2 py-2.5 pl-4 pr-2.5" style={{ boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
        <span className="f-title min-w-0 flex-1 truncate">The week broke</span>
        <Segmented
          size="sm"
          label="How much Nuvo moves"
          value={r.dial}
          onChange={setDial}
          options={(["ask", "suggest", "handle"] as const).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1), title: DIAL_NOTE[v] }))}
        />
      </div>

      <div className="grid gap-0.5 p-1.5">
        {r.dial === "ask" && !r.asked && broke > 0 && (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="f-fact">
              <b>{broke}</b> broke · nothing moved
            </span>
            <Button size="xs" kind="primary" onClick={() => r.setAsked(true)}>
              Re-plan the rest of the week
            </Button>
          </div>
        )}

        {r.staged.map((x, i) => {
          const o = x.options[r.ix[x.key] ?? 0];
          const s = instantOf(o.dayISO, o.startMin);
          const why = x.why === "missed" ? "Missed" : `${x.event} landed on it`;
          return (
            <div
              key={x.key}
              className="flex min-h-[38px] items-center gap-1.5 rounded-[var(--r-ctl)] px-2"
              style={{ background: focused?.key === x.key ? "var(--accent-wash)" : undefined }}
              onPointerEnter={() => setFocus(i)}
            >
              <span className="w-4 shrink-0 text-center text-body" style={{ color: "var(--accent-ink)" }} title={why} aria-label={why}>
                {x.why === "missed" ? "◌" : "↯"}
              </span>
              <span className="min-w-0 flex-1 truncate text-body font-medium" title={why}>
                {x.title}
              </span>
              <IconButton size="xs" label="Earlier option" icon={<Icon name="chevron-left" size={12} />} onClick={() => r.cycle(x, -1)} />
              <Chip tone="accent">
                <span className="f-num">
                  {DAY[s.getDay()]} {at(s)}
                </span>
              </Chip>
              <IconButton size="xs" label="Next option" icon={<Icon name="chevron-right" size={12} />} onClick={() => r.cycle(x, 1)} />
              <IconButton size="xs" kind="primary" label="Take it" icon={<Icon name="check" size={12} />} onClick={() => r.take(x)} />
              <IconButton size="xs" label="Leave it" icon={<Icon name="close" size={12} />} onClick={() => r.leave(x)} />
            </div>
          );
        })}

        {r.applied.length > 0 && (
          <div className="grid" style={{ boxShadow: "inset 0 1px 0 var(--line-1)", marginTop: 2, paddingTop: 2 }}>
            {r.applied.map((a, i) => (
              <div key={a.key} className="flex min-h-[32px] items-center gap-2 px-2">
                <Icon name="check" size={12} className="shrink-0" style={{ color: "var(--ok)" }} />
                <span className="f-num min-w-0 flex-1 truncate text-caption text-[var(--ink-2)]">{a.label}</span>
                <Button size="xs" kind="ghost" onClick={() => r.undo(i)}>
                  Undo
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
