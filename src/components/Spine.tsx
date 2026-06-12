import { useState } from "react";
import { LADDER, type Rung } from "./AppShell";

// Top-to-bottom: Now (immediate) → Domain (widest). ⌘1 at top, ⌘5 at bottom.
const RUNGS: { id: Rung; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "day", label: "Day · Week" },
  { id: "project", label: "Project" },
  { id: "initiative", label: "Initiative" },
  { id: "domain", label: "Domain" },
];

export type FlowName = "sunday" | "summit" | "blueprint";

const FLOWS: { id: FlowName; label: string; sub: string }[] = [
  { id: "sunday", label: "Sunday", sub: "compose the week" },
  { id: "summit", label: "Summit", sub: "decide the quarter" },
  { id: "blueprint", label: "Blueprint", sub: "shape a new bet" },
];

export default function Spine({
  rung,
  setRung,
  openFlow,
}: {
  rung: Rung;
  setRung: (r: Rung) => void;
  openFlow: (f: FlowName) => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="relative flex w-[74px] shrink-0 flex-col items-center border-r border-line bg-surface">
      {/* drag region that also clears the macOS traffic lights */}
      <div data-tauri-drag-region className="h-9 w-full shrink-0" />

      {/* Flows — boundaries in, one output out. Floors are for looking;
          flows are for deciding. */}
      <button
        onClick={() => setMenu((m) => !m)}
        title="Flows — guided planning with one clear output"
        className="fast group mb-1 flex flex-col items-center gap-1"
      >
        <span className="fast flex h-7 w-7 items-center justify-center rounded-full border border-line text-[12px] text-muted group-hover:scale-105 group-hover:border-accent group-hover:text-accent group-hover:shadow-[0_0_0_4px_var(--accent-soft)]">
          ◉
        </span>
        <span className="mono text-[8px] text-muted group-hover:text-ink">flows</span>
      </button>

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
          <div className="moment elev-3 absolute left-[64px] top-12 z-50 w-[190px] rounded-lg border border-line bg-surface p-1.5">
            {FLOWS.map((f) => (
              <button
                key={f.id}
                onClick={() => { setMenu(false); openFlow(f.id); }}
                className="fast block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-accent-soft"
              >
                <div className="text-[12px] font-medium">{f.label}</div>
                <div className="mono text-[9px] text-muted">{f.sub}</div>
              </button>
            ))}
          </div>
        </>
      )}

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
          );
        })}
      </div>

      <div className="mono pb-3 text-center text-[9px] leading-tight text-muted">⌘1–5<br />⌘↓↑</div>
    </div>
  );
}
