// Shipped — the wall of what you finished, on the Board layout (D-190). The
// retrospective sibling of On Deck: where the deck looks forward, this looks
// back. Completed projects/initiatives stand in a column per period they landed
// in (projects by month, initiatives by quarter), newest first, each one kit
// Card: its title and a meta row (its domain, the day it shipped). Click any to
// reopen its record.
//
// One hero states the fact (how many shipped). The rail beside the wall
// (ShippedRail) carries the period's Gain. The one act on this wall is
// attribution: a finished item with no domain is missing that one check, and
// shows a Nuvo-suggested home you can file it in with a tap, so the win joins
// the picture. Shared by both Build rungs.

import { useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { readShipped, type ShippedItem } from "../../lib/shipped";
import { suggestDomainForText } from "../../lib/initiativeDeck";
import type { Domain } from "../../lib/vertical";
import { pressable } from "../../lib/a11y";
import { Icon } from "../Icon";
import { FloorHeader } from "./parts";
import ShippedRail from "./ShippedRail";
import { CardCheck, ColumnHead } from "../ondeck/GroomWall";
import { Button, Card, Chip, ChipButton } from "../kit";

export default function ShippedWall({ rung }: { rung: "project" | "initiative" }) {
  const { data, updateProject, updateInitiative } = useVertical();
  const { openRecord } = useAppNavigation();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readShipped(data, rung, now), [data, rung, now]);

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
      <FloorHeader>
        <h1 className="text-display masthead">{board.total === 0 ? "Nothing shipped yet" : `${board.total} shipped`}</h1>
      </FloorHeader>

      {board.total > 0 && (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_288px]">
          {/* the wall — one column per period, newest first */}
          <div className="fl-board" data-wrap="">
            {board.groups.map((g) => (
              <section key={g.key} className="fl-col" aria-label={g.label}>
                <ColumnHead step="shipped" label={g.label} count={g.items.length} />
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
              </section>
            ))}
          </div>

          {/* the period's Gain */}
          <ShippedRail data={data} rung={rung} now={now} />
        </div>
      )}
    </div>
  );
}

function ShippedCard({ item, onOpen }: { item: ShippedItem; onOpen: () => void }) {
  const when = fmtWhen(item.at);
  return (
    <Card interactive className="fl-card" {...pressable(onOpen, { label: item.name })} onClick={onOpen}>
      <div className="fl-card-title">{item.name}</div>
      <div className="fl-meta">
        {item.domain && <Chip dot={item.domain.color}>{item.domain.name}</Chip>}
        {when && <span className="fl-meta-fact">{when}</span>}
      </div>
    </Card>
  );
}

// A finished item with no domain — the one act on this wall. It is missing one
// check (its domain), and shows a Nuvo-suggested home you can file it in.
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
  const when = fmtWhen(item.at);
  return (
    <Card interactive className="fl-card" {...pressable(onOpen, { label: item.name })} onClick={onOpen}>
      <div className="fl-card-title">{item.name}</div>
      <div className="fl-checks">
        <CardCheck met={false}>Domain</CardCheck>
      </div>
      <div className="fl-meta" onClick={(e) => e.stopPropagation()}>
        {suggestion ? (
          <ChipButton
            data-tone="accent"
            icon={<Icon name="sparkles" size={12} />}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onAttach(suggestion.domain.id);
            }}
            title={`File it in ${suggestion.domain.name}`}
          >
            File in {suggestion.domain.name}
          </ChipButton>
        ) : (
          <Button kind="ghost" size="xs" onClick={onOpen}>
            Choose a domain
          </Button>
        )}
        {when && <span className="fl-meta-fact">{when}</span>}
      </div>
    </Card>
  );
}

function fmtWhen(at: string | null): string | null {
  return at
    ? new Date(at + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
}
