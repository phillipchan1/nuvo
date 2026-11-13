// Placement — the one control that answers "when does this land", at both
// altitudes and on both shells. Hoisted out of the phone's detail sheet
// (mobile/detail/verticalDetail.tsx) so the desktop record stops editing raw
// dates: D-030 decided a record "opens on a scale of the next four weeks with
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
//     Bordered cells, 56px targets.
//   · `quiet`   — the desktop record, where it opens from the Week / Quarter
//     property. A track of cells with the span filled in the domain's hue.
//
// Drawn by styles/documents.css (`.band*`), on kit tokens.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { addQuarters, endOfQuarter, format, parseISO, startOfQuarter } from "date-fns";
import { useCapacity } from "../../hooks/useCapacity";
import { weekName, weekSpan, weekTick, weeksBetween } from "../../lib/week";
import { sprintSpanFor, sprintSpanWeeks } from "../../lib/onDeck";
import { quarterEndISO, quarterName, quarterRangeLabel } from "../../lib/initiativeDeck";
import type { useVertical } from "../../hooks/useVertical";
import { useDeferProject } from "../../hooks/useProjectTime";
import type { Initiative, Project } from "../../lib/vertical";
import { Icon } from "../Icon";
import { Button, IconButton } from "../kit";

type Store = ReturnType<typeof useVertical>;
export type PlacementTone = "primary" | "quiet";

/** Where a band sends its write. A saved record patches the row through the
 *  store; the CREATE sheet has no row yet, so it hands in a setter and the same
 *  band drives a draft. Either way the dates come out of `sprintSpanFor` /
 *  `quarterEndISO`, so there is still ONE placement formula (D-032). */
type PlacePatch = { startDate?: string | null; targetDate?: string | null };
export type OnPlace = (patch: PlacePatch) => void;

/** How far out either scale reaches by default. Past the runway there is no
 *  week — only Someday (loose-weeks.md); reaching 14 weeks out isn't
 *  scheduling, it's avoiding. The phone's deck plans six weeks out, so its
 *  band takes `horizon` to match — a week you can drag onto has to be a week
 *  you can also tap onto. Omit it and desktop is exactly as it was. */
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
  onClick,
  title,
}: {
  tone: PlacementTone;
  lit: boolean;
  now: boolean;
  label: string;
  sub: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={lit}
      data-now={now || undefined}
      className={tone === "primary" ? "band-cell tap" : "band-cell"}
    >
      <span>{label}</span>
      {tone === "primary" ? <small>{sub}</small> : <i aria-hidden />}
      <b aria-hidden />
    </button>
  );
}

/** −/＋ span stepper. */
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
      <span className="fm-stepper">
        <IconButton size="xs" label={`One ${unit} shorter`} icon={<span aria-hidden>−</span>} onClick={onLess} className="tap" />
        <output>
          {value} {unit}
          {value === 1 ? "" : "s"}
        </output>
        <IconButton size="xs" label={`One ${unit} longer`} icon={<Icon name="plus" size={12} />} onClick={onMore} className="tap" />
      </span>
    );
  }
  return (
    <span className="band-step">
      <IconButton size="xs" label={`One ${unit} shorter`} icon={<span aria-hidden>−</span>} onClick={onLess} />
      <output>{value}</output>
      <IconButton size="xs" label={`One ${unit} longer`} icon={<Icon name="plus" size={12} />} onClick={onMore} />
    </span>
  );
}

/** The quiet tone's two trailing acts — shelve, and the escape hatch to raw
 *  dates for the odd finish line that isn't week-shaped. */
function TrailActs({ onShelve, onDates, datesOpen }: { onShelve?: () => void; onDates: () => void; datesOpen: boolean }) {
  return (
    <span className="inline-flex items-center">
      {onShelve && <IconButton size="xs" label="Take it off the deck" icon={<Icon name="close" size={12} />} onClick={onShelve} />}
      <IconButton
        size="xs"
        label="Exact dates"
        icon={<Icon name="calendar" size={12} />}
        onClick={onDates}
        active={datesOpen}
        aria-expanded={datesOpen}
      />
    </span>
  );
}

// ── Project → weeks ──────────────────────────────────────────────────────────
export function WeekBand({
  p,
  store,
  onPlace,
  tone = "quiet",
  color = "var(--accent)",
  horizon = HORIZON,
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
  /** how many weeks the scale reaches — defaults to the shared HORIZON. */
  horizon?: number;
  /** the phone passes its big native date fields; desktop gets the compact pair. */
  renderDates?: (v: { start: string | null; target: string | null; onStart: (s: string | null) => void; onTarget: (s: string | null) => void }) => ReactNode;
  /** so the record can focus the band with `s` and drive it with arrow keys. */
  bandRef?: React.RefObject<HTMLDivElement>;
}) {
  const defer = useDeferProject();
  const { byWeek } = useCapacity();
  const [showDates, setShowDates] = useState(false);
  const weeks = byWeek.slice(0, horizon);

  const idxOf = (iso: string | null): number => {
    if (!iso) return -1;
    const ms = new Date(iso + "T12:00:00").getTime();
    return weeks.findIndex((w) => ms >= w.weekStart.getTime() && ms < w.weekStart.getTime() + WEEK_MS);
  };
  const dueIdx = idxOf(p.targetDate);
  const startIdx = p.startDate ? idxOf(p.startDate) : dueIdx;
  const span = sprintSpanWeeks(p);
  const from = startIdx >= 0 ? startIdx : dueIdx;
  const to = from >= 0 ? Math.min(horizon - 1, from + span - 1) : -1;
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
  // Shelving a real project also clears what it still holds on the calendar;
  // a draft (`onPlace`) has nothing placed yet and just loses its span.
  const shelve = () => {
    const full = onPlace ? null : store?.data.projects.find((x) => x.id === p.id);
    if (full) void defer.takeOff(full, undefined, { status: "backlog" });
    else write({ startDate: null, targetDate: null }, "backlog");
  };

  // ← → walk the placement, ⇧ resizes the span — the deck's drag and resize
  // without the pointer.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    if (from < 0) { place(Math.max(0, dir > 0 ? 0 : horizon - 1), span); return; }
    if (e.shiftKey) place(from, Math.max(1, Math.min(horizon - from, span + dir)));
    else place(Math.max(0, Math.min(horizon - 1, from + dir)), span);
  };

  const onStart = (v: string | null) =>
    onPlace ? onPlace({ startDate: v }) : store?.updateProject(p.id, { startDate: v });
  const onTarget = (v: string | null) =>
    onPlace ? onPlace({ targetDate: v }) : store?.updateProject(p.id, { targetDate: v });

  const dates = renderDates
    ? renderDates({ start: p.startDate, target: p.targetDate, onStart, onTarget })
    : <CompactDates start={p.startDate} target={p.targetDate} onStart={onStart} onTarget={onTarget} />;

  const litRange =
    from >= 0 && p.targetDate
      ? `${fmtDay(weeks[from].weekStart)} – ${format(parseISO(p.targetDate), "MMM d")}`
      : null;

  return (
    <div style={{ ["--h" as string]: color }}>
      {tone === "quiet" && (
        <div className="band-head">
          <span className="band-head-label">Week</span>
          {from >= 0 && <Stepper tone={tone} value={span} unit="week" onLess={() => place(from, Math.max(1, span - 1))} onMore={() => place(from, Math.min(horizon - from, span + 1))} />}
          <TrailActs onShelve={from >= 0 ? shelve : undefined} onDates={() => setShowDates((v) => !v)} datesOpen={showDates} />
        </div>
      )}

      <div
        ref={bandRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="group"
        aria-label="Week placement"
        className="band"
        data-tone={tone}
      >
        {weeks.map((w, i) => (
          <Cell
            key={i}
            tone={tone}
            lit={from >= 0 && i >= from && i <= to}
            now={i === 0}
            // `within` must follow the horizon or week +5 falls through to a
            // date and prints "Sep 6" over "Sep 6".
            label={weekTick(w.weekStart, { within: horizon })}
            sub={fmtDay(w.weekStart)}
            onClick={() => place(i)}
            title={`${weekName(w.weekStart)} — ${weekSpan(w.weekStart)}`}
          />
        ))}
      </div>

      {tone === "quiet" ? (
        <div className="band-note">
          {from >= 0 ? litRange : outside ? `Finish line past ${horizon} weeks` : "Not placed"}
        </div>
      ) : (
        <>
          <div className="band-primary-foot">
            {from >= 0 ? (
              <>
                <span>Spans</span>
                <Stepper tone={tone} value={span} unit="week" onLess={() => place(from, Math.max(1, span - 1))} onMore={() => place(from, Math.min(horizon - from, span + 1))} />
                <span className="k-grow" />
                <Button kind="ghost" className="tap" onClick={shelve}>
                  Shelve
                </Button>
              </>
            ) : (
              <span>
                {outside
                  ? `Finish line ${p.targetDate ? format(parseISO(p.targetDate), "MMM d") : ""} — past ${horizon} weeks.`
                  : "Not placed"}
              </span>
            )}
          </div>
          <Button kind="ghost" size="sm" className="tap mt-1 -ml-2" onClick={() => setShowDates((v) => !v)} aria-expanded={showDates} trailing={<Icon name={showDates ? "chevron-down" : "chevron-right"} size={12} />}>
            Exact dates
          </Button>
        </>
      )}

      {showDates && <div className={tone === "quiet" ? "band-dates" : "mt-2"}>{dates}</div>}
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
  // runway in weeks — the honest count at this altitude
  const left = i.targetDate ? weeksBetween(now, new Date(i.targetDate + "T12:00:00")) + 1 : 0;

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
    <div style={{ ["--h" as string]: color }}>
      {tone === "quiet" && (
        <div className="band-head">
          <span className="band-head-label">Quarter</span>
          <TrailActs onShelve={i.targetDate ? shelve : undefined} onDates={() => setShowDates((v) => !v)} datesOpen={showDates} />
        </div>
      )}

      <div
        ref={bandRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="group"
        aria-label="Quarter placement"
        className="band"
        data-tone={tone}
      >
        {quarters.map((q, k) => (
          <Cell
            key={q.name}
            tone={tone}
            lit={k === idx}
            now={k === 0}
            label={q.name.split(" ")[0]}
            sub={String(q.start.getFullYear())}
            onClick={() => place(k)}
            title={quarterRangeLabel(q.start, q.end)}
          />
        ))}
      </div>

      {/* the runway — one mark per week between now and the finish line, now
          in the signal, the number beside it. */}
      {i.targetDate && left > 0 && (
        <div className="band-runway">
          <span aria-hidden>
            {Array.from({ length: Math.min(left, 26) }).map((_, k) => (
              <i key={k} data-now={k === 0 || undefined} />
            ))}
          </span>
          <span>
            {left}
            {tone === "primary" ? ` week${left === 1 ? "" : "s"} left` : "w"}
          </span>
        </div>
      )}

      {tone === "quiet" ? (
        <div className="band-note">
          {chosen ? quarterRangeLabel(chosen.start, chosen.end) : targetName ? `Finish line in ${targetName}` : "Not placed"}
        </div>
      ) : (
        <>
          <div className="band-primary-foot">
            <span className="min-w-0 flex-1 truncate">
              {chosen
                ? quarterRangeLabel(chosen.start, chosen.end)
                : targetName
                  ? `Finish line in ${targetName} — past the shown quarters.`
                  : "Not placed"}
            </span>
            {i.targetDate && (
              <Button kind="ghost" className="tap" onClick={shelve}>
                Shelve
              </Button>
            )}
          </div>
          <Button kind="ghost" size="sm" className="tap mt-1 -ml-2" onClick={() => setShowDates((v) => !v)} aria-expanded={showDates} trailing={<Icon name={showDates ? "chevron-down" : "chevron-right"} size={12} />}>
            Exact dates
          </Button>
        </>
      )}

      {showDates && <div className={tone === "quiet" ? "band-dates" : "mt-2"}>{dates}</div>}
    </div>
  );
}

// ── The desktop escape hatch: raw dates, small, behind the calendar glyph ────
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
    <>
      <DateInput label="Start" value={start} onChange={onStart} />
      <DateInput label="Target" value={target} onChange={onTarget} />
    </>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="band-date">
      <span>{label}</span>
      <Button kind="ghost" size="xs" className="tabular-nums" onClick={() => ref.current?.showPicker?.()}>
        {value ? format(parseISO(value), "MMM d") : "—"}
      </Button>
      {value && <IconButton size="xs" label={`Clear ${label.toLowerCase()}`} icon={<Icon name="close" size={11} />} onClick={() => onChange(null)} />}
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
