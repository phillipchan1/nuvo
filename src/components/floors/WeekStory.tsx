// WeekStory — the week as a paced recap that NARRATES its own emblem. The graphic
// is symbolic (sun = dominant initiative, rings = domains, satellites = priorities,
// dots = done-work); a static, silent version means nothing to the reader. So
// here the emblem is *persistent* and *accretes a layer per scene*, and each
// scene names the part it just revealed — the story IS the legend. You also
// watch it get drawn from your real numbers.
//
// On the Flow layout (D-190): ✕ and a stepper of the scenes in the bar, one hero
// per scene, the legend as its fact line, Back / Next (↵) in the footer. Tapping
// the left third of the stage goes back, the rest goes on — the story pattern a
// thumb already knows. All copy is derived from the real WeekReport.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fmtHours } from "../../lib/dates";
import { fmtMins } from "../../lib/now";
import type { WeekReport } from "../../lib/composeWeek";
import WeekEmblem, { type EmblemReveal } from "./WeekEmblem";
import { Button, Dot } from "../kit";
import { FlowFoot, FlowFrame, FlowHead, FlowStepper, keyIsTaken } from "../rituals/FlowShell";

interface EmblemScene {
  id: string;
  label: string;
  reveal: EmblemReveal;
  caption: ReactNode;
}

const wk = (delay: number): React.CSSProperties => ({ animationDelay: `${delay}s` });

function buildScenes(report: WeekReport, state: "forming" | "sealed", weekLabel: string): EmblemScene[] {
  const sealed = state === "sealed";
  const total = report.priorityTotal;
  const landed = report.landedCount;
  const dominant = report.domains.find((d) => d.hours > 0) ?? null;
  const weave = report.domains.filter((d) => d.hours > 0).slice(0, 4);
  const dots = report.emblem.ambient;
  const highlights = report.highlights.slice(0, 3);
  const carry = report.carryForward.length;

  const scenes: EmblemScene[] = [];

  // 0 — Cover: just the sun + faint scaffold. The seed of the mark.
  scenes.push({
    id: "cover",
    label: sealed ? "Review" : "Week",
    reveal: { ringArcs: false, satellites: false, ambient: false },
    caption: (
      <FlowHead align="center" kicker={<span className="wk-in" style={wk(0.05)}>{sealed ? "The Review" : "This week"}</span>} hero={<span className="arrive block">{weekLabel}</span>} fact={<span className="wk-in block" style={wk(0.45)}>Your week, drawn as one mark.</span>} />
    ),
  });

  // 1 — Priorities: the satellites appear.
  scenes.push({
    id: "projects",
    label: "Projects",
    reveal: { ringArcs: false, ambient: false },
    caption:
      total > 0 ? (
        <FlowHead
          align="center"
          kicker="The week's projects"
          hero={
            <span className="arrive block f-num">
              {landed} of {total} {sealed ? "landed." : "landed so far."}
            </span>
          }
          fact={<span className="wk-in block" style={wk(0.45)}>Each orbiting light is a project — filled once it landed.</span>}
        />
      ) : (
        <FlowHead align="center" kicker="The week's projects" hero={<span className="arrive block">Nothing was on this week.</span>} />
      ),
  });

  // 2 — Hours: the rings sweep in, the dominant domain brightest.
  scenes.push({
    id: "hours",
    label: "Hours",
    reveal: { ambient: false, focusColor: dominant?.color ?? null },
    caption: (
      <FlowHead
        align="center"
        kicker="Where your hours went"
        hero={
          <span className="arrive block">
            {dominant ? (
              <>
                Most went to <span style={{ color: dominant.color }}>{dominant.name}</span>.
              </>
            ) : (
              "A quiet week on the clock."
            )}
          </span>
        }
        fact={<span className="wk-in block" style={wk(0.55)}>Each ring is a domain; the longer its arc, the more hours it held.</span>}
      >
        {weave.length > 0 && (
          <div className="f-meter-legend wk-in mt-2 justify-center" style={wk(0.3)}>
            {weave.map((d) => (
              <span key={d.id}>
                <Dot color={d.color} size="sm" />
                {d.name} <span className="text-[var(--ink-2)]">{fmtHours(d.hours * 60)}h</span>
              </span>
            ))}
          </div>
        )}
      </FlowHead>
    ),
  });

  // 3 — Done-work: the ambient dots scatter in.
  scenes.push({
    id: "done",
    label: "Done",
    reveal: {},
    caption: (
      <FlowHead
        align="center"
        kicker="What moved a domain"
        hero={
          <span className="arrive block f-num">
            {dots} {dots === 1 ? "task" : "tasks"} finished.
          </span>
        }
        fact={<span className="wk-in block" style={wk(0.6)}>Each faint dot is a task you finished.</span>}
      >
        {highlights.length > 0 && (
          <div className="mx-auto mt-3 grid w-full max-w-sm text-left">
            {highlights.map((h, idx) => (
              <div key={idx} className="wk-in flex min-h-[34px] items-center gap-2.5 px-1" style={{ ...wk(0.2 + idx * 0.15), boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
                <Dot color={h.domainColor} />
                <span className="min-w-0 flex-1 truncate text-body">{h.title}</span>
                <span className="f-num shrink-0 text-caption text-[var(--faint)]">
                  {h.domainName}
                  {h.mins > 0 ? ` · ${fmtMins(h.mins)}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </FlowHead>
    ),
  });

  // 4 — The seal.
  scenes.push({
    id: "seal",
    label: sealed ? "Sealed" : "So far",
    reveal: {},
    caption: (
      <FlowHead
        align="center"
        kicker={sealed ? "Sealed" : "So far"}
        hero={<span className="arrive block">{sealed ? "That's the week — sealed." : "That's the week so far."}</span>}
        fact={
          <span className="wk-in block" style={wk(0.4)}>
            {/* A statement, not a promised act: carrying is a span write on the
                row now, not a button that seeds next week's rocks. */}
            {sealed ? "" : "Friday will seal it. "}
            {carry > 0 ? `${carry} still open — ${carry === 1 ? "it'll" : "they'll"} be waiting on Monday.` : ""}
          </span>
        }
      />
    ),
  });

  return scenes;
}

export interface WeekStoryProps {
  report: WeekReport;
  state: "forming" | "sealed";
  weekLabel: string;
  onClose: () => void;
  onSeeDetail: () => void;
}

export default function WeekStory({ report, state, weekLabel, onClose, onSeeDetail }: WeekStoryProps) {
  const scenes = useMemo(() => buildScenes(report, state, weekLabel), [report, state, weekLabel]);
  const [i, setI] = useState(0);
  const last = i >= scenes.length - 1;
  const go = (d: number) => setI((v) => Math.max(0, Math.min(scenes.length - 1, v + d)));
  const forward = () => (last ? onSeeDetail() : go(1));

  // ← → walk the scenes, ↵ takes the primary act (Esc is the host's: it closes)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Enter" && !keyIsTaken(e)) {
        e.preventDefault();
        forward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <FlowFrame
      label={`${state === "sealed" ? "The Review" : "This week"} — ${weekLabel}`}
      onClose={onClose}
      center={<FlowStepper steps={scenes.map((s) => ({ id: s.id, label: s.label }))} current={i} onStep={setI} label="Scenes" />}
      footer={
        <FlowFoot summary={weekLabel}>
          <Button kind="ghost" size="md" onClick={() => go(-1)} disabled={i === 0}>
            Back
          </Button>
          <Button kind="primary" size="md" shortcut="↵" onClick={forward}>
            {last ? "See the full week" : "Next"}
          </Button>
        </FlowFoot>
      }
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* tap zones — left third back, right two-thirds forward (story pattern) */}
        <button type="button" className="absolute inset-y-0 left-0 z-0 w-1/3" onClick={() => go(-1)} aria-label="Previous" tabIndex={-1} />
        <button type="button" className="absolute inset-y-0 right-0 z-0 w-2/3" onClick={() => go(1)} aria-label="Next" tabIndex={-1} />

        {/* The persistent emblem (accretes layers per scene) + the per-scene
            caption. The emblem sits OUTSIDE the keyed caption so it isn't
            remounted each scene — only the newly-revealed layer fades in. */}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-6">
          <div className="flex h-[240px] shrink-0 items-center justify-center">
            <WeekEmblem spec={report.emblem} state={state} size={220} reveal={scenes[i].reveal} animate />
          </div>
          <div key={i} className="flex min-h-[180px] w-full max-w-lg flex-col items-center">
            {scenes[i].caption}
          </div>
        </div>
      </div>
    </FlowFrame>
  );
}
