// Expandable evidence under each domain in the hours weave — the receipts
// behind "you spent X hours in Y." Corrections re-attribute the source row.
// Sealed Reviews also surface a Day / Domain toggle over the same ledger.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { toast } from "sonner";
import { fmtHours, parseDateISO } from "../../lib/dates";
import { fmtMins } from "../../lib/now";
import {
  boardWeekStartISO,
  groupEvidenceByDay,
  type DayEvidence,
  type WeekReceipt,
} from "../../lib/weekEvidence";
import type { WeekReport } from "../../lib/composeWeek";
import type { Domain } from "../../lib/vertical";
import { useVertical } from "../../hooks/useVertical";
import { useTaskMutations } from "../../hooks/useTasks";
import { useEventRoutingMutations } from "../../hooks/useEventRouting";
import { firstDayOfWeek, useSettings } from "../../hooks/useSettings";
import { Modal } from "../ui";

function CorrectModal({
  receipt,
  domains,
  onClose,
  onPick,
}: {
  receipt: WeekReceipt;
  domains: Domain[];
  onClose: () => void;
  onPick: (domainId: string) => void;
}) {
  return (
    <Modal onClose={onClose} width="max-w-sm">
      <div className="p-5">
        <div className="section-label mb-2">Re-attribute</div>
        <p className="mb-4 text-body text-ink">Where should “{receipt.label}” count?</p>
        <div className="flex flex-col gap-1">
          {domains.map((d) => (
            <button
              key={d.id}
              onClick={() => onPick(d.id)}
              className="tap fast flex items-center gap-2 rounded-md px-3 py-2.5 text-left hover:bg-accent-soft"
            >
              <span style={{ color: d.color }}>{d.icon}</span>
              <span className="text-body text-ink">{d.name}</span>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="tap fast mt-4 w-full rounded-md border border-line py-2.5 text-label text-muted">
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Shared correction wiring for receipt chips + domain-lane drag. */
function useReceiptCorrection(onCorrected?: () => void) {
  const { data: vertical } = useVertical();
  const tasks = useTaskMutations();
  const { upsert: routeEvent } = useEventRoutingMutations();
  const [correcting, setCorrecting] = useState<WeekReceipt | null>(null);

  const reattribute = async (receipt: WeekReceipt, domainIdNext: string) => {
    if (receipt.domainId === domainIdNext) return;
    try {
      if (receipt.kind === "task") {
        tasks.patchTask(receipt.id, { domain_id: domainIdNext });
      } else if (receipt.kind === "event" && receipt.eventKey) {
        await routeEvent.mutateAsync({ eventKey: receipt.eventKey, domainId: domainIdNext });
      } else {
        return;
      }
      setCorrecting(null);
      toast.success("Updated.");
      onCorrected?.();
    } catch {
      toast.error("Couldn't update.");
    }
  };

  const apply = async (domainIdNext: string) => {
    if (!correcting) return;
    await reattribute(correcting, domainIdNext);
  };

  const modal = correcting ? (
    <CorrectModal
      receipt={correcting}
      domains={vertical.domains}
      onClose={() => setCorrecting(null)}
      onPick={(id) => void apply(id)}
    />
  ) : null;

  return { setCorrecting, modal, reattribute };
}

/** Compact receipt chip for the day spread — WeekBoard card grammar, but past-
 *  tense: muted + struck title so completed work doesn't read as open.
 *  On the domain board, chips are pointer-draggable (`draggable`) onto another
 *  lane; a plain tap still opens the Correct picker. */
function ReceiptChip({
  receipt,
  onCorrect,
  draggable,
}: {
  receipt: WeekReceipt;
  onCorrect?: (r: WeekReceipt) => void;
  /** When set, chip is a drag source for domain re-attribution (pointer events). */
  draggable?: boolean;
}) {
  const correctable = receipt.kind === "task" || receipt.kind === "event";
  const done = receipt.kind === "task";
  const meta =
    receipt.mins > 0
      ? fmtMins(receipt.mins)
      : receipt.kind === "activity"
        ? "shipped"
        : null;
  const inner = (
    <>
      <div className="flex items-start gap-1">
        {done && (
          <span className="mt-px shrink-0 text-micro leading-[15px] text-accent" aria-hidden>
            ✓
          </span>
        )}
        <div
          className={`line-clamp-2 min-w-0 flex-1 text-caption leading-[15px] ${
            done ? "h-[30px] text-muted line-through decoration-line" : "h-[30px] text-ink"
          }`}
        >
          {receipt.label}
        </div>
      </div>
      {meta && <div className="mono mt-0.5 truncate text-micro leading-[13px] text-muted">{meta}</div>}
    </>
  );
  const style = {
    boxShadow: `inset 3px 0 0 0 ${receipt.domainColor}`,
    opacity: done ? 0.85 : 1,
  } as const;
  const cls = `w-full rounded-lg border border-line bg-surface px-1.5 py-1.5 text-left ${draggable ? "cursor-grab active:cursor-grabbing touch-none select-none" : ""}`;

  if (receipt.url && !correctable) {
    return (
      <a href={receipt.url} target="_blank" rel="noreferrer" className={`${cls} tap fast block hover:border-line-strong`} style={style} title={receipt.label}>
        {inner}
      </a>
    );
  }
  if (draggable && receipt.kind === "task") {
    return (
      <div
        data-receipt-drag={receipt.id}
        className={`${cls} tap fast hover:border-line-strong`}
        style={style}
        title={`${receipt.label} — drag to another domain`}
      >
        {inner}
      </div>
    );
  }
  if (correctable && onCorrect) {
    return (
      <button type="button" onClick={() => onCorrect(receipt)} className={`${cls} tap fast hover:border-line-strong`} style={style} title={`${receipt.label} — tap to re-attribute`}>
        {inner}
      </button>
    );
  }
  return (
    <div className={cls} style={style} title={receipt.label}>
      {inner}
    </div>
  );
}

/**
 * Full-width Mon→Sun spread — mirrors Schedule's Spread (WeekBoard) lane grammar:
 * seven transparent columns, hairline separators, floating chips for completed
 * tasks. Quiet days keep their column with an em-dash so the week reads as one board.
 */
function DaySpread({
  days,
  onCorrected,
}: {
  days: DayEvidence[];
  onCorrected?: () => void;
}) {
  const { setCorrecting, modal } = useReceiptCorrection(onCorrected);
  const maxMins = Math.max(1, ...days.map((d) => d.mins));

  return (
    <>
      {/* Mobile: horizontal scroll keeps seven lanes readable; desktop fills the Review width. */}
      <div className="-mx-1 overflow-x-auto pb-1">
        <div className="grid min-w-[640px] grid-cols-7 md:min-w-0">
          {days.map((day, i) => {
            const quiet = day.receipts.length === 0;
            return (
              <div
                key={day.dayISO}
                className="flex min-h-0 flex-col px-1.5 pb-1.5 pt-2"
                style={{ borderRight: i < 6 ? "1px solid var(--line)" : undefined }}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-body font-semibold text-ink">{format(parseDateISO(day.dayISO), "EEE d")}</span>
                  <span className="mono shrink-0 text-micro text-muted">
                    {day.mins > 0 ? `${fmtHours(day.mins)}h` : "—"}
                  </span>
                </div>
                <div className="mb-2 mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                  <span
                    className="block h-full"
                    style={{
                      width: `${(day.mins / maxMins) * 100}%`,
                      background: day.mins > 0 ? "var(--muted)" : "transparent",
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  {day.receipts.map((r) => (
                    <ReceiptChip key={`${r.kind}:${r.id}`} receipt={r} onCorrect={setCorrecting} />
                  ))}
                  {quiet && (
                    <div className="flex h-12 items-center justify-center text-caption text-muted/50">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {modal}
    </>
  );
}

/**
 * Domain lanes of completed tasks — same chip grammar as the day spread, grouped
 * by domain. Count in the crown (not hours). Quiet domains stay as drop targets
 * so a misfiled task can be dragged onto them (pointer events — Tauri-safe).
 * A plain tap opens the Correct picker.
 */
function DomainTaskSpread({
  columns,
  onCorrected,
}: {
  columns: { id: string; name: string; color: string; receipts: WeekReceipt[] }[];
  onCorrected?: () => void;
}) {
  const { setCorrecting, modal, reattribute } = useReceiptCorrection(onCorrected);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ receipt: WeekReceipt; x: number; y: number } | null>(null);
  const [hoverDomain, setHoverDomain] = useState<string | null>(null);
  const n = Math.max(1, columns.length);

  const receiptById = useMemo(() => {
    const m = new Map<string, WeekReceipt>();
    for (const col of columns) for (const r of col.receipts) m.set(r.id, r);
    return m;
  }, [columns]);

  const live = useRef({ receiptById, reattribute, setCorrecting });
  live.current = { receiptById, reattribute, setCorrecting };

  useEffect(() => {
    const root = boardRef.current;
    if (!root) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as HTMLElement)?.closest?.("[data-receipt-drag]") as HTMLElement | null;
      if (!el || !root.contains(el)) return;
      const id = el.getAttribute("data-receipt-drag");
      const receipt = id ? live.current.receiptById.get(id) : null;
      if (!receipt || receipt.kind !== "task") return;

      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      let moved = false;
      let targetId: string | null = null;

      document.body.classList.add("wb-noselect");
      window.getSelection()?.removeAllRanges();

      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        if (!moved) {
          moved = true;
          document.body.style.cursor = "grabbing";
        }
        setDrag({ receipt, x: ev.clientX, y: ev.clientY });
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const lane = hit?.closest("[data-domain-lane]") as HTMLElement | null;
        targetId = lane?.getAttribute("data-domain-lane") ?? null;
        setHoverDomain(targetId);
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.classList.remove("wb-noselect");
        setDrag(null);
        setHoverDomain(null);
        if (!moved) {
          live.current.setCorrecting(receipt);
        } else if (targetId && targetId !== receipt.domainId) {
          void live.current.reattribute(receipt, targetId);
        }
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

    root.addEventListener("pointerdown", onDown);
    return () => root.removeEventListener("pointerdown", onDown);
  }, []);

  return (
    <>
      <p className="text-meta text-muted">Drag a task onto another domain to fix a misfile — or tap to pick.</p>
      <div ref={boardRef} className="-mx-1 overflow-x-auto pb-1">
        <div
          className="grid min-w-[480px] md:min-w-0"
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        >
          {columns.map((col, i) => {
            const hovered = hoverDomain === col.id;
            const quiet = col.receipts.length === 0;
            return (
              <div
                key={col.id}
                data-domain-lane={col.id}
                className="flex min-h-0 flex-col px-1.5 pb-1.5 pt-2"
                style={{
                  borderRight: i < n - 1 ? "1px solid var(--line)" : undefined,
                  background: hovered ? "var(--accent-soft)" : undefined,
                }}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-body font-semibold text-ink">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: col.color }} />
                    <span className="truncate">{col.name}</span>
                  </span>
                  <span className="mono shrink-0 text-micro text-muted">
                    {col.receipts.length > 0 ? col.receipts.length : "—"}
                  </span>
                </div>
                <div className="mb-2 mt-1.5 h-px" style={{ background: "var(--line)" }} />
                <div className="flex min-h-[48px] flex-col gap-1.5">
                  {col.receipts.map((r) => (
                    <ReceiptChip key={`${r.kind}:${r.id}`} receipt={r} draggable />
                  ))}
                  {quiet && (
                    <div
                      className="flex h-12 items-center justify-center rounded-lg border border-dashed text-caption"
                      style={{
                        borderColor: hovered ? "var(--accent)" : "var(--line)",
                        color: hovered ? "var(--accent)" : "var(--muted)",
                      }}
                    >
                      {hovered ? "drop here" : "—"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {drag &&
        createPortal(
          <div
            className="glass-grab pointer-events-none fixed z-[100] max-w-[200px] truncate rounded-md px-2 py-1.5 text-caption text-ink"
            style={{ left: drag.x + 12, top: drag.y + 10 }}
          >
            {drag.receipt.label}
          </div>,
          document.body,
        )}
      {modal}
    </>
  );
}

type BreakdownLens = "domain" | "day";

/**
 * Lived week: Day / Domain toggle over completed tasks from the evidence ledger.
 * Day = Mon→Sun spread; domain = one lane per domain with work.
 */
export function WeekHoursBreakdown({
  report,
  onCorrected,
  homeTz,
}: {
  report: WeekReport;
  onCorrected?: () => void;
  homeTz: string;
}) {
  const { settings } = useSettings();
  const weekStartsOn = firstDayOfWeek(settings);
  const [lens, setLens] = useState<BreakdownLens>("day");
  // Both lenses answer "what did I finish?" — completed tasks only.
  const taskReceipts = useMemo(
    () => report.evidence.receipts.filter((r) => r.kind === "task"),
    [report.evidence.receipts],
  );
  const days = useMemo(() => {
    // Schedule-style lanes (Sun→Sat by default) — display snap only; planning week stays Monday.
    const boardStart = boardWeekStartISO(report.weekStartISO, weekStartsOn);
    const all = groupEvidenceByDay(report.evidence, boardStart, homeTz, { includeEmpty: true });
    return all.map((d) => {
      const receipts = d.receipts.filter((r) => r.kind === "task");
      const mins = receipts.reduce((sum, r) => sum + r.mins, 0);
      return { ...d, receipts, mins };
    });
  }, [report.evidence, report.weekStartISO, homeTz, weekStartsOn]);
  const domainCols = useMemo(() => {
    // Keep quiet domains — they're empty drop targets for a misfiled task.
    return report.evidence.domains
      .map((d) => ({
        id: d.domainId,
        name: d.domainName,
        color: d.domainColor,
        receipts: d.receipts.filter((r) => r.kind === "task"),
      }))
      .sort((a, b) => b.receipts.length - a.receipts.length || a.name.localeCompare(b.name));
  }, [report.evidence.domains]);

  if (taskReceipts.length === 0) {
    return <p className="text-body text-muted">Nothing finished this week yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex max-w-xl gap-1 rounded-lg border border-line p-1">
        {(
          [
            { id: "day" as const, label: "By day" },
            { id: "domain" as const, label: "By domain" },
          ] as const
        ).map((t) => {
          const on = lens === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setLens(t.id)}
              className={`tap fast flex flex-1 items-center justify-center rounded-md py-2.5 text-body font-medium ${
                on ? "bg-accent text-on-accent" : "text-muted active:bg-surface-2"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {lens === "domain" && <DomainTaskSpread columns={domainCols} onCorrected={onCorrected} />}
      {lens === "day" && <DaySpread days={days} onCorrected={onCorrected} />}
    </div>
  );
}
