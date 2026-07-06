// Refine-era remnants still in service. The card deck this module powered
// (ItemRun's gap decomposition, the curated clusters) was replaced by the
// grooming lenses — the axis checklist + router now live in src/lib/lenses.ts
// (docs/grooming-lenses.md §4, §11). What survives is the one proposal both
// the Brief lens and the Capacity run still lean on.

import { addDays, format } from "date-fns";

/** A gentle default finish line when nothing better is on offer — two weeks
 *  out, with buffer. The user can tweak it; this is just the proposal. */
export function proposeDueISO(now: Date = new Date()): string {
  return format(addDays(now, 14), "yyyy-MM-dd");
}
