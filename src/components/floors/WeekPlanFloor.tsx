// The Week's Plan / Review — one surface, two states. Forming (this week, mid-
// week, present tense) and sealed (a past week, looking back). It slides over the
// Schedule calendar (full-width, hiding the task rail — this is a moment to
// receive, not to triage). You reach past weeks by walking ‹ ›.
//
// Wide, low-scroll layout: a hero (emblem + the warm brief), then two columns —
// THIS WEEK (reckon each priority: complete / carry) and NEXT WEEK (capture what's
// in your head + what carried) — then the hours weave + the highlights that
// actually moved a domain. The big priority actions are just two: land it, or
// carry it forward. No domain-linking here (that's not this moment's job).

import { useRef, useState, useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { addDays } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { fmtHours, parseDateISO, toDateISO } from "../../lib/dates";
import { sprintLabel } from "../../lib/sprint";
import { fmtMins } from "../../lib/now";
import type { WeekReport, WeekPriority } from "../../lib/composeWeek";
import { useWeekSprintRocks } from "../../hooks/useWeekSprintRocks";
import { useWeekReviewActions, useWeekReviewRow } from "../../hooks/useWeekReview";
import WeekEmblem from "./WeekEmblem";
import WeekStory from "./WeekStory";
import { WhatYouBuilt } from "./WhatYouBuilt";
import { WeekFindCard } from "./WeekFind";
import { DomainEvidenceList } from "./WeekEvidence";
import { Bar, InlineText } from "./parts";
import type { BigRock } from "../../lib/types";

// A six-dot grip — the affordance for pointer-drag reorder (Tauri swallows
// HTML5 DnD, so all drag is pointer-based; see CLAUDE.md / nuvo-tauri-dnd).
function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden>
      {[4, 8, 12].map((cy) => (
        <g key={cy}>
          <circle cx="3" cy={cy} r="1.1" />
          <circle cx="7" cy={cy} r="1.1" />
        </g>
      ))}
    </svg>
  );
}

// ── This week — reckon each priority: land it (complete) or carry it forward ──
function ReckonRow({
  p,
  onToggleDone,
  onCarry,
  onRemove,
  onEdit,
  dragHandle,
  dragging,
  dragOffsetY = 0,
}: {
  p: WeekPriority;
  onToggleDone: () => void;
  onCarry: () => void;
  onRemove: () => void;
  /** edit title / description in place (editable weeks only; omitted = read-only). */
  onEdit?: (patch: Partial<BigRock>) => void;
  /** pointer-drag grip rendered at the left when the list is reorderable. */
  dragHandle?: ReactNode;
  dragging?: boolean;
  /** while dragging, how far the pointer has moved — the card follows it. */
  dragOffsetY?: number;
}) {
  const landed = p.verdict === "landed";
  return (
    <div
      className={`group flex items-start gap-2 py-3 ${dragging ? "glass-grab relative z-50 rounded-lg px-2" : "border-b border-line last:border-0"}`}
      style={dragging ? { transform: `translateY(${dragOffsetY}px) scale(1.025)` } : undefined}
    >
      {dragHandle}
      <button
        onClick={onToggleDone}
        aria-label={landed ? "Mark not done" : "Mark complete"}
        className={`fast mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-micro leading-none ${
          landed ? "border-accent bg-accent text-white" : "border-line-strong text-transparent hover:border-accent"
        }`}
      >
        ✓
      </button>
      <div className="min-w-0 flex-1">
        {onEdit ? (
          <>
            <InlineText
              value={p.rock.title}
              onChange={(v) => onEdit({ title: v })}
              placeholder="Untitled priority"
              className={`block text-body ${landed ? "text-muted line-through" : "text-ink"}`}
              inputClassName="text-body text-ink"
            />
            <InlineText
              value={p.rock.win ?? ""}
              onChange={(v) => onEdit({ win: v })}
              placeholder="add a note…"
              className="block text-meta text-muted"
              inputClassName="text-meta text-ink"
            />
          </>
        ) : (
          <>
            <div className={`text-body ${landed ? "text-muted line-through" : "text-ink"}`}>{p.rock.title}</div>
            {p.rock.win && <div className="text-meta text-muted">{p.rock.win}</div>}
          </>
        )}
        <div className="mt-1 flex items-center gap-3">
          {p.rock.roll_count > 0 && <span className="mono text-micro text-signal">carried {p.rock.roll_count}w</span>}
          {!landed && (
            <button onClick={onCarry} className="fast text-micro font-medium text-slot hover:text-ink">
              Carry to next week →
            </button>
          )}
          <button
            onClick={onRemove}
            className="fast ml-auto text-micro text-muted opacity-0 hover:text-ink group-hover:opacity-100"
            aria-label="Remove priority"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reorderable priority list — pointer-drag sortable (Tauri- + touch-safe). ──
// Drag the grip; rows resort live as the pointer crosses neighbours' midpoints;
// the new order persists on drop. Order survives because composeWeek renders
// priorities in big_rocks array order (no re-sort).
function ReorderablePriorities({
  priorities,
  onToggleDone,
  onCarry,
  onRemove,
  onUpdate,
  onReorder,
}: {
  priorities: WeekPriority[];
  onToggleDone: (id: string) => void;
  onCarry: (p: WeekPriority) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<BigRock>) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  // dragId drives which row lifts (state, for render); refs carry live drag data
  // so the move/up handlers never read stale closures.
  const [dragId, setDragId] = useState<string | null>(null);
  const [offsetY, setOffsetY] = useState(0);
  const [lineTop, setLineTop] = useState<number | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const startYRef = useRef(0);
  const targetKRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const ids = priorities.map((p) => p.rock.id);

  const start = (id: string, e: React.PointerEvent) => {
    e.preventDefault();
    dragIdRef.current = id;
    startYRef.current = e.clientY;
    setDragId(id);
    setOffsetY(0);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const id = dragIdRef.current;
    if (!id || !containerRef.current) return;
    setOffsetY(e.clientY - startYRef.current);
    const cont = containerRef.current;
    const others = [...cont.querySelectorAll("[data-rock-id]")].filter(
      (r) => r.getAttribute("data-rock-id") !== id,
    );
    // landing index = how many other rows have their midpoint above the pointer
    let k = 0;
    for (const r of others) {
      const b = r.getBoundingClientRect();
      if (e.clientY > b.top + b.height / 2) k++;
    }
    targetKRef.current = k;
    // place the drop indicator at the resulting gap
    const contTop = cont.getBoundingClientRect().top;
    if (!others.length) setLineTop(0);
    else if (k < others.length) setLineTop(others[k].getBoundingClientRect().top - contTop);
    else setLineTop(others[others.length - 1].getBoundingClientRect().bottom - contTop);
  };
  const end = () => {
    const id = dragIdRef.current;
    dragIdRef.current = null;
    setDragId(null);
    setLineTop(null);
    setOffsetY(0);
    if (!id) return;
    const others = ids.filter((x) => x !== id);
    const k = targetKRef.current;
    const next = [...others.slice(0, k), id, ...others.slice(k)];
    if (next.some((x, i) => x !== ids[i])) onReorder(next);
  };

  return (
    <div ref={containerRef} className="relative flex flex-col">
      {lineTop != null && (
        <div
          className="pointer-events-none absolute left-0 right-0 z-40 h-0.5 rounded-full"
          style={{ top: lineTop, background: "var(--accent)" }}
        />
      )}
      {priorities.map((p) => (
        <div key={p.rock.id} data-rock-id={p.rock.id}>
          <ReckonRow
            p={p}
            dragging={dragId === p.rock.id}
            dragOffsetY={dragId === p.rock.id ? offsetY : 0}
            dragHandle={
              <button
                onPointerDown={(e) => start(p.rock.id, e)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                aria-label="Drag to reorder"
                title="Drag to reorder"
                className="fast mt-0.5 flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted/40 hover:text-ink active:cursor-grabbing"
                style={{ touchAction: "none" }}
              >
                <GripIcon />
              </button>
            }
            onToggleDone={() => onToggleDone(p.rock.id)}
            onCarry={() => onCarry(p)}
            onRemove={() => onRemove(p.rock.id)}
            onEdit={(patch) => onUpdate(p.rock.id, patch)}
          />
        </div>
      ))}
    </div>
  );
}

// ── Dump-one-per-line capture — the low-data-entry way to name priorities ─────
function RockCapture({ onAdd, placeholder, rows = 2 }: { onAdd: (titles: string[]) => void; placeholder: string; rows?: number }) {
  const [text, setText] = useState("");
  const submit = () => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length) onAdd(lines);
    setText("");
  };
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submit();
        }
      }}
      rows={rows}
      placeholder={placeholder}
      className="w-full resize-none rounded-lg border border-line bg-surface/60 px-3 py-2.5 text-body text-ink outline-none placeholder:text-muted/70 focus:border-accent"
    />
  );
}

// ── Next week — capture what's in your head + what carried over ────────────────
function NextWeek({ rocks, onAdd, onRemove }: { rocks: { id: string; title: string; roll_count: number }[]; onAdd: (titles: string[]) => void; onRemove: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <RockCapture onAdd={onAdd} placeholder="What matters next week? Dump it — one per line. Leftovers carry themselves." />
      {rocks.length === 0 ? (
        <p className="text-meta text-muted">Nothing queued yet. Sunday will start from here.</p>
      ) : (
        <div className="flex flex-col">
          {rocks.map((r) => (
            <div key={r.id} className="group flex items-baseline gap-2 border-b border-line py-2 text-body last:border-0">
              <span className="text-slot">→</span>
              <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span>
              {r.roll_count > 0 && <span className="mono shrink-0 text-micro text-signal">carried {r.roll_count}w</span>}
              <button
                onClick={() => onRemove(r.id)}
                className="fast shrink-0 text-micro text-muted opacity-0 hover:text-ink group-hover:opacity-100"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Where the hours went — capacity + the per-domain weave, with expandable receipts. */
function HoursWeave({ report, onCorrected }: { report: WeekReport; onCorrected?: () => void }) {
  const { capacity, domains, evidence } = report;
  const [openId, setOpenId] = useState<string | null>(null);
  const busyPct = capacity.workMins > 0 ? (capacity.busyMins / capacity.workMins) * 100 : 0;
  const maxH = Math.max(1, ...domains.map((d) => Math.max(d.hours, d.target)));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-meta text-muted">Committed</span>
          <span className="mono text-meta text-muted">
            {fmtMins(capacity.busyMins)} of {fmtMins(capacity.workMins)} · {fmtMins(capacity.openMins)} open
          </span>
        </div>
        <Bar pct={busyPct} color="var(--accent)" h={2} />
      </div>
      <div className="flex flex-col gap-2.5">
        {domains.map((d) => {
          const expanded = openId === d.id;
          const hasReceipts = (evidence?.domains.find((e) => e.domainId === d.id)?.receipts.length ?? 0) > 0;
          return (
            <div key={d.id}>
              <button
                type="button"
                onClick={() => hasReceipts && setOpenId(expanded ? null : d.id)}
                className={`flex w-full items-center gap-3 text-left ${hasReceipts ? "tap cursor-pointer" : "cursor-default"}`}
                aria-expanded={expanded}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.quiet ? "var(--line-strong)" : d.color, opacity: d.quiet ? 0.5 : 1 }} />
                <span className="w-24 shrink-0 truncate text-meta text-ink">{d.name}</span>
                <div className="min-w-0 flex-1">
                  <Bar pct={(d.hours / maxH) * 100} color={d.quiet ? "var(--line-strong)" : d.color} baseline={d.target > 0 ? (d.target / maxH) * 100 : undefined} h={1.5} />
                </div>
                <span className="mono w-14 shrink-0 text-right text-micro text-muted">{fmtHours(d.hours * 60)}h</span>
              </button>
              {expanded && evidence && (
                <div className="mb-1 ml-5 mt-1 border-l border-line pl-3">
                  <DomainEvidenceList evidence={evidence} domainId={d.id} onCorrected={onCorrected} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Highlights — the done work that actually moved a domain (felt impact). */
function Highlights({ report }: { report: WeekReport }) {
  if (report.highlights.length === 0) {
    return <p className="text-meta text-muted">No domain-tagged work logged this week.</p>;
  }
  return (
    <div className="flex flex-col">
      {report.highlights.map((h, i) => (
        <div key={i} className="flex items-baseline gap-3 border-b border-line py-2 last:border-0">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: h.domainColor }} />
          <span className="min-w-0 flex-1 truncate text-body text-ink">{h.title}</span>
          <span className="shrink-0 text-meta text-muted" style={{ color: h.domainColor }}>{h.domainName}</span>
          {h.mins > 0 && <span className="mono shrink-0 text-micro text-muted">{fmtMins(h.mins)}</span>}
        </div>
      ))}
    </div>
  );
}

function Col({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <div className="section-label mb-3">{label}</div>
      {children}
    </section>
  );
}

/** The scrollable content — shared by the desktop floor and the mobile Plan tab.
 *  `header` lets each shell supply its own title/close treatment. */
export function WeekPlanBody({
  report,
  state,
  tense = "current",
  viewedWeekISO,
  header,
  onCompose,
  composeLabel,
}: {
  report: WeekReport;
  state: "forming" | "sealed";
  /** "ahead" = planning a not-yet-started week · "current" = the lived week · "past" = sealed. */
  tense?: "ahead" | "current" | "past";
  viewedWeekISO: string;
  header?: ReactNode;
  /** Launch the compose + time-block ritual. Omitted on surfaces where the
   *  ritual isn't mounted (e.g. mobile) — the CTA then hides itself. */
  onCompose?: () => void;
  /** CTA wording — "Plan the week" when fresh, "Re-plan the week" once planned. */
  composeLabel?: string;
}) {
  const forming = state === "forming";
  const ahead = tense === "ahead";
  // Where time-sections sit on the arc: a week not yet lived shows *planned*
  // allocation; the lived week shows it *filling*; a sealed week, where it *went*.
  const hoursLabel = tense === "ahead" ? "Where the hours will go" : tense === "current" ? "Where the hours are going" : "Where the hours went";
  const total = report.priorityTotal;
  const nextWeekISO = toDateISO(addDays(parseDateISO(viewedWeekISO), 7));
  const thisWeek = useWeekSprintRocks(viewedWeekISO);
  const nextWeek = useWeekSprintRocks(nextWeekISO);
  const reviewActions = useWeekReviewActions(viewedWeekISO);
  const sealedRow = useWeekReviewRow(viewedWeekISO);
  const qc = useQueryClient();

  // Seal the Review once when viewing a lived week that has no durable snapshot yet.
  useEffect(() => {
    if (ahead) return;
    if (sealedRow.isLoading) return;
    const hasFull = sealedRow.data?.report && typeof sealedRow.data.report === "object" && "emblem" in sealedRow.data.report;
    if (hasFull) return;
    void reviewActions.seal.mutateAsync(report).catch(() => {});
    // Only on first open / week change — not on every report tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedWeekISO, ahead, sealedRow.isLoading, sealedRow.data?.id]);

  const reseal = () => {
    void qc.invalidateQueries({ queryKey: ["vertical"] });
    void qc.invalidateQueries({ queryKey: ["event_domain_routing"] });
    window.setTimeout(() => {
      void reviewActions.reseal(report).catch(() => {});
    }, 400);
  };

  const carry = (p: WeekPriority) => {
    const n = nextWeek.carryIn([p.rock]);
    toast.success(n > 0 ? `Carried "${p.rock.title}" into next week.` : "Already in next week.");
  };

  return (
    <>
      {header}

      {/* HERO — emblem + the warm brief, side by side (uses the width) */}
      <div className="mb-12 grid items-center gap-8 md:grid-cols-[240px_1fr]">
        <div className="flex justify-center">
          <WeekEmblem spec={report.emblem} state={state} size={220} />
        </div>
        <div>
          {total > 0 && (
            <div className="mb-3">
              {ahead ? (
                <>
                  <span className="mono text-head text-ink">{total}</span>
                  <span className="ml-2 text-meta text-muted">priorit{total === 1 ? "y" : "ies"} set for the week</span>
                </>
              ) : (
                <>
                  <span className="mono text-head text-ink">{report.landedCount} of {total}</span>
                  <span className="ml-2 text-meta text-muted">priorit{total === 1 ? "y" : "ies"} landed</span>
                </>
              )}
            </div>
          )}
          {/* The deterministic brief narrates the week that *was* — skip it for a
              week you're planning (nothing has happened yet). */}
          {report.brief && !ahead && <p className="serif text-lead leading-relaxed text-ink">{report.brief}</p>}
          {ahead && <p className="serif text-lead leading-relaxed text-ink">Here's the week ahead. Name what matters, then compose it into time.</p>}

          {/* The week's forward job: turn the projects into time blocks. The door
              to the planning flow lives here so the week button is one place. */}
          {forming && onCompose && (
            <div className="mt-5">
              <button
                onClick={onCompose}
                className="fast inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-label font-medium text-white shadow-sm hover:brightness-110 hover:shadow-[0_6px_16px_-6px_var(--accent-glow)] active:translate-y-px"
              >
                {composeLabel ?? "Plan the week"}
                <span aria-hidden>→</span>
              </button>
              <p className="mt-2 text-meta text-muted">Projects, leftovers and the inbox — placed against your real calendar.</p>
            </div>
          )}
        </div>
      </div>

      {/* MAIN — the week's priorities (set / reckon) | time | (lived weeks) forward-fold */}
      <div className="grid gap-x-14 gap-y-10 md:grid-cols-2">
        <div data-marquee="priorities">
        <Col label={forming ? (ahead ? "The week's priorities" : "This week's priorities") : "How they landed"}>
          {report.priorities.length > 0 && (
            <div className="mb-3">
              {forming ? (
                // Forming weeks: drag the grip to reorder priorities on the fly.
                <ReorderablePriorities
                  priorities={report.priorities}
                  onToggleDone={thisWeek.toggleDone}
                  onCarry={carry}
                  onRemove={thisWeek.removeRock}
                  onUpdate={thisWeek.updateRock}
                  onReorder={thisWeek.reorder}
                />
              ) : (
                <div className="flex flex-col">
                  {report.priorities.map((p) => (
                    <ReckonRow
                      key={p.rock.id}
                      p={p}
                      onToggleDone={() => thisWeek.toggleDone(p.rock.id)}
                      onCarry={() => carry(p)}
                      onRemove={() => thisWeek.removeRock(p.rock.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Forming weeks are editable — name priorities here (Compose then blocks
              them). Sealed weeks are read-only. */}
          {forming ? (
            <RockCapture
              onAdd={thisWeek.addTitles}
              placeholder={report.priorities.length === 0 ? "What needs to happen this week? Name it — one per line." : "Add another priority…"}
            />
          ) : (
            report.priorities.length === 0 && <p className="text-body text-muted">No priorities were named this week.</p>
          )}
        </Col>
        </div>

        <div data-marquee="hours">
        <Col label={hoursLabel}>
          <HoursWeave report={report} onCorrected={reseal} />
        </Col>
        </div>

        {/* The Find — one discovery; self-hides when nothing notable / ahead week. */}
        {!ahead && report.find && (
          <div className="md:col-span-2">
            <WeekFindCard find={report.find} weekStartISO={viewedWeekISO} sealed={state === "sealed"} onReseal={reseal} />
          </div>
        )}

        {/* Next week capture is a forward-fold for the *lived* week. On a week
            you're planning ahead, "next week" would be two weeks out — drop it. */}
        {!ahead && (
          <div data-marquee="next-week">
          <Col label="Next week">
            <NextWeek rocks={nextWeek.rocks} onAdd={nextWeek.addTitles} onRemove={nextWeek.removeRock} />
          </Col>
          </div>
        )}

        {/* Highlights are spent-work — meaningless before the week has run. */}
        {!ahead && (
          <div data-marquee="highlights">
          <Col label="Highlights — what moved a domain">
            <Highlights report={report} />
          </Col>
          </div>
        )}

        {/* What you built — merged PRs as shipped work (self-hides if none). */}
        {!ahead && <WhatYouBuilt weekStartISO={viewedWeekISO} />}
      </div>
    </>
  );
}

export interface WeekPlanFloorProps {
  report: WeekReport;
  state: "forming" | "sealed";
  /** "ahead" = a week you're planning · "current" = the lived week · "past" = sealed. */
  tense?: "ahead" | "current" | "past";
  /** "Jun 15 – 21" — the week's span. */
  weekLabel: string;
  viewedWeekISO: string;
  onClose: () => void;
  /** time-walk to the previous/next week (sealed archive ‹ ›). */
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  canGoNext?: boolean;
  /** Launch the compose + time-block ritual from the forming hero. */
  onCompose?: () => void;
  /** CTA wording — "Plan the week" when fresh, "Re-plan the week" once planned. */
  composeLabel?: string;
  /** Play the paced recap animation on open — the Review's reveal moment only.
   *  A check-in / plan view opens straight to the static detail. */
  story?: boolean;
}

/** The desktop floor — slides over the Schedule work area (full-width, rail hidden).
 *  Opens as a paced story (the received moment); "See the full week" → the detail. */
export default function WeekPlanFloor({ report, state, tense = "current", weekLabel, viewedWeekISO, onClose, onPrevWeek, onNextWeek, canGoNext, onCompose, composeLabel, story }: WeekPlanFloorProps) {
  const [mode, setMode] = useState<"story" | "detail">(story ? "story" : "detail");

  // Esc dismisses the surface (story or detail) — same gesture as every other overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (mode === "story") {
    return (
      <WeekStory
        report={report}
        state={state}
        weekLabel={`${sprintLabel(viewedWeekISO)} · ${weekLabel}`}
        onClose={onClose}
        onSeeDetail={() => setMode("detail")}
      />
    );
  }

  const eyebrow = tense === "ahead" ? "The week ahead" : tense === "current" ? "This week" : "The Review";
  const header = (
    <div className="mb-8 flex items-start gap-4">
      <div className="flex items-center gap-1.5 pt-1">
        {onPrevWeek && (
          <button onClick={onPrevWeek} className="fast flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Previous week">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onNextWeek && (
          <button onClick={canGoNext ? onNextWeek : undefined} disabled={!canGoNext} className="fast flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30" aria-label="Next week">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="section-label mb-1"><span style={{ color: "var(--accent)" }}>{sprintLabel(viewedWeekISO)}</span> · {eyebrow}</div>
        <h1 className="masthead text-display leading-tight text-ink">{weekLabel}</h1>
      </div>
      <button onClick={onClose} className="tap fast flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );

  return (
    <div
      className="absolute inset-0 z-[45] overflow-y-auto"
      style={{
        // Match mobile WeekPlanCard / MobilePlanWeek (96%) — 88% left the
        // Schedule calendar readable through the surface and washed the copy out.
        background: "color-mix(in srgb, var(--bg) 96%, transparent)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      <div className="mx-auto w-full max-w-5xl px-8 py-10 pb-28 md:px-12">
        <WeekPlanBody report={report} state={state} tense={tense} viewedWeekISO={viewedWeekISO} header={header} onCompose={onCompose} composeLabel={composeLabel} />
      </div>
    </div>
  );
}
