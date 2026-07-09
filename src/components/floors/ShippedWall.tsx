// Shipped — the wall of what you finished. The retrospective sibling of On Deck:
// where the deck looks forward (initiatives with finish lines ahead), this looks back
// (finish lines crossed). Completed projects/initiatives collect here, grouped by
// the period they landed in, so the surface grows into a record of delivered work
// you can revisit and feel good about. Click any to reopen its record.
//
// Two columns: the WALL of cards (left) keeps the "this is a project" language,
// congruent with the other Build views; the celebratory RAIL (right) carries the
// feeling — the quarter's Gain count, the constellation, hours-per-domain, Nuvo's
// read (see ShippedRail). The one action here is attribution: a finished project
// with no area shows a Nuvo-suggested home you can attach in a tap, so the win
// joins the picture. Shared by both Build rungs (projects group by month,
// initiatives by quarter).

import { useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { readShipped, type ShippedItem } from "../../lib/shipped";
import { suggestDomainForText } from "../../lib/initiativeDeck";
import type { Domain } from "../../lib/vertical";
import { READY } from "./ReadinessBanner";
import { FloorHeader } from "./parts";
import ShippedRail from "./ShippedRail";

export default function ShippedWall({ rung }: { rung: "project" | "initiative" }) {
  const { data, updateProject, updateInitiative } = useVertical();
  const { openRecord } = useAppNavigation();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readShipped(data, rung, now), [data, rung, now]);
  const noun = rung === "initiative" ? "initiative" : "project";
  const nounPl = rung === "initiative" ? "initiatives" : "projects";

  // For each finished item with no area, an instant, offline domain suggestion —
  // the same token matcher the initiative deck routes on. Keyed by item id.
  const suggestions = useMemo(() => {
    const source = rung === "initiative" ? data.initiatives : data.projects;
    const byId = new Map(source.map((s) => [s.id, s]));
    const map = new Map<string, { domain: Domain; score: number } | null>();
    for (const g of board.groups) {
      for (const it of g.items) {
        if (it.domain) continue;
        const src = byId.get(it.id);
        const text = src ? `${src.name} ${src.outcome} ${src.description}` : it.name;
        map.set(it.id, suggestDomainForText(data, text));
      }
    }
    return map;
  }, [board.groups, data, rung]);

  const attach = (id: string, domainId: string) => {
    if (rung === "initiative") updateInitiative(id, { domainId });
    else updateProject(id, { domainId });
  };

  return (
    <div className="mx-auto flex min-h-full max-w-[1480px] flex-col">
      <FloorHeader eyebrow={`${board.total} shipped · ${board.thisPeriodCount} ${board.periodNoun}`}>
        <h1 className="text-display masthead">Shipped</h1>
        <p className="mt-1 text-body text-muted">
          Every finish line you've crossed. The {nounPl} you closed out, newest first — a
          growing record of what you actually built.
        </p>
      </FloorHeader>

      {board.total === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border" style={{ borderColor: "var(--line-strong)" }}>
            <Seal color="var(--muted)" />
          </div>
          <p className="mt-3 text-body text-muted">
            Nothing shipped yet. Finish a {noun} on the deck and it lands here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* LEFT — the wall of cards */}
          <div className="min-w-0">
            {/* domain breakdown — where the work landed, at a glance */}
            {board.byDomain.length > 1 && (
              <div className="mb-7 flex flex-wrap items-center gap-2">
                {board.byDomain.map((b, i) => (
                  <span
                    key={b.domain?.id ?? `none-${i}`}
                    className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-caption"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: b.domain?.color ?? "var(--line-strong)" }} />
                    <span className="text-ink">{b.domain?.name ?? "Unlinked"}</span>
                    <span className="mono text-micro text-muted">{b.count}</span>
                  </span>
                ))}
              </div>
            )}

            {/* the wall — one section per period, newest first */}
            <div className="flex flex-col gap-8">
              {board.groups.map((g) => (
                <section key={g.key}>
                  <div className="mb-3 flex items-baseline gap-3">
                    <h2 className="text-head masthead leading-none">{g.label}</h2>
                    <span className="mono text-micro text-muted">{g.items.length} shipped</span>
                    <span className="h-px flex-1" style={{ background: "var(--line)" }} />
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-2.5">
                    {g.items.map((it) =>
                      it.domain ? (
                        <ShippedCard key={it.id} item={it} onOpen={() => openRecord(rung, it.id)} />
                      ) : (
                        <LooseCard
                          key={it.id}
                          item={it}
                          onOpen={() => openRecord(rung, it.id)}
                          suggestion={suggestions.get(it.id) ?? null}
                          onAttach={(domainId) => attach(it.id, domainId)}
                        />
                      ),
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>

          {/* RIGHT — the celebratory rail */}
          <ShippedRail data={data} rung={rung} now={now} />
        </div>
      )}
    </div>
  );
}

function ShippedCard({ item, onOpen }: { item: ShippedItem; onOpen: () => void }) {
  const dot = item.domain?.color ?? "var(--line-strong)";
  return (
    <button
      onClick={onOpen}
      className="glass-lift group/ship fast relative flex items-start gap-2.5 overflow-hidden rounded-xl border border-line bg-surface px-3.5 py-3 text-left"
    >
      {/* domain rail — which area this belongs to */}
      <span className="pointer-events-none absolute inset-y-2.5 left-0 w-[3px] rounded-full" style={{ background: dot }} />
      <span
        className="mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
        style={{ background: `color-mix(in srgb, ${READY} 14%, transparent)` }}
      >
        <Seal color={READY} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-caption font-semibold text-ink">{item.name}</div>
        <div className="mono mt-1 flex items-center gap-1.5 text-micro text-muted">
          {item.domain && (
            <>
              <span>{item.domain.icon}</span>
              <span className="truncate">{item.domain.name}</span>
            </>
          )}
          {item.domain && fmtWhen(item.targetDate) && <span>·</span>}
          {fmtWhen(item.targetDate) && <span>{fmtWhen(item.targetDate)}</span>}
        </div>
      </div>
    </button>
  );
}

// A finished item with no area — the one action on this wall. It shows a
// Nuvo-suggested home you can attach in a tap; until then the win drifts
// off-grid (dashed rail, "Unattributed"), which is the nudge.
function LooseCard({
  item,
  onOpen,
  suggestion,
  onAttach,
}: {
  item: ShippedItem;
  onOpen: () => void;
  suggestion: { domain: Domain; score: number } | null;
  onAttach: (domainId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-dashed border-line bg-surface px-3.5 py-3">
      {/* dashed rail — this doesn't belong to the picture yet */}
      <span
        className="pointer-events-none absolute inset-y-2.5 left-0 w-[3px] rounded-full opacity-60"
        style={{ background: "repeating-linear-gradient(180deg, var(--line-strong) 0 3px, transparent 3px 6px)" }}
      />
      <button onClick={onOpen} className="flex items-start gap-2.5 text-left">
        <span
          className="mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
          style={{ background: `color-mix(in srgb, ${READY} 14%, transparent)` }}
        >
          <Seal color={READY} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-caption font-semibold text-ink">{item.name}</div>
          <div className="mono mt-1 flex items-center gap-1.5 text-micro text-muted">
            <span>Unattributed</span>
            {fmtWhen(item.targetDate) && <span>·</span>}
            {fmtWhen(item.targetDate) && <span>{fmtWhen(item.targetDate)}</span>}
          </div>
        </div>
      </button>

      {suggestion ? (
        <div
          className="ml-[30px] flex items-center gap-2 self-start rounded-full border py-0.5 pl-2.5 pr-0.5 text-micro"
          style={{
            color: "var(--accent)",
            borderColor: "color-mix(in srgb, var(--accent) 34%, transparent)",
            background: "color-mix(in srgb, var(--accent) 9%, transparent)",
          }}
        >
          <span>
            ✦ Nuvo: <b className="font-semibold">{suggestion.domain.name}</b>?
          </span>
          <button
            onClick={() => {
              setBusy(true);
              onAttach(suggestion.domain.id);
            }}
            disabled={busy}
            className="tap rounded-full px-2 py-[3px] text-micro font-semibold disabled:opacity-60"
            style={{ background: "var(--accent)", color: "white" }}
          >
            {busy ? "…" : "Attach"}
          </button>
        </div>
      ) : (
        <button
          onClick={onOpen}
          className="ml-[30px] self-start text-micro text-muted underline decoration-dotted underline-offset-2"
        >
          Choose an area
        </button>
      )}
    </div>
  );
}

function fmtWhen(targetDate: string | null): string | null {
  return targetDate
    ? new Date(targetDate + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
}

function Seal({ color }: { color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" style={{ color }}>
      <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
