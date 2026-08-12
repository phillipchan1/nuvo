import { useEffect, useState } from "react";
import { subscribeToAnnouncements } from "../lib/announce";

/**
 * Renders the app's single polite live region (see `lib/announce.ts`).
 *
 * The counter is not decoration. Screen readers announce a live region when its
 * *content changes*, so moving a row down twice — "3 of 7", then "3 of 7" again
 * because it hit the end — would be read once and then fall silent exactly when
 * the user needs to know nothing happened. Keying the inner node on a counter
 * forces a fresh text node every time, so a repeated message is still spoken.
 */
export default function LiveRegion() {
  const [state, setState] = useState({ message: "", n: 0 });

  useEffect(
    () => subscribeToAnnouncements((message) => setState((s) => ({ message, n: s.n + 1 }))),
    [],
  );

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      <span key={state.n}>{state.message}</span>
    </div>
  );
}
