// How long a block should be when nobody said.
//
// A slot exists to COVER its contents, so an unstated length follows the work
// rather than defaulting to an hour that truncates it. Both runtimes need this
// rule now — the chat sizes `create_slot` with it, and the Schedule sizes the
// block you get when you drop a multi-selection on the grid. Two copies of
// "how big is this block" is exactly the drift the kernel exists to prevent.
//
// Zero imports (Deno resolves no bare specifiers here), pure, no clock.

/** What one piece of work is worth when it doesn't say. Mirrors the app's
 *  DEFAULT_DURATION_MINUTES and the agent's DEFAULT_DURATION — kept here so a
 *  caller with nothing but a count can still ask for a size. */
export const DEFAULT_PIECE_MINUTES = 30;

/** The grid's snap. A block that doesn't land on a quarter hour reads as a
 *  mistake next to every other event on the calendar. */
const SNAP_MINUTES = 15;

/** The smallest block worth holding — below this it isn't time you defended. */
const FLOOR_MINUTES = 30;

/**
 * Size a slot to what's going inside it.
 *
 * Sums the pieces (an absent duration counts as `DEFAULT_PIECE_MINUTES`), then
 * holds a 30-minute floor and rounds up to the next quarter hour. Summing —
 * rather than counting — is the point: three 15-minute errands are a
 * 45-minute block, not an hour and a half.
 */
export function sizeSlotToContents(durations: (number | null | undefined)[]): number {
  const total = durations.reduce<number>(
    (sum, d) => sum + (typeof d === "number" && d > 0 ? d : DEFAULT_PIECE_MINUTES),
    0,
  );
  return Math.ceil(Math.max(total, FLOOR_MINUTES) / SNAP_MINUTES) * SNAP_MINUTES;
}

/** The same rule for a caller that knows only how many pieces there are (the
 *  chat, drafting tasks it hasn't created yet). */
export function sizeSlotToCount(count: number): number {
  return sizeSlotToContents(new Array(Math.max(count, 1)).fill(DEFAULT_PIECE_MINUTES));
}
