// What an offer would do, shown before it is pressed (docs/offer-rules.md R3, D-216).
//
// An offer chip lives in the rail; the grid it would change lives in
// CalendarPane. Rather than threading a callback through every surface that
// mounts a chip (the week crown, the day list, the inbox), the chip writes the
// spot it points at here and the Schedule reads it. One preview at a time —
// the chip under the pointer or the keyboard.
//
// Nothing here writes data (P3): it is a picture of a destination, cleared the
// moment the pointer or focus leaves the chip, or the chip is pressed.

import { useSyncExternalStore } from "react";

export interface OfferPreview {
  /** the chip's identity — so only the chip that set it clears it */
  id: string;
  /** what the block would say on the grid */
  label: string;
  start: Date;
  end: Date;
}

let current: OfferPreview | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showOfferPreview(p: OfferPreview): void {
  if (current && current.id === p.id && current.start.getTime() === p.start.getTime() && current.end.getTime() === p.end.getTime()) return;
  current = p;
  emit();
}

/** Clears the preview — only if `id` still owns it, so leaving one chip can't
 *  wipe the one the pointer just entered. */
export function clearOfferPreview(id?: string): void {
  if (!current) return;
  if (id && current.id !== id) return;
  current = null;
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useOfferPreview(): OfferPreview | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

// ── Other times (R13) ──────────────────────────────────────────────────────
// While an offer's chooser is open, every option is drawn on the grid at once,
// numbered: the one pointed at (or chosen) solid, the rest as quiet ghosts. A
// ghost clicked picks it; a time painted on empty grid is "your pick".

export interface OfferChoiceOption {
  key: string;
  /** 1, 2, 3 — the number the chooser and the grid share */
  num: number;
  label: string;
  start: Date;
  end: Date;
}

export interface OfferChoice {
  id: string;
  options: OfferChoiceOption[];
  /** the option drawn solid */
  strong: string | null;
  onPick: (key: string) => void;
  /** empty time clicked on the grid while choosing — "your pick" */
  onPickTime?: (start: Date) => void;
}

let choice: OfferChoice | null = null;
const choiceListeners = new Set<() => void>();

export function setOfferChoice(c: OfferChoice): void {
  choice = c;
  for (const l of choiceListeners) l();
}

export function clearOfferChoice(id: string): void {
  if (!choice || choice.id !== id) return;
  choice = null;
  for (const l of choiceListeners) l();
}

export function useOfferChoice(): OfferChoice | null {
  return useSyncExternalStore(
    (l) => {
      choiceListeners.add(l);
      return () => choiceListeners.delete(l);
    },
    () => choice,
    () => null,
  );
}
