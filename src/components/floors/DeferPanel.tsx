// DeferPanel — "I can't get to this." The deferrals, opened by you.
//
// The Week's Plan row has offered these acts since D-060, but only as the
// remedy to a problem the app noticed (loose work). A project whose work was all
// placed had no problem, so it had no panel — and no way off the week at all.
// And from the Schedule, where the block actually sits, there was nothing but
// Delete slot. This is the same shell (`RemedyPanel`) and the same wording,
// reachable from the thing you're looking at, with the cost said BEFORE the
// press: which blocks and how much work come off the calendar.
//
// It renders in three frames — under a Week's Plan row, in a card on the
// Schedule, in the phone's slot sheet — and computes nothing itself: the cost is
// `useProjectTimeCost`, the acts are `useDeferProject`.

import { useDeferProject, useProjectTimeCost, useSlotTimeCost } from "../../hooks/useProjectTime";
import { costPhrase } from "../../lib/projectTime";
import { projectById, type Project } from "../../lib/vertical";
import { useOptionalVertical } from "../../hooks/useVertical";
import { mondayOf } from "../../../supabase/functions/_shared/planningRules.ts";
import type { Slot } from "../../lib/types";
import { RemedyPanel, type RemedyAct } from "./RemedyPanel";

export function DeferPanel({
  project,
  weekStartISO,
  slot,
  onDone,
}: {
  project: Project;
  /** the week the project is being deferred FROM */
  weekStartISO: string;
  /** opened from one block — adds "free just this block" */
  slot?: Slot | null;
  onDone?: () => void;
}) {
  const { takeOff, pushOut, freeSlot } = useDeferProject();
  const weekCost = useProjectTimeCost(project.id, "next_week", weekStartISO);
  const slotCost = useSlotTimeCost(slot);
  const slotPhrase = slot ? costPhrase(slotCost) : null;
  const phrase = costPhrase(weekCost);

  const done = (fn: () => void) => () => {
    fn();
    onDone?.();
  };

  const acts: RemedyAct[] = [
    ...(slot
      ? [
          {
            label: "Free just this block",
            title: slotPhrase
              ? `Takes ${slotPhrase} off the calendar. The project stays on the week and this work goes loose.`
              : "Takes this block off the calendar. The project stays on the week.",
            onPress: done(() => freeSlot(slot)),
          },
        ]
      : []),
    {
      label: "Move it to next week",
      title: "Move the whole project to next week, keeping how long it runs.",
      onPress: done(() => void pushOut(project, weekStartISO)),
      quiet: !slot,
    },
    {
      label: "Take it off this week",
      title: "Off the week entirely — it goes back to needing a week.",
      onPress: done(() => void takeOff(project, weekStartISO)),
      quiet: true,
    },
  ];

  return (
    <RemedyPanel
      tone="asked"
      problem={phrase ? `Still on the calendar this week: ${phrase}.` : "Nothing of this is on the calendar from today."}
      why={
        phrase
          ? slot
            ? "Moving it or taking it off the week clears all of that — the work stays in the project. Freeing this block clears only it."
            : "Moving it or taking it off the week clears that — the work stays in the project."
          : undefined
      }
      acts={acts}
    />
  );
}

/** The panel for ONE block: finds the project behind the slot and the week the
 *  slot sits in. Renders nothing for a slot that isn't project time. */
export function SlotDeferPanel({ slot, onDone }: { slot: Slot; onDone?: () => void }) {
  const store = useOptionalVertical();
  const project = store ? projectById(store.data, slot.project_id) : null;
  if (!project) return null;
  return <DeferPanel project={project} weekStartISO={mondayOf(slot.do_date)} slot={slot} onDone={onDone} />;
}
