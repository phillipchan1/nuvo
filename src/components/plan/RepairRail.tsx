// Repair — a rail mode (docs/rail-modes.md §2, D-204).
//
// The week broke: a meeting landed on a block, or a block was missed. Repair
// takes the rail over the way Plan the week does (PlanRail) — one broken block
// at a time, its target ghosted on the grid (CalendarPane `plan`), the
// composer's other fits stepped with ‹ ›, two acts that name where the block
// goes. Esc hands the rail back; so does deciding the last one. Nothing opens
// this but your press on the crown's line (RepairLine).
//
// The acts and which repairs show live in `useRepairs` (repairActs.ts), owned
// by the Planner so the line and the rail read one state. The dial is in
// Settings → Schedule, never here.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanOverlay } from "./planOverlay";
import { fitOf, instantOf, type RepairState } from "./repairActs";
import { LEAVE_IN_PLACE, moveLabel, whereSpan } from "./destinations";
import { Button, Card, Chip, EmptyState, IconButton, SectionHeader } from "../kit";
import { Icon } from "../Icon";
import { FlowHead } from "../rituals/FlowShell";
import PinnedCrown from "./PinnedCrown";

export default function RepairRail({
  state: r,
  onOverlay,
  onClose,
  railRef,
}: {
  state: RepairState;
  onOverlay: (o: PlanOverlay | null) => void;
  onClose: () => void;
  railRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const list = r.staged;
  const current = list.find((x) => x.key === cursor) ?? list[0] ?? null;
  const pos = current ? list.indexOf(current) : -1;

  // the current repair's target, drawn on the calendar
  const fit = current ? fitOf(current, r.ix) : null;
  const overlay = useMemo<PlanOverlay | null>(() => {
    if (!current || !fit) return null;
    return {
      blocks: [],
      ghosts: [
        {
          id: "repair",
          start: instantOf(fit.dayISO, fit.startMin).toISOString(),
          end: instantOf(fit.dayISO, fit.startMin + fit.durationMin).toISOString(),
          label: `→ ${current.title}`,
        },
      ],
      onSelect: () => {},
      onMove: () => {},
      onPickGhost: () => r.take(current),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key, fit?.dayISO, fit?.startMin, fit?.durationMin]);
  useEffect(() => {
    onOverlay(overlay);
  }, [overlay, onOverlay]);
  useEffect(() => () => onOverlay(null), [onOverlay]);

  // Leave: the last repair decided hands the rail back (rail-modes §2).
  const hadAny = useRef(false);
  useEffect(() => {
    if (list.length) hadAny.current = true;
    else if (hadAny.current) onClose();
  }, [list.length, onClose]);

  const step = (d: number) => {
    if (!list.length) return;
    setCursor(list[(((pos + d) % list.length) + list.length) % list.length].key);
  };
  const decide = (take: boolean) => {
    if (!current) return;
    const next = list[pos + 1] ?? list[pos - 1] ?? null;
    if (take) r.take(current);
    else r.leave(current);
    setCursor(next?.key ?? null);
  };

  const keys = useRef({ decide, step, current, onClose, cycle: r.cycle });
  keys.current = { decide, step, current, onClose, cycle: r.cycle };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.closest("input, textarea, [contenteditable=true], [data-nested-surface]") || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = keys.current;
      const eat = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === "Escape") return eat(), k.onClose();
      if (!k.current) return;
      if (e.key === "Enter") return eat(), k.decide(true);
      if (e.key === "Backspace") return eat(), k.decide(false);
      if (e.key === "ArrowRight") return eat(), k.cycle(k.current, 1);
      if (e.key === "ArrowLeft") return eat(), k.cycle(k.current, -1);
      if (e.key === "j") return eat(), k.step(1);
      if (e.key === "k") return eat(), k.step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      ref={railRef}
      data-repair-rail
      className="titlebar-pad relative z-40 flex h-full w-[340px] shrink-0 flex-col"
      style={{ borderRight: "1px solid var(--line-1)", ["--titlebar-pad-y" as string]: "0px" }}
    >
      <div className="flex h-12 shrink-0 items-center gap-1.5 pl-4 pr-2" style={{ boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
        <span className="f-title min-w-0 flex-1 truncate">Repair</span>
        {/* the crown, pinned (rail-modes §2) — the week being repaired, shut */}
        <PinnedCrown />
        <IconButton label="Back to your day" shortcut="Esc" icon={<Icon name="close" size={14} />} onClick={onClose} />
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto px-4 pb-5 pt-5">
        <FlowHead
          hero="The week broke."
          fact={
            list.length ? (
              <span>
                <b>{list.length}</b> block{list.length === 1 ? "" : "s"} to put back · nothing moves until you say
              </span>
            ) : undefined
          }
        />

        {list.length > 0 && (
          <div className="grid gap-2">
            <SectionHeader title={`Break ${pos + 1} of ${list.length}`} className="!px-0" />
            <div className="flex flex-wrap gap-[3px]" role="group" aria-label="Broken blocks">
              {list.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  className="f-pip"
                  data-size="sm"
                  aria-current={x.key === current?.key}
                  aria-label={x.title}
                  title={x.title}
                  onClick={() => setCursor(x.key)}
                  style={{ ["--h" as string]: "var(--warn)" }}
                />
              ))}
            </div>
          </div>
        )}

        {current && fit ? (
          <Card selected>
            <div className="flex min-w-0 items-start gap-2">
              <span className="w-4 shrink-0 pt-[1px] text-center text-body" style={{ color: "var(--warn)" }} aria-hidden>
                {current.why === "missed" ? "◌" : "↯"}
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <div className="f-title truncate">{current.title}</div>
                <div className="f-fact text-caption">
                  {current.why === "missed" ? "Missed" : `${current.event} landed on it`} · was {whereSpan(current.from)}
                </div>
              </div>
            </div>
            {current.options.length > 1 && (
              <div className="flex items-center gap-1">
                <IconButton size="xs" label="Earlier fit" shortcut="←" icon={<Icon name="chevron-left" size={12} />} onClick={() => r.cycle(current, -1)} />
                <Chip tone="accent">
                  <span className="f-num">{whereSpan(fit)}</span>
                </Chip>
                <IconButton size="xs" label="Next fit" shortcut="→" icon={<Icon name="chevron-right" size={12} />} onClick={() => r.cycle(current, 1)} />
                <span className="text-caption text-muted">
                  {(r.ix[current.key] ?? 0) + 1} of {current.options.length}
                </span>
              </div>
            )}
            <div className="grid gap-1.5 pt-0.5">
              <Button kind="primary" size="md" shortcut="↵" full onClick={() => decide(true)}>
                {moveLabel(fit)}
              </Button>
              <Button size="md" shortcut="⌫" full onClick={() => decide(false)}>
                {LEAVE_IN_PLACE}
              </Button>
            </div>
          </Card>
        ) : (
          !r.applied.length && <EmptyState>Nothing broke</EmptyState>
        )}

        {r.applied.length > 0 && (
          <section className="f-section">
            <SectionHeader title="Moved" count={r.applied.length} className="!px-0" />
            <div className="f-rows">
              {r.applied.map((a, i) => (
                <div key={a.key} className="flex min-h-[32px] items-center gap-2">
                  <Icon name="check" size={12} className="shrink-0" style={{ color: "var(--ok)" }} />
                  <span className="f-num min-w-0 flex-1 truncate text-caption text-[var(--ink-2)]">{a.label}</span>
                  <Button size="xs" kind="ghost" onClick={() => r.undo(i)}>
                    Undo
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {!list.length && (
        <div className="f-foot">
          <Button kind="primary" size="md" full onClick={onClose}>
            Back to your day
          </Button>
        </div>
      )}
    </div>
  );
}
