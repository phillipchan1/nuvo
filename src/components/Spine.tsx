import { LADDER, type Rung } from "./AppShell";

// Top-to-bottom: Now (immediate) → Domain (widest). ⌘1 at top, ⌘5 at bottom.
const RUNGS: { id: Rung; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "day", label: "Day · Week" },
  { id: "project", label: "Project" },
  { id: "initiative", label: "Initiative" },
  { id: "domain", label: "Domain" },
];

export default function Spine({
  rung,
  setRung,
  onBegin,
}: {
  rung: Rung;
  setRung: (r: Rung) => void;
  onBegin: () => void;
}) {
  return (
    <div className="relative flex w-[74px] shrink-0 flex-col items-center border-r border-line bg-surface">
      {/* drag region that also clears the macOS traffic lights */}
      <div data-tauri-drag-region className="h-9 w-full shrink-0" />

      {/* Begin — the ritual door. Floors are for looking; rituals are for deciding. */}
      <button
        onClick={onBegin}
        title="Sunday ritual — plan the week"
        className="fast group mb-1 flex flex-col items-center gap-1"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-[12px] text-muted transition-colors group-hover:border-accent group-hover:text-accent">
          ◉
        </span>
        <span className="mono text-[8px] text-muted group-hover:text-ink">begin</span>
      </button>

      {/* connector line behind the rungs */}
      <div className="pointer-events-none absolute left-1/2 top-[104px] bottom-12 w-px -translate-x-1/2 bg-line" />

      <div className="flex flex-1 flex-col items-center justify-center gap-7">
        {RUNGS.map((r) => {
          const on = r.id === rung;
          return (
            <button
              key={r.id}
              onClick={() => setRung(r.id)}
              className="relative z-10 flex flex-col items-center gap-1.5"
              title={`${r.label} (⌘${LADDER.indexOf(r.id) + 1})`}
            >
              <span
                className="fast rounded-full"
                style={{
                  width: on ? 12 : 8,
                  height: on ? 12 : 8,
                  background: on ? "var(--accent)" : "var(--line)",
                  boxShadow: on ? "0 0 0 4px var(--accent-soft)" : "none",
                }}
              />
              <span
                className="mono text-center text-[9px] leading-tight"
                style={{ color: on ? "var(--text)" : "var(--muted)" }}
              >
                {r.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mono pb-3 text-center text-[9px] leading-tight text-muted">⌘1–5<br />⌘↓↑</div>
    </div>
  );
}
