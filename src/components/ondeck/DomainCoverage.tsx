// The coverage strip — a NAMED read of "which domains am I working, and when?",
// aligned OVER the deck's sprint columns (it shares the deck's grid template, so a lit
// cell sits directly above its week). Color alone can't answer it — you don't memorize
// the palette — so every row is labeled in the left gutter; the cells carry the rest.
// A filled bar under a sprint = that domain lands there; an empty row = nothing on the
// board; an empty cell is a one-tap "start it that sprint". No status words, no "idle"
// label — the timeline is the message.

import type { Domain } from "../../lib/vertical";

const NOW_BAND = "color-mix(in srgb, var(--accent) 8%, transparent)";

export interface CoverageRow {
  domain: Domain;
  /** length = shown weeks; true where a placed project touches that sprint. */
  cells: boolean[];
}

export default function DomainCoverage({
  rows,
  gridTemplate,
  onAdd,
}: {
  rows: CoverageRow[];
  /** the deck's grid template, so cells align to the sprint columns. */
  gridTemplate: string;
  /** start a project for a domain in a given week (0 = this sprint). */
  onAdd: (domain: Domain, weekIdx: number) => void;
}) {
  if (rows.length === 0) return null;

  // No ruler — the deck's sprint headers directly below label the (aligned) columns,
  // so coverage stays a compact band that doesn't crowd the deck.
  return (
    <div className="pb-1.5 pt-0.5">
      {rows.map((r) => {
        const { domain: d } = r;
        const covered = r.cells.some(Boolean);
        return (
          <div key={d.id} className="grid items-center" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="sticky left-0 z-10 flex min-w-0 items-center gap-2 py-[3px] pl-0.5 pr-2" style={{ background: "var(--bg)" }}>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={covered ? { background: d.color } : { background: "var(--surface)", border: "1.5px solid var(--line-strong)" }}
              />
              <span className="truncate text-caption leading-none" style={{ color: covered ? "var(--ink)" : "var(--muted)" }} title={d.name}>
                {d.name}
              </span>
            </div>
            {r.cells.map((lit, i) =>
              lit ? (
                <div key={i} className="border-l border-line px-1 py-[3px]" style={i === 0 ? { background: NOW_BAND } : undefined} title={`${d.name} · ${i === 0 ? "this sprint" : `sprint +${i}`}`}>
                  <div className="h-2 rounded-full" style={{ background: d.color }} />
                </div>
              ) : (
                <button
                  key={i}
                  onClick={() => onAdd(d, i)}
                  aria-label={`Start a ${d.name} project ${i === 0 ? "this week" : i === 1 ? "next week" : `in ${i} weeks`}`}
                  title={`Start a ${d.name} project here`}
                  className="group/cell fast border-l border-line px-1 py-[3px]"
                  style={i === 0 ? { background: NOW_BAND } : undefined}
                >
                  <div className="h-2 rounded-full border border-dashed opacity-40 transition-opacity group-hover/cell:opacity-100" style={{ borderColor: "var(--line-strong)" }} />
                </button>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
