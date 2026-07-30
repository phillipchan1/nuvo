// Inline add — the in-place composer for On Deck lanes. Clicking a week / quarter
// turns the slot into this: a card-shaped input, focused, that creates the entity
// right where you clicked — no modal. ⏎ commits and stays open for the next one
// (rapid-fire), Esc or clicking away closes (committing any text first). Deep edit
// lives in the record; this is just the fast "name it on the spot" path.

import { useEffect, useRef, useState } from "react";

export default function InlineAdd({
  placeholder,
  accent = "var(--accent)",
  hint = "⏎ to add · esc when done",
  onCreate,
  onClose,
}: {
  placeholder: string;
  /** Dot + border tint — usually the destination domain's color. */
  accent?: string;
  /** The footer line — names the destination on the phone ("⏎ adds it to next week"). */
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

  useEffect(() => { ref.current?.focus(); }, []);

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
    // A floating focal card: neutral hairline + a lift (shadow), never a colored
    // ring — focus reads from the caret and the rise, per the design language.
    <div
      className="fast relative flex min-h-[62px] flex-col justify-center gap-1.5 rounded-xl border border-line bg-surface px-4 py-3"
      style={{ boxShadow: "var(--shadow-lift)" }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
        <input
          ref={ref}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); handled.current = true; void commit().then(() => { handled.current = false; }); }
            else if (e.key === "Escape") { e.preventDefault(); handled.current = true; onClose(); }
          }}
          onBlur={() => {
            if (handled.current) return;
            const n = name.trim();
            if (n) void onCreate(n);
            onClose();
          }}
          placeholder={placeholder}
          className="nuvo-inline-input min-w-0 flex-1 border-0 bg-transparent py-0.5 text-caption font-semibold leading-snug text-ink shadow-none outline-none placeholder:font-normal placeholder:text-muted/40"
        />
      </div>
      <div className="mono pl-4 text-micro text-muted/70">{hint}</div>
    </div>
  );
}
