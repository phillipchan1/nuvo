// Initiatives → Groom — the Board layout (D-190), the initiative sibling of the
// projects' Groom. Where On Deck answers WHEN (time-box initiatives onto
// quarters), this answers WHAT: every open initiative is a card in the column
// of how groomed it is — Raw · Grooming · Ready, and Parked — on its two axes,
// Defined (an objective with a finish line) and Measured (key results). The card
// you pick opens in place into its workbench.
//
// The head (the hero + Block time) is InitiativeReadinessStrip, mounted above by
// FloorPane; both read `useInitiativeGroomLanes` and the wall's
// `initiativeTier`, so the hero and the columns can't disagree.

import { useMemo } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { allOpenInitiativeLanes, type InitiativeLane } from "../../lib/initiativeDeck";
import InitiativeGroomWall from "../ondeck/InitiativeGroomWall";

/** The Groom board's lanes — every open initiative. */
export function useInitiativeGroomLanes(): InitiativeLane[] {
  const { data } = useVertical();
  const now = useMemo(() => new Date(), []);
  return useMemo(() => allOpenInitiativeLanes(data, now), [data, now]);
}

export default function InitiativeGroomFloor() {
  const lanes = useInitiativeGroomLanes();
  const { openRecord } = useAppNavigation();
  return <InitiativeGroomWall lanes={lanes} onOpen={(id) => openRecord("initiative", id)} />;
}
