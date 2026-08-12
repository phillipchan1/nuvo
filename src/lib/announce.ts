/**
 * The app's one ARIA live region.
 *
 * Keyboard acts that change something *elsewhere* on screen need a voice. A
 * mouse user watching a row travel up the list has already been told what
 * happened; a keyboard user has moved a row they cannot see move, and without
 * an announcement the only feedback is silence.
 *
 * `sonner` toasts don't cover this. They're for acts that need an *undo* — they
 * come with a visible surface, a timeout and a button, which is far too much
 * ceremony for "2 of 7". This is the quiet channel: no pixels, screen readers
 * only.
 *
 * One region for the whole app, mounted once at the root, rather than a live
 * region per list — several live regions compete, and assistive tech reads them
 * in an order nobody controls.
 */

type Listener = (message: string) => void;

const listeners = new Set<Listener>();

/**
 * Say something once. Politeness is fixed at "polite": every announcement here
 * is a consequence of something the user just did deliberately, so none of it
 * is urgent enough to interrupt what's already being read.
 */
export function announce(message: string): void {
  for (const l of listeners) l(message);
}

export function subscribeToAnnouncements(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
