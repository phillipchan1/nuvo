// "Create one here" — the one voice, worn by both decks.
//
// This act used to exist three times over. The project planner drew a
// `pointer-events-none` <span> layered over a `pressable` column, the
// initiative deck drew a real <button> with its own copy of the classes, and
// the Table rung drew a filled accent "+ new project". The first two were
// pixel-identical and behaved differently in the DOM; the third looked like a
// different product. A user cannot learn an interface where the same act ranges
// from ghost text to a primary button, and a maintainer cannot keep two copies
// honest — the span had already drifted to 1.96:1 at rest, below the point
// where text is perceivable at all.
//
// What is shared here is the VOICE (`SLOT_CREATE_CLASS`), not the element, and
// that distinction is deliberate:
//
//  • The initiative deck's quarter has a footer, so the affordance is a real
//    <button> — its own tab stop, its own accessible name. `SlotCreateButton`.
//  • The project planner's week is a grid cell that is *itself* the control:
//    `pressable()` already gives the whole column a tab stop, a role and an
//    Enter/Space path, and clicking anywhere in it composes. Nesting a button
//    inside would put two tab stops on one act and a <button> inside a
//    role="button" — so there the affordance is presentational. `SlotCreateHint`.
//
// Either way the resting voice, the hover bloom, the size and the weight come
// from one string, so the two decks cannot drift apart again.
//
// Deliberately tertiary in both. In-grid creation is the *quiet* door; the loud
// one is the Table rung's primary button.

/** The shared voice. `.slot-hint` carries the resting colour and the hover /
 *  focus-within bloom (src/index.css). */
export const SLOT_CREATE_CLASS =
  "slot-hint fast text-micro font-medium transition-colors";

/** The button form — for decks where the affordance owns its own footer. */
export default function SlotCreateButton({
  noun,
  title,
  onCreate,
  className = "",
}: {
  /** What gets made — "project", "initiative". Rendered as "+ {noun}". */
  noun: string;
  /** The full sentence for the tooltip and the accessible name. */
  title: string;
  onCreate: () => void;
  className?: string;
}) {
  return (
    <button
      // Both decks host these inside pointer-driven drag surfaces, so the press
      // must not start a column drag or bubble into the card beneath.
      data-card-control
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onCreate();
      }}
      title={title}
      aria-label={title}
      className={`${SLOT_CREATE_CLASS} tap tap-desk-h w-full py-2 text-center hover:text-[color:var(--slot)] ${className}`}
    >
      + {noun}
    </button>
  );
}

/** The presentational form — for the planner's week column, where the column
 *  itself is the control and this is the label naming what it does. */
export function SlotCreateHint({ noun }: { noun: string }) {
  return <span className={SLOT_CREATE_CLASS}>+ {noun}</span>;
}
