// The human-first step composer — rattle off your own lines, Todoist-fast.
// Extracted from RefineRun's card deck (docs/grooming-lenses.md §6) so the Path
// lens (and anything else that grooms a list into being) shares one composer.
// Policy: human drives, Nuvo refines + enriches — the composer is the human
// half; SuggestList/SuggRow render Nuvo's opt-in gap-fill beside it.

import { useRef } from "react";

export type StepLine = { id: number; text: string };

export function StepComposer({ lines, setLines, accent, placeholder, meta }: {
  lines: StepLine[]; setLines: React.Dispatch<React.SetStateAction<StepLine[]>>; accent: string; placeholder: string;
  /** optional per-line trailing control (e.g. the Path lens's duration cycler). */
  meta?: (line: StepLine, idx: number) => React.ReactNode;
}) {
  const nextId = useRef(1000);
  const refs = useRef(new Map<number, HTMLInputElement>());
  const focusLine = (id: number) => requestAnimationFrame(() => refs.current.get(id)?.focus());

  const addAfter = (id: number) => {
    const fresh = { id: nextId.current++, text: "" };
    setLines((ls) => { const i = ls.findIndex((l) => l.id === id); const n = [...ls]; n.splice(i + 1, 0, fresh); return n; });
    focusLine(fresh.id);
  };
  const removeLine = (id: number) =>
    setLines((ls) => {
      if (ls.length <= 1) return ls;
      const i = ls.findIndex((l) => l.id === id);
      const prev = ls[i - 1] ?? ls[i + 1];
      if (prev) focusLine(prev.id);
      return ls.filter((l) => l.id !== id);
    });
  const setText = (id: number, text: string) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, text } : l)));

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, line: StepLine, idx: number) => {
    if (e.key === "Enter") { e.preventDefault(); addAfter(line.id); return; }
    if (e.key === "Backspace" && line.text === "" && lines.length > 1) { e.preventDefault(); removeLine(line.id); return; }
    const el = e.currentTarget;
    if (e.key === "ArrowUp" && el.selectionStart === 0 && idx > 0) { e.preventDefault(); focusLine(lines[idx - 1].id); }
    if (e.key === "ArrowDown" && el.selectionStart === el.value.length && idx < lines.length - 1) { e.preventDefault(); focusLine(lines[idx + 1].id); }
  };

  return (
    // No box — inline lines on the paper (Todoist-style). The active line reads
    // from the caret + a faint focus tint, never a bordered field.
    <div className="-mx-1.5">
      {lines.map((line, idx) => (
        <div key={line.id} className="group fast flex items-center gap-2.5 rounded-md px-1.5 py-1 transition-colors focus-within:bg-surface-2/50">
          <span className="shrink-0 text-[10px]" style={{ color: line.text.trim() ? accent : "var(--line-strong)" }}>◦</span>
          <input
            ref={(el) => { if (el) refs.current.set(line.id, el); else refs.current.delete(line.id); }}
            value={line.text}
            onChange={(e) => setText(line.id, e.target.value)}
            onKeyDown={(e) => onKey(e, line, idx)}
            placeholder={idx === 0 ? placeholder : "…and the next"}
            className="nuvo-inline-input min-w-0 flex-1 border-0 bg-transparent py-0.5 text-body text-ink shadow-none outline-none placeholder:text-muted/45"
          />
          {meta && line.text.trim() !== "" && meta(line, idx)}
          {lines.length > 1 && (
            <button onClick={() => removeLine(line.id)} tabIndex={-1} className="fast tap shrink-0 px-1.5 text-meta text-muted/60 opacity-0 transition-opacity hover:text-signal group-focus-within:opacity-100 group-hover:opacity-100" title="Remove this line">✕</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Nuvo's gap-fill — a dashed, clearly-secondary tray of toggleable suggestions
export function SuggestList({ accent, label, children }: { accent: string; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed px-2.5 py-2" style={{ borderColor: `color-mix(in srgb, ${accent} 45%, var(--line))` }}>
      <div className="section-label mb-1" style={{ color: accent }}>✦ {label}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function SuggRow({ on, accent, onToggle, title, meta }: { on: boolean; accent: string; onToggle: () => void; title: string; meta: string }) {
  return (
    <button onClick={onToggle} className="tap fast flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-micro text-white" style={{ borderColor: on ? accent : "var(--line)", background: on ? accent : "transparent" }}>{on ? "✓" : ""}</span>
      <span className={`min-w-0 flex-1 truncate text-caption ${on ? "" : "text-muted line-through"}`}>{title}</span>
      {meta && <span className="mono shrink-0 text-micro text-muted">{meta}</span>}
    </button>
  );
}
