// Projects → Groom — the Board layout (D-190). Where On Deck answers WHEN
// (time-box projects across weeks), Groom answers WHAT: every in-flight project
// is a card in the column of how shaped it is — Raw · Grooming · Ready (and
// Parked, when anything rests) — and the card you pick opens in place into its
// workbench: define the outcome, rattle off the steps, park it or ship it.
//
// The face's head (the hero that says how many are left to shape, and Block
// time) is ProjectReadinessStrip, mounted above this by FloorPane. Both read the
// same lanes through `useGroomLanes`, so the hero and the columns can't disagree
// — the old legend beside the hero counted one model and the strip another.

import { useMemo } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { readOnDeck, type OnDeckLane } from "../../lib/onDeck";
import GroomWall from "../ondeck/GroomWall";

const HORIZON = 8;

/** The Groom board's lanes — readOnDeck's, minus the shipped. */
export function useGroomLanes(): OnDeckLane[] {
  const { data } = useVertical();
  const { byWeek, weeklyAvgMins } = useCapacity();
  const now = useMemo(() => new Date(), []);
  return useMemo(
    () => readOnDeck(data, byWeek, weeklyAvgMins, now, HORIZON).lanes.filter((l) => l.readyTier !== "done"),
    [data, byWeek, weeklyAvgMins, now],
  );
}

export default function GroomFloor() {
  const lanes = useGroomLanes();
  const { openRecord } = useAppNavigation();
  return <GroomWall lanes={lanes} onOpen={(id) => openRecord("project", id)} />;
}
