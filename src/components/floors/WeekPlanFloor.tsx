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

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { addDays } from "date-fns";
import { fmtHours, parseDateISO, toDateISO } from "../../lib/dates";
import { fmtMins } from "../../lib/now";
import type { WeekReport, WeekPriority } from "../../lib/composeWeek";
import { useWeekSprintRocks } from "../../hooks/useWeekSprintRocks";
import WeekEmblem from "./WeekEmblem";
import WeekStory from "./WeekStory";
import { Bar } from "./parts";

// ── This week — reckon each priority: land it (complete) or carry it forward ──
function ReckonRow({
  p,
  onToggleDone,
  onCarry,
  onRemove,
}: {
  p: WeekPriority;
  onToggleDone: () => void;
  onCarry: () => void;
  onRemove: () => void;
}) {
  const landed = p.verdict === "landed";
  return (
    <div className="group flex items-start gap-3 border-b border-line py-3 last:border-0">
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
        <div className={`text-body ${landed ? "text-muted line-through" : "text-ink"}`}>{p.rock.title}</div>
        {p.rock.win && <div className="text-meta text-muted">{p.rock.win}</div>}
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

/** Where the hours went — capacity + the per-domain weave. */
function HoursWeave({ report }: { report: WeekReport }) {
  const { capacity, domains } = report;
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
        {domains.map((d) => (
          <div key={d.id} className="flex items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.quiet ? "var(--line-strong)" : d.color, opacity: d.quiet ? 0.5 : 1 }} />
            <span className="w-24 shrink-0 truncate text-meta text-ink">{d.name}</span>
            <div className="min-w-0 flex-1">
              <Bar pct={(d.hours / maxH) * 100} color={d.quiet ? "var(--line-strong)" : d.color} baseline={d.target > 0 ? (d.target / maxH) * 100 : undefined} h={1.5} />
            </div>
            <span className="mono w-14 shrink-0 text-right text-micro text-muted">{fmtHours(d.hours * 60)}h</span>
          </div>
        ))}
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

          {/* The week's forward job: pull priorities into time blocks. The door
              to the compose ritual lives here so the week button is one place. */}
          {forming && onCompose && (
            <div className="mt-5">
              <button
                onClick={onCompose}
                className="fast inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-label font-medium text-white shadow-sm hover:brightness-110 hover:shadow-[0_6px_16px_-6px_var(--accent-glow)] active:translate-y-px"
              >
                Compose the week
                <span aria-hidden>→</span>
              </button>
              <p className="mt-2 text-meta text-muted">Pull your priorities into time blocks against your real calendar.</p>
            </div>
          )}
        </div>
      </div>

      {/* MAIN — the week's priorities (set / reckon) | time | (lived weeks) forward-fold */}
      <div className="grid gap-x-14 gap-y-10 md:grid-cols-2">
        <Col label={forming ? (ahead ? "The week's priorities" : "This week's priorities") : "How they landed"}>
          {report.priorities.length > 0 && (
            <div className="mb-3 flex flex-col">
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

        <Col label={hoursLabel}>
          <HoursWeave report={report} />
        </Col>

        {/* Next week capture is a forward-fold for the *lived* week. On a week
            you're planning ahead, "next week" would be two weeks out — drop it. */}
        {!ahead && (
          <Col label="Next week">
            <NextWeek rocks={nextWeek.rocks} onAdd={nextWeek.addTitles} onRemove={nextWeek.removeRock} />
          </Col>
        )}

        {/* Highlights are spent-work — meaningless before the week has run. */}
        {!ahead && (
          <Col label="Highlights — what moved a domain">
            <Highlights report={report} />
          </Col>
        )}
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
  /** Early-week planning moment — skip the reflective story, land on the
   *  forward-facing detail so the Compose CTA is immediately in view. */
  planForward?: boolean;
}

/** The desktop floor — slides over the Schedule work area (full-width, rail hidden).
 *  Opens as a paced story (the received moment); "See the full week" → the detail. */
export default function WeekPlanFloor({ report, state, tense = "current", weekLabel, viewedWeekISO, onClose, onPrevWeek, onNextWeek, canGoNext, onCompose, planForward }: WeekPlanFloorProps) {
  const [mode, setMode] = useState<"story" | "detail">(planForward ? "detail" : "story");

  if (mode === "story") {
    return (
      <WeekStory
        report={report}
        state={state}
        weekLabel={weekLabel}
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
        <div className="section-label mb-1">{eyebrow}</div>
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
    <div className="absolute inset-0 z-30 overflow-y-auto" style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)", backdropFilter: "blur(20px)" }}>
      <div className="mx-auto w-full max-w-5xl px-8 py-10 pb-28 md:px-12">
        <WeekPlanBody report={report} state={state} tense={tense} viewedWeekISO={viewedWeekISO} header={header} onCompose={onCompose} />
      </div>
    </div>
  );
}
