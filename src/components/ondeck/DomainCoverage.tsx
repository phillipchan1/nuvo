// The coverage strip — a NAMED read of "which domains am I working, how much, and
// when?", aligned OVER the deck's columns (it shares the deck's grid template, so a
// cell sits directly above its sprint/quarter). Color alone can't answer it — you
// don't memorize the palette — so every row is labeled in the left gutter; the cells
// carry the rest. Each unit of work (a project / an initiative in that column) is one
// IDENTICAL accumulating pip: more work = more pips = more ink (never diluted, unlike
// subdividing a fixed bar). Countable at a glance, and it self-quiets — light domains
// shrink to a single pip. An empty cell is a one-tap "start it there".

import type { Domain } from "../../lib/vertical";

// NOW is `--signal` at every altitude (the deck columns and the calendar's
// now-line agree), so the leading column's band matches the grid beneath it.
const NOW_BAND = "color-mix(in srgb, var(--signal) 7%, transparent)";
const PIP_W = 22; // each unit of work is one fixed-size block
const MAX_PIPS = 8; // clamp (a domain rarely carries this many in one column)

export interface CoverageRow {
  domain: Domain;
  /** length = shown columns; the COUNT of work items for this domain in that column. */
  cells: number[];
}

export default function DomainCoverage({
  rows,
  gridTemplate,
  columnGap = 0,
  ruled = true,
  itemNoun = "project",
  colNoun = "week",
  onAdd,
}: {
  rows: CoverageRow[];
  /** the deck's grid template, so cells align to the columns. */
  gridTemplate: string;
  /** px gap between columns — 0 for the Gantt (adjacent + rules), 12 for the kanban. */
  columnGap?: number;
  /** whether cells carry a left rule line — the Gantt's demarcation; off when gapped. */
  ruled?: boolean;
  /** what an empty cell starts — "project" (weeks) or "initiative" (quarters). */
  itemNoun?: string;
  /** the column cadence noun — "week" or "quarter". */
  colNoun?: string;
  /** start work for a domain in a given column (0 = now). */
  onAdd: (domain: Domain, weekIdx: number) => void;
}) {
  if (rows.length === 0) return null;
  // a gap between columns makes the left rule redundant (and misplaced), so drop it
  const rule = ruled && columnGap === 0 ? "border-l border-line" : "";

  // No ruler — the deck's sprint headers directly below label the (aligned) columns,
  // so coverage stays a compact band that doesn't crowd the deck.
  return (
    <div className="pb-2 pt-0.5">
      {rows.map((r) => {
        const { domain: d } = r;
        const covered = r.cells.some((n) => n > 0);
        return (
          <div key={d.id} className="grid items-center" style={{ gridTemplateColumns: gridTemplate, columnGap }}>
            {/* The label gutter has to occlude the scrolling cells, but an opaque
                fill would cover the atmosphere — so it's frosted glass instead. */}
            <div
              className="sticky left-0 z-10 flex min-w-0 items-center gap-2 py-1 pl-0.5 pr-2"
              style={{
                background: "color-mix(in srgb, var(--bg) 82%, transparent)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
              }}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={covered ? { background: d.color } : { background: "transparent", boxShadow: "inset 0 0 0 1px var(--line-strong)" }}
              />
              <span className="truncate text-caption leading-none" style={{ color: covered ? "var(--ink)" : "var(--muted)" }} title={d.name}>
                {d.name}
              </span>
            </div>
            {r.cells.map((count, i) =>
              count > 0 ? (
                <div key={i} className={`${rule} px-1 py-[3px]`} style={i === 0 ? { background: NOW_BAND } : undefined} title={`${d.name} · ${count} ${itemNoun}${count === 1 ? "" : "s"} ${i === 0 ? `this ${colNoun}` : `${colNoun} +${i}`}`}>
                  {/* accumulating pips — one identical block per unit of work; more = more */}
                  <div className="flex items-center gap-[3px]">
                    {Array.from({ length: Math.min(count, MAX_PIPS) }).map((_, k) => (
                      <span key={k} className="h-2 shrink-0 rounded-[2px]" style={{ width: PIP_W, background: d.color }} />
                    ))}
                    {count > MAX_PIPS && <span className="mono text-micro leading-none" style={{ color: d.color }}>+{count - MAX_PIPS}</span>}
                  </div>
                </div>
              ) : (
                <button
                  key={i}
                  onClick={() => onAdd(d, i)}
                  aria-label={`Start a ${d.name} ${itemNoun} ${i === 0 ? `this ${colNoun}` : i === 1 ? `next ${colNoun}` : `in ${i} ${colNoun}s`}`}
                  title={`Start a ${d.name} ${itemNoun} here`}
                  className={`group/cell fast ${rule} px-1 py-[3px]`}
                  style={i === 0 ? { background: NOW_BAND } : undefined}
                >
                  {/* open time for this domain — a soft full-width recess at pip
                      height. Solid, not dashed — empty cells dissolve into the
                      paper until hover blooms them to `--slot`. */}
                  <div className="coverage-gap h-2 w-full rounded-[2px] transition-colors" />
                </button>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
