// The Domains tab — the phone's domain WALL, the same surface the desktop floor
// opens on (`floors/DomainFloor.tsx`): the fixtures of your life, measured by
// presence over a long arc rather than throughput.
//
// Desktop lays the wall out as a three-up grid of cards; a phone has one
// column, so the cards stack — kit Cards — carrying the same
// living mark (chosen symbol + color + 13-week presence halo), the same state word,
// the same Gain numbers and the same "routes clean" mark. Above them sits the
// week's shape, the one read that answers "am I starving a domain to feed
// another?" — shared with the desktop verbatim, seven day columns on an absolute
// scale.
//
// Tapping a card opens that domain in the shared detail Sheet
// (`detail/MobileDomainScreen.tsx`), which is the phone's open domain.

import { useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { readSpine } from "../../lib/readiness";
import { fmtH, stateOf, wallLine } from "../../lib/domainRead";
import { domainMarkSpec } from "../../lib/domainMark";
import type { Domain } from "../../lib/vertical";
import DomainMark from "../domain/DomainMark";
import { ClarityMark, WeekShape } from "../domain/DomainParts";
import { RefinedSeal, useRefinedCelebration } from "../floors/parts";
import { FloorGuide } from "../orientation/FloorGuide";
import { WelcomeVisual } from "../orientation/Visuals";
import SkeletonRows from "./Skeleton";
import { Card, CrownLine } from "../kit";
import { pressable } from "../../lib/a11y";
import { Icon } from "../Icon";
import { TouchButton } from "./touch";

export default function MobileDomains({
  onOpenItem,
}: {
  onOpenItem: (kind: "project" | "initiative" | "domain", id: string) => void;
}) {
  const { data, ready, addDomain } = useVertical();
  const domains = useMemo(() => [...data.domains].sort((a, b) => a.sort - b.sort), [data.domains]);
  const atRest = readSpine(data).floors.domain.calm;
  const celebrate = useRefinedCelebration("domain-mobile", atRest);
  const [adding, setAdding] = useState(false);

  const totalWeek = domains.reduce((s, d) => s + d.investedThisWeek, 0);
  const quiet = wallLine(domains);

  const create = () => {
    if (adding) return;
    setAdding(true);
    void addDomain()
      .then((d) => onOpenItem("domain", d.id))
      .finally(() => setAdding(false));
  };

  if (!ready) return <SkeletonRows rows={4} />;

  // First visit: no domains yet → the same teacher the desktop floor shows, so
  // the top of the funnel is taught in one voice. Self-cleans on first create.
  if (domains.length === 0) {
    return (
      <div className="fab-clear flex h-full flex-col">
        <FloorGuide
          eyebrow="Domains"
          title="Name the areas of your life."
          teach="Domains are your standing commitments — Family, Work, Health, Finances. Everything you plan hangs off one of them."
          Visual={WelcomeVisual}
          actionLabel="Add your first domain"
          onAction={create}
        />
      </div>
    );
  }

  return (
    // No hero and no strapline here: the top bar already says "Domains", and the
    // cards say what a domain is better than a sentence about them could.
    <div className="fab-clear px-4 pb-4 pt-1">
      <div className="mb-3 flex min-h-11 items-center gap-3">
        <span className="min-w-0 flex-1 text-caption tabular-nums text-muted">
          <span className="font-semibold text-ink">{domains.length}</span> {domains.length === 1 ? "domain" : "domains"}
        </span>
        {atRest && <RefinedSeal noun="domains" celebrate={celebrate} />}
        <TouchButton compact onClick={create} disabled={adding} icon={<Icon name="plus" size={16} />}>
          Domain
        </TouchButton>
      </div>

      {/* The wall's line (D-207) — the same read the desktop wall says. */}
      {quiet && (
        <div className="mb-3">
          <CrownLine
            line={{ tone: "muted", glyph: null, text: quiet.text, act: `Open ${quiet.name}`, then: null }}
            onPress={() => onOpenItem("domain", quiet.domainId)}
          />
        </div>
      )}
      {totalWeek > 0 && (
        <div className="mb-4">
          {/* Shorter columns and no legend: at 375px the seven day totals under
              the bars already name the week, and the per-domain legend repeats
              what the cards below say in full. */}
          <WeekShape domains={domains} height={52} legend={false} />
        </div>
      )}

      <div className="flex flex-col gap-3">
        {/* The walkthrough lights the FIRST card, not the wall — a named thing
            they typed themselves reads as "this is yours" (teachTargets.ts). */}
        {domains.map((d, i) => (
          <Niche
            key={d.id}
            domain={d}
            onEnter={() => onOpenItem("domain", d.id)}
            teach={i === 0 ? "domain-card" : undefined}
          />
        ))}
      </div>
    </div>
  );
}

// ── One domain on the wall — the desktop card, one column wide ────────────────
// A kit Card: the living mark, the name as the card's hero (15/600), its state
// in one quiet word, the mandate (two lines at most, upright), and two numbers.
// A lit domain carries its hue along the top edge; a quiet one only a trace.
function Niche({ domain, onEnter, teach }: { domain: Domain; onEnter: () => void; teach?: string }) {
  const st = stateOf(domain);
  const lit = st.tone === "lit";
  const mark = domainMarkSpec(domain);
  return (
    <Card
      interactive
      onClick={onEnter}
      {...pressable(onEnter)}
      data-teach={teach}
      className="ph-card w-full text-left"
      style={{
        boxShadow: `inset 0 2px 0 color-mix(in srgb, ${domain.color} ${lit ? 70 : 30}%, transparent), 0 0 0 1px var(--line-1), var(--sh-1)`,
      }}
    >
      <div className="flex items-start gap-3">
        <DomainMark spec={mark} size={52} className="shrink-0" />
        <div className="min-w-0 flex-1 pt-1">
          <div className={`truncate text-head font-semibold ${lit ? "text-ink" : "text-[var(--ink-2)]"}`}>{domain.name}</div>
          <div className="mt-0.5 text-caption text-muted">{st.short}</div>
        </div>
        <Icon name="chevron-right" size={16} className="mt-1.5 shrink-0 text-[var(--faint)]" />
      </div>

      {domain.intention.trim() && (
        <div className="line-clamp-2 text-body text-muted">{domain.intention}</div>
      )}

      <div className="flex items-end gap-5 border-t border-[var(--line-1)] pt-2.5">
        <Stat
          n={fmtH(domain.investedThisWeek)}
          sub={domain.weeklyTargetHours > 0 ? `/ ${fmtH(domain.weeklyTargetHours)}` : ""}
          label="this week"
        />
        <Stat n={`${domain.quarterHours}h`} label="quarter" />
        <div className="ml-auto flex justify-end">
          <ClarityMark domain={domain} />
        </div>
      </div>
    </Card>
  );
}

function Stat({ n, sub, label }: { n: string; sub?: string; label: string }) {
  return (
    <div>
      <div className="text-body font-semibold tabular-nums text-ink">
        {n}
        {sub && <span className="font-medium text-muted"> {sub}</span>}
      </div>
      <div className="text-caption text-muted">{label}</div>
    </div>
  );
}
