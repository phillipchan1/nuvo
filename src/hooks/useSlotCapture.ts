/**
 * The one way a typed line becomes a slot — the capture door's Slot face.
 *
 * The twin of `useTaskCapture`: same parse, same environment, same sink for
 * harnesses and tests. What the words mean lives in `slotFromCapture`
 * (`lib/captureDraft.ts`); this only writes it.
 */

import { useCallback, useContext } from "react";
import { slotFromCapture, type SlotAction, type SlotWhen } from "../lib/captureDraft";
import { parseCapture } from "../lib/nlp";
import { useCaptureEnv, TaskCaptureSinkContext } from "./useTaskCapture";
import { useSlotMutations } from "./useSlots";
import { useRecurrenceMutations } from "./useRecurrence";
import { useOptionalVertical } from "./useVertical";

export function useSlotCapture() {
  const env = useCaptureEnv();
  const vertical = useOptionalVertical();
  const { createSlot } = useSlotMutations();
  const recurrence = useRecurrenceMutations();
  const sink = useContext(TaskCaptureSinkContext);

  const colorOfDomain = useCallback(
    (id: string) => vertical?.data.domains.find((d) => d.id === id)?.color ?? null,
    [vertical?.data.domains],
  );

  /** What `text` would hold here, without creating it. */
  const preview = useCallback(
    (text: string, when: SlotWhen, literal?: ReadonlySet<string>): SlotAction | null => {
      const raw = text.trim();
      return slotFromCapture(parseCapture(raw, new Date(), { literal }), raw, when, env, colorOfDomain);
    },
    [env, colorOfDomain],
  );

  /** Create the slot (or its series). The single slot is in the caches before
   *  this returns; a series resolves once its first occurrences are laid down. */
  const capture = useCallback(
    async (text: string, when: SlotWhen, literal?: ReadonlySet<string>): Promise<SlotAction | null> => {
      const action = preview(text, when, literal);
      if (!action) return null;
      if (action.kind === "slot-series") {
        const input = { kind: "slot" as const, rule: action.rule, anchorISO: action.anchorISO, template: action.template };
        await (sink ? sink.createSlotSeries?.(input) : recurrence.createSeries(input));
        return action;
      }
      if (sink) await sink.createSlot?.(action.input);
      else createSlot(action.input);
      return action;
    },
    [preview, sink, recurrence, createSlot],
  );

  return { capture, preview };
}
