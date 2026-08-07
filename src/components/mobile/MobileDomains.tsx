// The Domains tab — the phone's domain WALL, the same surface the desktop floor
// opens on (`floors/DomainFloor.tsx`): the fixtures of your life, measured by
// faithfulness over a long arc rather than throughput.
//
// Desktop lays the wall out as a three-up grid of glass cards; a phone has one
// column, so the cards stack — but they are the SAME cards, carrying the same
// living sigil (drawn from the domain's own 13-week pulse), the same state word,
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
import { fmtH, stateOf } from "../../lib/domainRead";
import { domainForm, domainSigilSpec } from "../../lib/domainSigil";
import type { Domain } from "../../lib/vertical";
import DomainSigil from "../floors/DomainSigil";
import { ClarityMark, WeekShape } from "../domain/DomainParts";
import { RefinedSeal, useRefinedCelebration } from "../floors/parts";
import { FloorGuide } from "../orientation/FloorGuide";
import { WelcomeVisual } from "../orientation/Visuals";
import SkeletonRows from "./Skeleton";

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
          teach="Domains are your standing commitments — Family, Work, Faith, Health. Everything you plan hangs off one of them."
          Visual={WelcomeVisual}
          actionLabel="Add your first domain"
          onAction={create}
        />
      </div>
    );
  }

  return (
    <div className="fab-clear px-4 pb-4 pt-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="section-label !p-0">The anchor · areas that persist for years</div>
          <h1 className="masthead mt-0.5 text-lead leading-tight">The fixtures of your life</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {atRest && <RefinedSeal noun="domains" celebrate={celebrate} />}
          <button
            onClick={create}
            disabled={adding}
            className="tap fast shrink-0 rounded-lg border border-line px-3 py-2 text-caption font-medium text-muted active:border-muted active:text-ink disabled:opacity-50"
          >
            ＋ domain
          </button>
        </div>
      </div>
      <p className="mb-4 text-caption text-muted">
        Measured by faithfulness over a long arc — not throughput. Are you still showing up?
      </p>

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
function Niche({ domain, onEnter, teach }: { domain: Domain; onEnter: () => void; teach?: string }) {
  const st = stateOf(domain);
  const lit = st.tone === "lit";
  const spec = domainSigilSpec(domain, domainForm(domain.id));
  return (
    <button
      onClick={onEnter}
      data-teach={teach}
      className="fast flex w-full flex-col rounded-xl p-4 text-left active:scale-[.99]"
      style={{
        border: "1px solid var(--line)",
        borderTop: `1.5px solid color-mix(in srgb, ${domain.color} ${lit ? 55 : 28}%, var(--line))`,
        background: "color-mix(in srgb, var(--surface) 60%, transparent)",
        backdropFilter: "blur(12px) saturate(1.3)",
        WebkitBackdropFilter: "blur(12px) saturate(1.3)",
      }}
    >
      <div className="flex items-start gap-3">
        <DomainSigil spec={spec} size={56} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div
            className="serif truncate text-lead"
            style={{ fontWeight: 500, color: lit ? "var(--text)" : "color-mix(in srgb, var(--text) 68%, var(--muted))" }}
          >
            {domain.name}
          </div>
          <div
            className="mt-0.5 text-meta uppercase"
            style={{ letterSpacing: "0.1em", color: lit ? "var(--muted)" : "var(--signal)" }}
          >
            {st.short}
          </div>
        </div>
        <span className="shrink-0 text-muted">›</span>
      </div>

      {domain.intention.trim() && (
        <div className="serif mt-2.5 line-clamp-2 text-caption italic text-muted">{domain.intention}</div>
      )}

      <div className="mt-3 flex items-end gap-4 border-t border-line pt-2.5">
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
    </button>
  );
}

function Stat({ n, sub, label }: { n: string; sub?: string; label: string }) {
  return (
    <div>
      <div className="mono text-caption" style={{ fontWeight: 600 }}>
        {n}
        {sub && <span className="text-muted" style={{ fontWeight: 500 }}> {sub}</span>}
      </div>
      <div className="text-micro uppercase text-muted" style={{ letterSpacing: "0.07em" }}>{label}</div>
    </div>
  );
}
