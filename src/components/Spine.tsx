import { LADDER, type Rung } from "./AppShell";

// Top-to-bottom: Now (immediate) → Domain (widest). ⌘1 at top, ⌘5 at bottom.
const RUNGS: { id: Rung; label: string }[] = [
  { id: "now", label: "Today" },
  { id: "day", label: "Day · Week" },
  { id: "project", label: "Project" },
  { id: "initiative", label: "Initiative" },
  { id: "domain", label: "Domain" },
];

export type FlowName = "sunday" | "summit" | "blueprint";

// A flow is the *act* of deciding at an altitude. Floors are for looking;
// flows are for deciding — so each ritual now lives on the rung it operates on,
// instead of hiding in a corner menu. (Today / Project have no ritual yet —
// the natural next one is a daily "Plan today" docked on Now.)
const RUNG_FLOW: Partial<Record<Rung, { flow: FlowName; label: string; sub: string }>> = {
  day: { flow: "sunday", label: "Sunday", sub: "compose the week" },
  initiative: { flow: "blueprint", label: "Blueprint", sub: "shape a new bet" },
  domain: { flow: "summit", label: "Summit", sub: "decide the quarter" },
};

// The ladder bends at a seam: Now/Day are time horizons (execution); Project
// and below are structure. A faint joint makes the L-bend legible.
const SEAM_BEFORE: Rung = "project";

export default function Spine({
  rung,
  setRung,
  openFlow,
}: {
  rung: Rung;
  setRung: (r: Rung) => void;
  openFlow: (f: FlowName) => void;
}) {
  return (
    <div className="spine-dark relative z-40 flex w-[74px] shrink-0 flex-col items-center border-r border-line bg-surface">
      {/* drag region that also clears the macOS traffic lights */}
      <div data-tauri-drag-region className="h-9 w-full shrink-0" />

      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="relative flex flex-col items-center gap-7">
          {/* connector line behind the rungs */}
          <div
            className="pointer-events-none absolute left-1/2 w-px -translate-x-1/2 bg-line"
            style={{ top: 6, bottom: 22 }}
          />

          {RUNGS.map((r) => {
            const on = r.id === rung;
            const rf = RUNG_FLOW[r.id];
            return (
              <div key={r.id} className="contents">
                {r.id === SEAM_BEFORE && (
                  // execution above · structure below
                  <div
                    aria-hidden
                    title="Execution above · structure below"
                    className="relative z-10 flex h-1 w-full items-center justify-center"
                  >
                    <span className="h-px w-5" style={{ background: "var(--line-strong)" }} />
                  </div>
                )}

                <div className="group relative flex w-[74px] flex-col items-center">
                  <button
                    onClick={() => setRung(r.id)}
                    className="relative z-10 flex flex-col items-center gap-1.5"
                    title={`${r.label} (⌘${LADDER.indexOf(r.id) + 1})`}
                  >
                    <span
                      className="rounded-full"
                      style={{
                        width: on ? 12 : 8,
                        height: on ? 12 : 8,
                        background: on ? "var(--accent)" : "var(--line-strong)",
                        boxShadow: on
                          ? "0 0 0 4px var(--accent-soft), 0 0 12px 1px var(--accent-glow)"
                          : "none",
                        transition:
                          "width 320ms var(--ease-spring), height 320ms var(--ease-spring), background-color 180ms var(--ease-out), box-shadow 280ms var(--ease-out)",
                      }}
                    />
                    <span
                      className="mono text-center text-[9px] leading-tight"
                      style={{ color: on ? "var(--text)" : "var(--muted)" }}
                    >
                      {r.label}
                    </span>
                  </button>

                  {/* The act of this altitude. A quiet ◇ marks "a ritual lives
                      here"; hover slides out a named card that floats clear of
                      the rail (the spine sits above the floor, z-40). */}
                  {rf && (
                    <>
                      <span
                        aria-hidden
                        className="fast pointer-events-none absolute z-20 -translate-y-1/2 text-[10px] leading-none group-hover:opacity-0"
                        style={{ left: "calc(50% + 9px)", top: 6, color: on ? "var(--accent)" : "var(--muted)" }}
                      >
                        ◇
                      </span>
                      <button
                        onClick={() => openFlow(rf.flow)}
                        title={`${rf.label} — ${rf.sub}`}
                        className="elev-3 fast invisible absolute z-40 flex -translate-y-1/2 translate-x-1.5 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface py-1.5 pl-2.5 pr-3 text-left opacity-0 group-hover:visible group-hover:translate-x-0 group-hover:opacity-100"
                        style={{ left: 64, top: 6 }}
                      >
                        <span className="text-[12px]" style={{ color: "var(--accent)" }}>◇</span>
                        <span>
                          <span className="block text-[11px] font-medium leading-tight text-ink">{rf.label}</span>
                          <span className="mono block text-[8px] leading-tight text-muted">{rf.sub}</span>
                        </span>
                        <span className="text-[11px] text-muted">▸</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mono pb-3 text-center text-[9px] leading-tight text-muted">⌘1–5<br />⌘↓↑</div>
    </div>
  );
}
