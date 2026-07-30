// Placement — the one control that answers "when does this land", at both
// altitudes and on both shells. Hoisted out of the phone's detail sheet
// (mobile/detail/verticalDetail.tsx) so the desktop record stops editing raw
// dates: D-030 decided a record "opens on a scale of the next four sprints with
// its span lit across them, not two date fields", and only the phone ever got it.
//
// Every write goes through `sprintSpanFor` / `quarterEndISO` — the same functions
// the deck drag calls — so a tap here and a drop on On Deck place the record
// identically (D-032: one placement formula, never a second implementation).
//
// ── Two tones, one grammar ───────────────────────────────────────────────────
// The band is the SAME control either way; only its weight changes with what the
// surface is asking of it:
//
//   · `primary` — the phone's detail sheet, where placement IS the screen's act.
//     Chunky bordered cells, 44px targets.
//   · `quiet`   — the desktop record's rail, where placement is ANNOTATION beside
//     the work. A hairline track with the span filled: no borders, no fills, no
//     chroma, because every enclosure on the sheet belongs to the tasks.
//
// The quiet tone is also the more honest drawing: on On Deck this literally is a
// bar laid across columns of time, not four buttons.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { addQuarters, endOfQuarter, format, parseISO, startOfQuarter } from "date-fns";
import { useCapacity } from "../../hooks/useCapacity";
import { sprintNumber, sprintsBetween } from "../../lib/sprint";
import { sprintSpanFor, sprintSpanWeeks } from "../../lib/onDeck";
import { quarterEndISO, quarterName, quarterRangeLabel } from "../../lib/initiativeDeck";
import type { useVertical } from "../../hooks/useVertical";
import type { Initiative, Project } from "../../lib/vertical";

type Store = ReturnType<typeof useVertical>;
export type PlacementTone = "primary" | "quiet";

/** Where a band sends its write. A saved record patches the row through the
 *  store; the CREATE sheet has no row yet, so it hands in a setter and the same
 *  band drives a draft. Either way the dates come out of `sprintSpanFor` /
 *  `quarterEndISO`, so there is still ONE placement formula (D-032). */
type PlacePatch = { startDate?: string | null; targetDate?: string | null };
export type OnPlace = (patch: PlacePatch) => void;

/** How far out either scale reaches. Past the runway there is no week — only
 *  Someday (loose-weeks.md); reaching for sprint 14 isn't scheduling, it's
 *  avoiding. */
const HORIZON = 4;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

// ── One cell of either scale ─────────────────────────────────────────────────
function Cell({
  tone,
  lit,
  now,
  label,
  sub,
  color,
  onClick,
  title,
}: {
  tone: PlacementTone;
  lit: boolean;
  now: boolean;
  label: string;
  sub: string;
  color: string;
  onClick: () => void;
  title: string;
}) {
  if (tone === "primary") {
    return (
      <button
        onClick={onClick}
        title={title}
        className="tap fast flex-1 rounded-xl border px-1 py-2 text-center"
        style={
          lit
            ? { borderColor: color, background: `color-mix(in srgb, ${color} 12%, transparent)`, color }
            : { borderColor: "var(--line)" }
        }
      >
        <div className="mono text-caption font-semibold leading-none">{label}</div>
        <div className="mono mt-1 text-micro leading-none text-muted">{sub}</div>
        <div className="mx-auto mt-1.5 h-1 w-1 rounded-full" style={{ background: now ? "var(--signal)" : "transparent" }} />
      </button>
    );
  }
  // quiet: a segment of a track. The number labels it, the bar carries the span.
  return (
    <button onClick={onClick} title={title} className="fast group flex-1 py-1 text-center" aria-pressed={lit}>
      <div
        className="mono text-meta leading-none"
        style={{
          color: lit ? "color-mix(in srgb, var(--ink) 70%, var(--muted))" : "var(--muted)",
          fontWeight: lit ? 600 : 400,
        }}
      >
        {label}
      </div>
      <div
        className="fast mt-1.5 h-1 rounded-full group-hover:opacity-100"
        style={{
          background: lit ? `color-mix(in srgb, ${color} 55%, transparent)` : "var(--line)",
          opacity: lit ? 1 : 0.9,
        }}
      />
      <div className="mt-1 flex h-1 justify-center">
        <span className="h-[3px] w-[3px] rounded-full" style={{ background: now ? "var(--signal)" : "transparent" }} />
      </div>
    </button>
  );
}

/** −/＋ span stepper. Borderless in the quiet tone: a bordered pill was one more
 *  enclosure in a column that is supposed to have none. */
function Stepper({
  tone,
  value,
  unit,
  onLess,
  onMore,
}: {
  tone: PlacementTone;
  value: number;
  unit: string;
  onLess: () => void;
  onMore: () => void;
}) {
  if (tone === "primary") {
    return (
      <div className="flex items-center rounded-full border border-line">
        <button onClick={onLess} aria-label={`One ${unit} shorter`} className="tap fast px-3 text-head text-muted">−</button>
        <span className="mono w-[74px] text-center text-caption text-ink">{value} {unit}{value === 1 ? "" : "s"}</span>
        <button onClick={onMore} aria-label={`One ${unit} longer`} className="tap fast px-3 text-head text-muted">＋</button>
      </div>
    );
  }
  return (
    <span className="flex items-center">
      <button onClick={onLess} aria-label={`One ${unit} shorter`} title={`One ${unit} shorter`}
        className="fast px-1 text-label text-muted opacity-70 hover:text-ink hover:opacity-100">−</button>
      <span className="mono px-0.5 text-micro text-muted">{value}</span>
      <button onClick={onMore} aria-label={`One ${unit} longer`} title={`One ${unit} longer`}
        className="fast px-1 text-label text-muted opacity-70 hover:text-ink hover:opacity-100">＋</button>
    </span>
  );
}

/** The quiet tone's two trailing acts — shelve, and the escape hatch to raw
 *  dates for the odd finish line that isn't sprint-shaped. Glyphs, not sentences. */
function TrailActs({ onShelve, onDates, datesOpen }: { onShelve?: () => void; onDates: () => void; datesOpen: boolean }) {
  return (
    <span className="flex items-center gap-0.5">
      {onShelve && (
        <button onClick={onShelve} title="Take it off the deck" aria-label="Take it off the deck"
          className="fast flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-label text-muted opacity-70 hover:bg-surface hover:text-ink hover:opacity-100">⌫</button>
      )}
      <button onClick={onDates} title="Exact dates" aria-label="Exact dates" aria-expanded={datesOpen}
        className="fast flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-label text-muted opacity-70 hover:bg-surface hover:text-ink hover:opacity-100">▤</button>
    </span>
  );
}

// ── Project → sprints ────────────────────────────────────────────────────────
export function SprintBand({
  p,
  store,
  onPlace,
  tone = "quiet",
  color = "var(--accent)",
  renderDates,
  bandRef,
}: {
  p: Pick<Project, "id" | "startDate" | "targetDate">;
  /** omit only when `onPlace` is driving a draft. */
  store?: Store;
  onPlace?: OnPlace;
  tone?: PlacementTone;
  /** the record's domain hue — identity, so the lit span reads as *this* record. */
  color?: string;
  /** the phone passes its big native date fields; desktop gets the compact pair. */
  renderDates?: (v: { start: string | null; target: string | null; onStart: (s: string | null) => void; onTarget: (s: string | null) => void }) => ReactNode;
  /** so the record can focus the band with `s` and drive it with arrow keys. */
  bandRef?: React.RefObject<HTMLDivElement>;
}) {
  const { byWeek } = useCapacity();
  const [showDates, setShowDates] = useState(false);
  const weeks = byWeek.slice(0, HORIZON);

  const idxOf = (iso: string | null): number => {
    if (!iso) return -1;
    const ms = new Date(iso + "T12:00:00").getTime();
    return weeks.findIndex((w) => ms >= w.weekStart.getTime() && ms < w.weekStart.getTime() + WEEK_MS);
  };
  const dueIdx = idxOf(p.targetDate);
  const startIdx = p.startDate ? idxOf(p.startDate) : dueIdx;
  const span = sprintSpanWeeks(p);
  const from = startIdx >= 0 ? startIdx : dueIdx;
  const to = from >= 0 ? Math.min(HORIZON - 1, from + span - 1) : -1;
  const outside = Boolean(p.targetDate) && dueIdx < 0 && startIdx < 0;

  // The one write. Identical to the deck drag's — `sprintSpanFor` is the kernel.
  const write = (patch: PlacePatch, status: Project["status"]) => {
    if (onPlace) onPlace(patch);
    else store?.updateProject(p.id, { ...patch, status });
  };
  const place = (i: number, width: number = span) => {
    const ws = weeks[i]?.weekStart;
    if (!ws) return;
    write(sprintSpanFor(p, ws, width), "in_progress");
  };
  const shelve = () => write({ startDate: null, targetDate: null }, "backlog");

  // ← → walk the placement, ⇧ resizes the span — the deck's drag and resize
  // without the pointer.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    if (from < 0) { place(Math.max(0, dir > 0 ? 0 : HORIZON - 1), span); return; }
    if (e.shiftKey) place(from, Math.max(1, Math.min(HORIZON - from, span + dir)));
    else place(Math.max(0, Math.min(HORIZON - 1, from + dir)), span);
  };

  const onStart = (v: string | null) =>
    onPlace ? onPlace({ startDate: v }) : store?.updateProject(p.id, { startDate: v });
  const onTarget = (v: string | null) =>
    onPlace ? onPlace({ targetDate: v }) : store?.updateProject(p.id, { targetDate: v });

  const dates = renderDates
    ? renderDates({ start: p.startDate, target: p.targetDate, onStart, onTarget })
    : <CompactDates start={p.startDate} target={p.targetDate} onStart={onStart} onTarget={onTarget} />;

  const litRange = from >= 0 ? `${fmtDay(weeks[from].weekStart)} – ${format(parseISO(p.targetDate ?? ""), "MMM d")}` : null;

  return (
    <div>
      {tone === "quiet" && (
        <div className="section-label mb-2 flex items-center gap-1.5">
          <span className="flex-1">Sprint</span>
          {from >= 0 && <Stepper tone={tone} value={span} unit="sprint" onLess={() => place(from, Math.max(1, span - 1))} onMore={() => place(from, Math.min(HORIZON - from, span + 1))} />}
          <TrailActs onShelve={from >= 0 ? shelve : undefined} onDates={() => setShowDates((v) => !v)} datesOpen={showDates} />
        </div>
      )}

      <div
        ref={bandRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="group"
        aria-label="Sprint placement"
        className={`flex items-stretch outline-none ${tone === "primary" ? "gap-1.5" : "gap-0.5 rounded-[var(--radius-sm)] focus-visible:[box-shadow:0_0_0_2px_var(--accent-soft)]"}`}
      >
        {weeks.map((w, i) => (
          <Cell
            key={i}
            tone={tone}
            lit={from >= 0 && i >= from && i <= to}
            now={i === 0}
            label={String(sprintNumber(w.weekStart))}
            sub={fmtDay(w.weekStart)}
            color={color}
            onClick={() => place(i)}
            title={`Sprint ${sprintNumber(w.weekStart)} — week of ${fmtDay(w.weekStart)}`}
          />
        ))}
      </div>

      {tone === "quiet" ? (
        <div className="mono mt-1.5 text-micro text-muted opacity-70">
          {from >= 0 ? litRange : outside ? `Finish line outside the next ${HORIZON} sprints` : null}
        </div>
      ) : (
        <>
          {from >= 0 ? (
            <div className="mt-2.5 flex items-center gap-2">
              <span className="shrink-0 text-caption text-muted">Spans</span>
              <Stepper tone={tone} value={span} unit="sprint" onLess={() => place(from, Math.max(1, span - 1))} onMore={() => place(from, Math.min(HORIZON - from, span + 1))} />
              <button onClick={shelve} className="tap fast ml-auto shrink-0 text-caption text-muted active:text-accent">Shelve</button>
            </div>
          ) : (
            <div className="mt-2 text-caption text-muted">
              {outside
                ? `Finish line ${p.targetDate ? format(parseISO(p.targetDate), "MMM d") : ""} — outside the next ${HORIZON} sprints. Tap one to pull it in.`
                : "No sprint yet — tap one to commit it."}
            </div>
          )}
          <button onClick={() => setShowDates((v) => !v)} className="tap fast mt-1 text-micro text-muted active:text-accent">
            Exact dates {showDates ? "▾" : "▸"}
          </button>
        </>
      )}

      {showDates && <div className="mt-2">{dates}</div>}
    </div>
  );
}

// ── Initiative → quarters ────────────────────────────────────────────────────
export function QuarterBand({
  i,
  store,
  onPlace,
  tone = "quiet",
  color = "var(--accent)",
  renderDates,
  bandRef,
}: {
  i: Pick<Initiative, "id" | "startDate" | "targetDate">;
  /** omit only when `onPlace` is driving a draft. */
  store?: Store;
  onPlace?: OnPlace;
  tone?: PlacementTone;
  color?: string;
  renderDates?: (v: { start: string | null; target: string | null; onStart: (s: string | null) => void; onTarget: (s: string | null) => void }) => ReactNode;
  bandRef?: React.RefObject<HTMLDivElement>;
}) {
  const [showDates, setShowDates] = useState(false);
  const now = useMemo(() => new Date(), []);
  const quarters = useMemo(
    () =>
      Array.from({ length: HORIZON }, (_, k) => {
        const start = addQuarters(startOfQuarter(now), k);
        return { start, end: endOfQuarter(start), name: quarterName(start) };
      }),
    [now],
  );

  const targetName = i.targetDate ? quarterName(new Date(i.targetDate + "T12:00:00")) : null;
  const idx = targetName ? quarters.findIndex((q) => q.name === targetName) : -1;
  const chosen = idx >= 0 ? quarters[idx] : null;
  // runway in sprints — the honest count at this altitude
  const left = i.targetDate ? sprintsBetween(now, new Date(i.targetDate + "T12:00:00")) + 1 : 0;

  const write = (patch: PlacePatch, status: Initiative["status"]) => {
    if (onPlace) onPlace(patch);
    else store?.updateInitiative(i.id, { ...patch, status });
  };
  const place = (k: number) => write({ targetDate: quarterEndISO(quarters[k].start) }, "in_progress");
  const shelve = () => write({ targetDate: null }, "backlog");

  // A bet BELONGS TO a quarter — it doesn't span (design-language planner law 5),
  // so there is no ⇧-resize here, only ← →.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    place(idx < 0 ? (dir > 0 ? 0 : HORIZON - 1) : Math.max(0, Math.min(HORIZON - 1, idx + dir)));
  };

  const onStart = (v: string | null) =>
    onPlace ? onPlace({ startDate: v }) : store?.updateInitiative(i.id, { startDate: v });
  const onTarget = (v: string | null) =>
    onPlace ? onPlace({ targetDate: v }) : store?.updateInitiative(i.id, { targetDate: v });

  const dates = renderDates
    ? renderDates({ start: i.startDate, target: i.targetDate, onStart, onTarget })
    : <CompactDates start={i.startDate} target={i.targetDate} onStart={onStart} onTarget={onTarget} />;

  return (
    <div>
      {tone === "quiet" && (
        <div className="section-label mb-2 flex items-center gap-1.5">
          <span className="flex-1">Quarter</span>
          <TrailActs onShelve={i.targetDate ? shelve : undefined} onDates={() => setShowDates((v) => !v)} datesOpen={showDates} />
        </div>
      )}

      <div
        ref={bandRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="group"
        aria-label="Quarter placement"
        className={`flex items-stretch outline-none ${tone === "primary" ? "gap-1.5" : "gap-0.5 rounded-[var(--radius-sm)] focus-visible:[box-shadow:0_0_0_2px_var(--accent-soft)]"}`}
      >
        {quarters.map((q, k) => (
          <Cell
            key={q.name}
            tone={tone}
            lit={k === idx}
            now={k === 0}
            label={q.name.split(" ")[0]}
            sub={String(q.start.getFullYear())}
            color={color}
            onClick={() => place(k)}
            title={quarterRangeLabel(q.start, q.end)}
          />
        ))}
      </div>

      {/* the runway — one pip per sprint between now and the finish line. In the
          quiet tone it loses its caption: the pips and a number say what
          "14 sprints left" said. */}
      {i.targetDate && left > 0 && (
        <div className={`flex items-center gap-2 ${tone === "primary" ? "mt-2.5" : "mt-2"}`}>
          <span className="flex flex-1 items-center gap-[3px]">
            {Array.from({ length: Math.min(left, 26) }).map((_, k) => (
              <span
                key={k}
                className="flex-1 rounded-full"
                style={{
                  height: tone === "primary" ? 6 : 3,
                  background: k === 0 ? "var(--signal)" : tone === "primary" ? color : "var(--line-strong)",
                  opacity: k === 0 ? 1 : tone === "primary" ? 0.5 : 0.6,
                }}
              />
            ))}
          </span>
          <span className="mono shrink-0 text-micro tabular-nums text-muted opacity-75">
            {left}{tone === "primary" ? ` sprint${left === 1 ? "" : "s"} left` : ""}
          </span>
        </div>
      )}

      {tone === "quiet" ? (
        <div className="mono mt-1.5 text-micro text-muted opacity-70">
          {chosen ? quarterRangeLabel(chosen.start, chosen.end) : targetName ? `Finish line in ${targetName}` : null}
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-caption text-muted">
              {chosen
                ? quarterRangeLabel(chosen.start, chosen.end)
                : targetName
                  ? `Finish line in ${targetName} — beyond the shown quarters.`
                  : "No quarter yet — tap one to give this bet a finish line."}
            </span>
            {i.targetDate && (
              <button onClick={shelve} className="tap fast shrink-0 text-caption text-muted active:text-accent">Shelve</button>
            )}
          </div>
          <button onClick={() => setShowDates((v) => !v)} className="tap fast mt-1 text-micro text-muted active:text-accent">
            Exact dates {showDates ? "▾" : "▸"}
          </button>
        </>
      )}

      {showDates && <div className="mt-2">{dates}</div>}
    </div>
  );
}

// ── The desktop escape hatch: raw dates, small, behind ▤ ─────────────────────
function CompactDates({
  start,
  target,
  onStart,
  onTarget,
}: {
  start: string | null;
  target: string | null;
  onStart: (v: string | null) => void;
  onTarget: (v: string | null) => void;
}) {
  return (
    <div className="mono flex flex-col gap-1 text-micro text-muted">
      <DateInput label="start" value={start} onChange={onStart} />
      <DateInput label="target" value={target} onChange={onTarget} />
    </div>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-9 shrink-0 opacity-70">{label}</span>
      <button
        onClick={() => ref.current?.showPicker?.()}
        className="fast rounded-[var(--radius-sm)] px-1 py-0.5 hover:bg-surface hover:text-ink"
      >
        {value ? format(parseISO(value), "MMM d") : "—"}
      </button>
      {value && (
        <button onClick={() => onChange(null)} className="fast opacity-60 hover:text-signal hover:opacity-100" aria-label={`Clear ${label}`}>✕</button>
      )}
      <input
        ref={ref}
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="sr-only"
        tabIndex={-1}
      />
    </span>
  );
}
