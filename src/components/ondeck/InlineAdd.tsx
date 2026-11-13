// Inline add — the in-place composer for the decks' columns. Clicking a week /
// quarter turns the slot into this: the card you are about to make, already in
// place and focused (`.deck-compose`, styles/decks.css — a deck card's surface
// wearing the kit's focused-field ring), so naming it is the only act. ⏎ commits
// and stays open for the next one (rapid-fire); Esc or clicking away closes,
// committing any text first. Deep edit lives in the record.

import { useEffect, useRef, useState } from "react";
import { Dot } from "../kit";

export default function InlineAdd({
  placeholder,
  accent = "var(--accent)",
  hint,
  onCreate,
  onClose,
}: {
  placeholder: string;
  /** The identity Dot — the destination domain's colour. */
  accent?: string;
  /** A line under the name that says where it lands — the phone's deck names the
   *  column it can't show ("⏎ adds it to next week"). On the desktop the card is
   *  already standing in its column, so there is nothing to add. */
  hint?: string;
  /** Persist one entity by name. Awaited so we can re-focus for the next add. */
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // guards the blur-commit from firing after an explicit Enter/Escape already handled it
  const handled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // ⏎ — create, clear, keep focus so several land in a row without re-clicking.
  const commit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setName("");
    try {
      await onCreate(n);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => ref.current?.focus());
    }
  };

  return (
    <div className="deck-compose" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="deck-compose-line">
        <Dot color={accent} />
        <input
          ref={ref}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handled.current = true;
              void commit().then(() => {
                handled.current = false;
              });
            } else if (e.key === "Escape") {
              e.preventDefault();
              handled.current = true;
              onClose();
            }
          }}
          onBlur={() => {
            if (handled.current) return;
            const n = name.trim();
            if (n) void onCreate(n);
            onClose();
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="nuvo-inline-input"
        />
      </div>
      {hint && <div className="deck-compose-hint">{hint}</div>}
    </div>
  );
}
