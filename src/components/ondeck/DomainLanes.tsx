// "By domain" — the planner decks split into one lane per domain (D-179). The
// project deck (weeks, a Gantt) and the initiative deck (quarters, a kanban) are the
// same act at two clock speeds, so they read By domain through ONE set of parts:
//
//   · domainLanes   — which domains get a lane and what's in each (the rule)
//   · LaneLabel     — the lane's name in the deck's left gutter
//   · LaneCell      — the create control for one domain in one column, plus the
//                     SOCKET an empty column wears
//   · LANE_GUTTER   — the frost the sticky name column wears
//
// Each deck keeps only its own geometry (the Gantt packs bars into rows; the kanban
// stacks cards in a cell). Never re-decide in a deck which domains get a lane or what
// an empty cell looks like: two copies of this drifted apart the first time the
// coverage strip was copied between the decks.

import type { CSSProperties } from "react";
import { domainById, type Domain, type VerticalData } from "../../lib/vertical";
import { pressable } from "../../lib/a11y";

/** The gutter width By domain — wide enough to read a lane's name at a glance. The
 *  extra over the packed deck's gutter comes out of the columns' minimum, so the
 *  toggle never changes the deck's total width (see each deck's `cols`). */
export const LANE_LABEL_W = 120;

/** Projects / bets whose domain no longer resolves still need a lane — never hide work. */
export const NO_AREA = "__no_area__";

/** The sticky name gutter's surface — the same frost DomainCoverage's labels wear in
 *  this exact column. Painted twice per deck (header gutter + one full-height body
 *  gutter), never per lane — perf rule 2. Its backdrop is cards sliding under it on a
 *  horizontal scroll, so it isn't a no-op blur (rule 1); a translucent fill alone let
 *  a card's pips read straight through. */
export const LANE_GUTTER: CSSProperties = {
  background: "color-mix(in srgb, var(--bg) 84%, transparent)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};

export interface DomainLane<T> {
  key: string;
  domain: Domain | null;
  items: T[];
}

/** One lane per domain, in the domains' own order — never re-sorted by load, so a
 *  given domain's row is always in the same place and is found without reading. A
 *  domain gets a lane if coverage watches it OR it has something placed (the filter
 *  quiets an empty domain; it never hides work). Unresolvable domains → "No area". */
export function domainLanes<T>(
  data: VerticalData,
  domainsSorted: Domain[],
  hidden: Set<string>,
  items: T[],
  domainOf: (t: T) => string | null | undefined,
): DomainLane<T>[] {
  const byDom = new Map<string, T[]>();
  for (const t of items) {
    const id = domainOf(t) ?? null;
    const key = id && domainById(data, id) ? id : NO_AREA;
    const arr = byDom.get(key);
    if (arr) arr.push(t);
    else byDom.set(key, [t]);
  }
  const out: DomainLane<T>[] = domainsSorted
    .filter((d) => byDom.has(d.id) || !hidden.has(d.id))
    .map((d) => ({ key: d.id, domain: d, items: byDom.get(d.id) ?? [] }));
  const orphans = byDom.get(NO_AREA);
  if (orphans) out.push({ key: NO_AREA, domain: null, items: orphans });
  return out;
}

export const laneName = (d: Domain | null) => d?.name ?? "No area";
export const laneColor = (d: Domain | null) => d?.color ?? "var(--line-strong)";

/** The lane's name — sticky so it survives a horizontal scroll. It carries no
 *  surface of its own: the deck's ONE frosted gutter column behind every lane does
 *  the occluding, so there's a single blur for the whole column and its tone can't
 *  step at a lane boundary. A hollow dot + muted name = nothing placed. */
export function LaneLabel({
  domain,
  count,
  noun,
  gridRow,
}: {
  domain: Domain | null;
  count: number;
  /** "project" / "initiative" — the count's noun. */
  noun: string;
  gridRow: string;
}) {
  const name = laneName(domain);
  const any = count > 0;
  return (
    <div className="sticky left-0 z-10 flex min-w-0 flex-col pl-1 pr-3 pt-3.5" style={{ gridColumn: 1, gridRow }}>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={any ? { background: laneColor(domain) } : { boxShadow: "inset 0 0 0 1.5px var(--line-strong)" }}
          aria-hidden
        />
        <span className="truncate text-caption font-semibold" style={{ color: any ? "var(--ink)" : "var(--muted)" }} title={name}>
          {name}
        </span>
      </div>
      <span className="mono mt-0.5 pl-4 text-micro tabular-nums text-muted">
        {any ? `${count} ${noun}${count === 1 ? "" : "s"}` : "nothing placed"}
      </span>
    </div>
  );
}

/** One domain × one column: the create control (the whole height of the lane) and,
 *  when the column holds nothing for this domain, a SOCKET — a card-sized soft hollow,
 *  so the gap reads as a missing card before anything is read. Quiet at rest (it's the
 *  commonest thing on the page); it blooms to --slot on hover/focus, and lights when a
 *  card of this domain is being dragged over this column (`landing`).
 *
 *  The socket is the cell's NEXT SIBLING (`.lane-cell + .lane-socket` in index.css),
 *  because the cell spans the whole lane and the socket only its first row. A lane
 *  with no domain ("No area") gets a drop target but no create control: there is no
 *  domain to start one in. */
export function LaneCell({
  domain,
  column,
  dropAttr,
  label,
  onAdd,
  landing,
  socket,
  gridRow,
  socketStyle,
}: {
  domain: Domain | null;
  /** 1-based grid column of this cell (the gutter is column 1). */
  column: number;
  /** the deck's drop-target attribute — `{ "data-week": "2" }` / `{ "data-quarter": "1" }`. */
  dropAttr: Record<string, string>;
  /** the full sentence for the tooltip and the accessible name. */
  label: string;
  onAdd: () => void;
  landing: boolean;
  socket: boolean;
  /** the rows the cell spans (the whole lane). */
  gridRow: string;
  /** the socket's own box — the Gantt lets it stretch to its row; the kanban sizes it. */
  socketStyle?: CSSProperties;
}) {
  if (!domain) return <div {...dropAttr} style={{ gridColumn: column, gridRow }} />;
  return (
    <>
      <div
        {...dropAttr}
        data-landing={landing || undefined}
        className="lane-cell fast"
        style={{ gridColumn: column, gridRow }}
        onClick={onAdd}
        {...pressable(onAdd, { label })}
        title={label}
      />
      {socket && (
        <div
          className="lane-socket pointer-events-none mx-1 my-1 flex items-center justify-center rounded-lg"
          style={{ gridColumn: column, gridRow: 1, ...socketStyle }}
          aria-hidden
        >
          <span className="lane-socket-hint text-micro font-medium">+ {domain.name}</span>
        </div>
      )}
    </>
  );
}
