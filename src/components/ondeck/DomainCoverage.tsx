// The coverage strip — a NAMED read of "which domains am I working, how much, and
// when?", aligned OVER the deck's columns (it shares the deck's grid template, so a
// cell sits directly above its week / quarter). Colour alone can't answer it — you
// don't memorise the palette — so every row is named in the left gutter; the cells
// carry the rest. Each unit of work (a project / an initiative in that column) is one
// IDENTICAL accumulating pip in the domain's hue: more work = more pips = more ink.
// Countable at a glance, and it self-quiets. An empty cell is a sunk track — the
// quietest thing on the surface — and a one-tap "start it there".
//
// The strip is an ANNOTATION over the grid, not a table of its own: 11px labels,
// 20px rows, and unlit cells that barely register until the pointer finds one.
// Drawn by styles/decks.css (`.dk-cov-*`).

import type { Domain } from "../../lib/vertical";
import { Dot } from "../kit";

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
  /** px gap between columns — 0 for ruled, adjacent columns. */
  columnGap?: number;
  /** whether cells carry the column's left rule. */
  ruled?: boolean;
  /** what an empty cell starts — "project" (weeks) or "initiative" (quarters). */
  itemNoun?: string;
  /** the column cadence noun — "week" or "quarter". */
  colNoun?: string;
  /** start work for a domain in a given column (0 = now). */
  onAdd: (domain: Domain, weekIdx: number) => void;
}) {
  if (rows.length === 0) return null;
  const flush = !ruled || columnGap > 0 ? "" : undefined;
  const when = (i: number) => (i === 0 ? `this ${colNoun}` : i === 1 ? `next ${colNoun}` : `in ${i} ${colNoun}s`);

  return (
    <div className="dk-cov">
      {rows.map((r) => {
        const { domain: d } = r;
        const covered = r.cells.some((n) => n > 0);
        return (
          <div key={d.id} className="dk-cov-row" style={{ gridTemplateColumns: gridTemplate, columnGap }}>
            {/* Right-aligned against the grid, so the names share one clean edge
                with the columns and the gutter reads as the grid's margin. */}
            <div className="dk-cov-label dk-gutter" data-on={covered ? "" : undefined}>
              {covered ? <Dot color={d.color} size="sm" /> : <span className="k-dot dk-hollow" data-size="sm" aria-hidden />}
              <span title={d.name}>{d.name}</span>
            </div>
            {r.cells.map((count, i) =>
              count > 0 ? (
                <div
                  key={i}
                  className="dk-cov-cell"
                  data-flush={flush}
                  data-now={i === 0 ? "" : undefined}
                  style={{ ["--h" as string]: d.color }}
                  title={`${d.name} · ${count} ${itemNoun}${count === 1 ? "" : "s"} ${when(i)}`}
                >
                  {Array.from({ length: Math.min(count, MAX_PIPS) }).map((_, k) => (
                    <span key={k} className="dk-cov-pip" />
                  ))}
                  {count > MAX_PIPS && <span className="dk-cov-more">+{count - MAX_PIPS}</span>}
                </div>
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => onAdd(d, i)}
                  aria-label={`Start a ${d.name} ${itemNoun} ${when(i)}`}
                  title={`Start a ${d.name} ${itemNoun} here`}
                  className="dk-cov-cell"
                  data-flush={flush}
                  data-now={i === 0 ? "" : undefined}
                >
                  <span className="dk-cov-gap" />
                </button>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
