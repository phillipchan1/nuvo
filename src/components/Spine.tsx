import type { Rung } from "./AppShell";

// The permanent left navigation. Five rungs ordered by time horizon — every
// step up is a strictly wider lens. Day · Week (the calendar) is the home rung.
const RUNGS: { id: Rung; label: string }[] = [
  { id: "domain", label: "Domain" },
  { id: "initiative", label: "Initiative" },
  { id: "project", label: "Project" },
  { id: "day", label: "Day · Week" },
  { id: "now", label: "Now" },
];

export default function Spine({ rung, setRung }: { rung: Rung; setRung: (r: Rung) => void }) {
  return (
    <div className="relative flex w-[74px] shrink-0 flex-col items-center border-r border-line bg-surface">
      {/* drag region that also clears the macOS traffic lights */}
      <div data-tauri-drag-region className="h-9 w-full shrink-0" />

      {/* connector line behind the rungs */}
      <div className="pointer-events-none absolute left-1/2 top-[58px] bottom-12 w-px -translate-x-1/2 bg-line" />

      <div className="flex flex-1 flex-col items-center justify-center gap-7">
        {RUNGS.map((r) => {
          const on = r.id === rung;
          return (
            <button
              key={r.id}
              onClick={() => setRung(r.id)}
              className="relative z-10 flex flex-col items-center gap-1.5"
              title={r.label}
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

      <div className="mono pb-3 text-[9px] text-muted">⌘↑↓</div>
    </div>
  );
}
