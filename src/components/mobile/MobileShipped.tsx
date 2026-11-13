// Shipped — the phone's fourth face of the Build altitudes, the twin of the
// desktop `ShippedWall`.
//
// On Deck looks forward (finish lines ahead); this looks back (finish lines
// crossed). It was desktop-only, which meant the record of what you'd actually
// finished — the one surface in the app whose whole job is to feel good — could
// only be read at a desk. A phone is where you have the idle minute to look.
//
// Translation, not a port. The desktop is a two-column wall (cards left, the
// celebratory rail right); a phone holds one column, so the rail's headline
// figure ("N this month") rides one quiet fact line over the list — the top
// bar already carries the screen's hero — and the wall becomes grouped 48px
// rows: projects by month, initiatives by quarter, exactly the desktop's grain.
//
// The wall's one *action* comes with it: a finished record with no area shows
// Nuvo's suggested home, one tap to attach, so a win still joins the picture.
// Everything is read from the shared `readShipped` model — no second definition
// of what "shipped" means.

import { useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { readShipped } from "../../lib/shipped";
import { suggestDomainForText } from "../../lib/initiativeDeck";
import { format, parseISO } from "date-fns";
import type { Domain } from "../../lib/vertical";
import { DomainPicker } from "../floors/parts";
import { ShipStamp } from "../ShipStamp";
import SkeletonRows from "./Skeleton";
import { useRecordActions } from "./MobileRecordActions";
import { ChipButton, Dot } from "../kit";
import { PhEmpty } from "./touch";

export default function MobileShipped({
  scope,
  onOpenItem,
}: {
  scope: "project" | "initiative";
  onOpenItem: (kind: "project" | "initiative" | "domain", id: string) => void;
}) {
  const { data: d, ready, updateProject, updateInitiative } = useVertical();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readShipped(d, scope, now), [d, scope, now]);
  const { actionProps, sheet } = useRecordActions(onOpenItem);

  // The same instant, offline suggestion the desktop wall offers for a win with
  // no area — one matcher, both shells.
  const suggestions = useMemo(() => {
    const source = scope === "initiative" ? d.initiatives : d.projects;
    const byId = new Map(source.map((s) => [s.id, s]));
    const map = new Map<string, { domain: Domain; score: number } | null>();
    for (const g of board.groups) {
      for (const it of g.items) {
        if (it.domain) continue;
        const src = byId.get(it.id);
        map.set(it.id, suggestDomainForText(d, src ? `${src.name} ${src.outcome} ${src.description}` : it.name));
      }
    }
    return map;
  }, [board.groups, d, scope]);

  const attach = (id: string, domainId: string) =>
    scope === "initiative" ? updateInitiative(id, { domainId }) : updateProject(id, { domainId });

  if (!ready) return <SkeletonRows rows={4} />;

  return (
    <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto fab-clear">
      {board.total === 0 ? (
        <PhEmpty icon="package">Nothing shipped yet</PhEmpty>
      ) : (
        <>
        {/* The wall's headline figure, as the one fact over the list. */}
        <div className="px-4 pb-1 pt-3 text-caption tabular-nums text-muted">
          <span className="font-semibold text-ink">{board.total}</span> shipped ·{" "}
          <span className="font-semibold text-ink">{board.thisPeriodCount}</span> {board.periodNoun}
        </div>
        <div>
          {board.groups.map((g) => (
            <section key={g.key}>
              {/* Sticky, like every other grouped list on the phone — you always
                  know which month you're scrolling through. Solid --panel: the
                  rows slide under it, never through it. */}
              <h2 className="ph-section sticky top-0 z-10 m-0 border-b border-[var(--line-1)] bg-[var(--panel)] !pb-2">
                <span>{g.label}</span>
                <span className="ph-section-count">{g.items.length}</span>
              </h2>
              {g.items.map((it) => (
                <ShippedRow
                  key={it.id}
                  name={it.name}
                  domain={it.domain}
                  at={it.at}
                  suggestion={suggestions.get(it.id) ?? null}
                  domains={d.domains}
                  onAttach={(domainId) => attach(it.id, domainId)}
                  hold={actionProps(scope, it.id)}
                  onOpen={() => onOpenItem(scope, it.id)}
                />
              ))}
            </section>
          ))}
        </div>
        </>
      )}
      {sheet}
    </div>
  );
}

function ShippedRow({
  name,
  domain,
  at,
  suggestion,
  domains,
  onAttach,
  hold,
  onOpen,
}: {
  name: string;
  domain: Domain | null;
  at: string | null;
  suggestion: { domain: Domain; score: number } | null;
  domains: Domain[];
  onAttach: (domainId: string) => void;
  hold: Record<string, unknown>;
  onOpen: () => void;
}) {
  // Once attached the row re-renders from the store with a real domain, so this
  // only has to survive the beat before that lands.
  const [attached, setAttached] = useState(false);
  const sorted = useMemo(() => [...domains].sort((a, b) => a.sort - b.sort), [domains]);

  return (
    <div className="border-b border-[var(--line-1)]">
      <button type="button" onClick={onOpen} {...hold} className="ph-row row-hover !border-b-0">
        <ShipStamp shipped size={20} />
        <span className="min-w-0 flex-1 py-2">
          <span className="ph-row-title block">{name}</span>
          {domain && (
            <span className="mt-0.5 flex items-center gap-1.5 text-caption text-muted">
              <Dot color={domain.color} size="sm" />
              <span className="min-w-0 truncate">{domain.name}</span>
            </span>
          )}
        </span>
        {at && <span className="ph-row-meta">{format(parseISO(at), "MMM d")}</span>}
      </button>

      {/* Attribution — the wall's one act. A win with no area can't join the
          picture, so it asks here rather than only at a desk. */}
      {!domain && !attached && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-12">
          {suggestion ? (
            <ChipButton
              dot={suggestion.domain.color}
              onClick={() => {
                setAttached(true);
                onAttach(suggestion.domain.id);
              }}
              className="tap-bloom"
            >
              File under {suggestion.domain.name}
            </ChipButton>
          ) : (
            <span className="text-caption text-muted">No area</span>
          )}
          <DomainPicker
            domains={sorted}
            value=""
            size="lg"
            align="right"
            onChange={(id) => {
              setAttached(true);
              onAttach(id);
            }}
          />
        </div>
      )}
    </div>
  );
}
