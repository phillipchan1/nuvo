// "Create one here" — the one voice, worn by both decks.
//
// This act used to exist three times over, in three looks; a user cannot learn
// an interface where the same act ranges from ghost text to a primary button,
// and a maintainer cannot keep two copies honest. What is shared here is the
// VOICE (`SLOT_CREATE_CLASS` — `.slot-hint` in styles/decks.css: a plus and a
// noun, 12/500, faint at rest, open time (--slot) when its column is
// receptive), not the element, and that distinction is deliberate:
//
//  • The initiative deck's quarter has a footer, so the affordance is a real
//    <button> — its own tab stop, its own accessible name. `SlotCreateButton`.
//  • The project planner's week is a grid cell that is *itself* the control:
//    `pressable()` already gives the whole column a tab stop, a role and an
//    Enter/Space path, and clicking anywhere in it composes. Nesting a button
//    inside would put two tab stops on one act and a <button> inside a
//    role="button" — so there the affordance is presentational. `SlotCreateHint`.
//
// Deliberately tertiary in both. In-grid creation is the *quiet* door; the loud
// one is the rail's "New project" / "New initiative".

import { Icon } from "../Icon";

/** The shared voice. */
export const SLOT_CREATE_CLASS = "slot-hint";

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
      type="button"
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
      className={`${SLOT_CREATE_CLASS} ${className}`}
    >
      <Icon name="plus" size={12} />
      {noun}
    </button>
  );
}

/** The presentational form — for the planner's week column, where the column
 *  itself is the control and this is the label naming what it does. */
export function SlotCreateHint({ noun }: { noun: string }) {
  return (
    <span className={SLOT_CREATE_CLASS}>
      <Icon name="plus" size={12} />
      {noun}
    </span>
  );
}
