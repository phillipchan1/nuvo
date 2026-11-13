/**
 * The Nuvo panel's offers (D-198): what would help on the page beside it, said
 * before you type. A few cards at most, each with its evidence and what its act
 * does; nothing is written until you press it (P3).
 *
 * When you act, the card COLLECTS: its ghost lifts and arcs to where the thing
 * now lives — Memory's row for a kept memory, the page for a drafted path — and
 * that home lands it (lib/motion `collectInto`). It is the only celebration the
 * panel has, and it answers your hand; an offer appearing never animates (P9).
 */

import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "../kit";
import { Icon } from "../Icon";
import { MemoryIcon } from "../memory/MemoryIcon";
import { collectInto, landingTarget } from "../../lib/motion";
import { haptic } from "../../lib/haptics";
import { requestPathDraft } from "../../lib/draftIntent";
import type { Offer } from "../../lib/nuvoOffers";
import { snoozeOffer, unsnoozeOffer, type NuvoOffersState, type OfferMemorySource } from "./useNuvoOffers";

export interface OfferActs {
  /** Act on the offer: draft the path, or keep the memory. */
  primary: (o: Offer, card: HTMLElement | null) => void;
  /** Not true (a memory) — said only where it applies. */
  refuse?: (o: Offer) => void;
  notNow: (o: Offer) => void;
}

/** The cards, drawn from offers and acts — the harness renders this directly. */
export function NuvoOffersView({ offers, acts, phone = false }: { offers: Offer[]; acts: OfferActs; phone?: boolean }) {
  if (!offers.length) return null;
  return (
    <div className="nuvo-offers" data-phone={phone ? "" : undefined}>
      {offers.map((o) => (
        <OfferCard key={o.key} offer={o} acts={acts} />
      ))}
    </div>
  );
}

function OfferCard({ offer: o, acts }: { offer: Offer; acts: OfferActs }) {
  const ref = useRef<HTMLDivElement>(null);
  const isMemory = o.kind === "memory";
  return (
    <div ref={ref} className="nuvo-offer" data-kind={o.kind}>
      <span className="nuvo-offer-kind">
        {isMemory ? <MemoryIcon size={12} /> : <Icon name="sparkles" size={12} />}
        {o.label}
      </span>
      <p className="nuvo-offer-say">{o.statement}</p>
      <p className="nuvo-offer-ev">{o.evidence}</p>
      <p className="nuvo-offer-does">{o.does}</p>
      <div className="nuvo-offer-acts">
        <Button kind="primary" size="sm" onClick={() => acts.primary(o, ref.current)}>
          {isMemory ? "Keep" : "Draft the path"}
        </Button>
        {isMemory && acts.refuse && (
          <Button kind="secondary" size="sm" onClick={() => acts.refuse!(o)}>
            Not true
          </Button>
        )}
        <Button kind="ghost" size="sm" onClick={() => acts.notNow(o)}>
          Not now
        </Button>
      </div>
    </div>
  );
}

/** The live offers with their acts, for the desktop panel and the phone's chat. */
export default function NuvoOffers({
  state,
  memory,
  projectId,
  onOpenProject,
  phone = false,
}: {
  state: NuvoOffersState;
  memory: OfferMemorySource | null;
  /** The project on screen, if any — a draft for it starts in place. */
  projectId?: string | null;
  onOpenProject: (projectId: string) => void;
  phone?: boolean;
}) {
  const acts: OfferActs = {
    primary: (o, card) => {
      if (o.kind === "path" && o.projectId) {
        const here = o.projectId === projectId;
        requestPathDraft(o.projectId);
        if (!here) onOpenProject(o.projectId);
        if (phone) haptic("light");
        void collectInto(card, here ? landingTarget("page-list") ?? landingTarget("page") : landingTarget("page"));
        return;
      }
      const item = state.memoryItem(o);
      if (!item || !memory) return;
      if (phone) haptic("success");
      void collectInto(card, landingTarget("memory"));
      void memory.keep(item);
    },
    refuse: (o) => {
      const item = state.memoryItem(o);
      if (item && memory) memory.refuse(item);
    },
    notNow: (o) => {
      snoozeOffer(o.key);
      toast("Hidden for two weeks.", { action: { label: "Undo", onClick: () => unsnoozeOffer(o.key) } });
    },
  };
  return <NuvoOffersView offers={state.offers} acts={acts} phone={phone} />;
}
