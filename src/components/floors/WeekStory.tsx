// WeekStory — the week as a paced recap that NARRATES its own emblem. The graphic
// is symbolic (sun = dominant initiative, rings = domains, satellites = priorities, dots
// = done-work); a static, silent version means nothing to the reader. So here the
// emblem is *persistent* and *accretes a layer per scene*, and each scene names
// the part it just revealed — the story IS the legend. You also watch it get
// drawn from your real numbers, which is what makes "different every week" land.
//
// All copy is derived from the real WeekReport (deterministic).

import { useMemo, useState, type ReactNode } from "react";
import { fmtHours } from "../../lib/dates";
import { fmtMins } from "../../lib/now";
import type { WeekReport } from "../../lib/composeWeek";
import WeekEmblem, { type EmblemReveal } from "./WeekEmblem";

interface EmblemScene {
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

  const scenes: EmblemScene[] = [];

  // 0 — Cover: just the sun + faint scaffold. The seed of the mark.
  scenes.push({
    reveal: { ringArcs: false, satellites: false, ambient: false },
    caption: (
      <>
        <div className="section-label wk-in mb-2" style={wk(0.05)}>{sealed ? "The Review" : "This week"}</div>
        <h1 className="masthead wk-in text-display leading-tight text-ink" style={wk(0.2)}>{weekLabel}</h1>
        <p className="wk-in mt-3 text-meta text-muted" style={wk(0.5)}>Your week, drawn as one mark — watch it fill in.</p>
      </>
    ),
  });

  // 1 — Priorities: the satellites appear.
  scenes.push({
    reveal: { ringArcs: false, ambient: false },
    caption:
      total > 0 ? (
        <>
          <div className="section-label wk-in mb-3">The week's projects</div>
          <div className="masthead wk-in text-ink" style={{ fontSize: "4.5rem", lineHeight: 1, ...wk(0.1) }}>
            {landed} <span className="text-muted">of</span> {total}
          </div>
          <div className="wk-in mt-2 text-lead text-muted" style={wk(0.3)}>{sealed ? "landed" : "landed so far"}</div>
          <p className="wk-in mx-auto mt-5 max-w-sm text-meta text-muted" style={wk(0.6)}>
            Each orbiting light is a project on the week — filled if it landed, a ring if it's still open.
          </p>
        </>
      ) : (
        <>
          <div className="section-label wk-in mb-3">The week's projects</div>
          <p className="serif wk-in text-lead text-ink" style={wk(0.1)}>Nothing was on this week.</p>
        </>
      ),
  });

  // 2 — Hours: the rings sweep in, the dominant domain brightest.
  scenes.push({
    reveal: { ambient: false, focusColor: dominant?.color ?? null },
    caption: (
      <>
        <div className="section-label wk-in mb-3">Where your hours went</div>
        <p className="serif wk-in text-lead leading-relaxed text-ink" style={wk(0.1)}>
          {dominant ? <>Most of your hours went to <span style={{ color: dominant.color }}>{dominant.name}</span>.</> : "A quiet week on the clock."}
        </p>
        {weave.length > 0 && (
          <div className="wk-in mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5" style={wk(0.35)}>
            {weave.map((d) => (
              <span key={d.id} className="flex items-center gap-1.5 text-meta text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                {d.name} <span className="mono">{fmtHours(d.hours * 60)}h</span>
              </span>
            ))}
          </div>
        )}
        <p className="wk-in mx-auto mt-5 max-w-sm text-meta text-muted" style={wk(0.65)}>
          Each ring is a domain; the longer its arc, the more hours it held. The full week has a day-by-day breakdown at the end.
        </p>
      </>
    ),
  });

  // 3 — Done-work: the ambient dots scatter in.
  scenes.push({
    reveal: {},
    caption: (
      <>
        <div className="section-label wk-in mb-3">What moved a domain</div>
        {highlights.length > 0 ? (
          <div className="flex flex-col gap-3">
            {highlights.map((h, idx) => (
              <div key={idx} className="wk-in flex flex-col items-center gap-0.5" style={wk(0.1 + idx * 0.2)}>
                <span className="text-body text-ink">{h.title}</span>
                <span className="text-meta" style={{ color: h.domainColor }}>
                  {h.domainName}{h.mins > 0 ? ` · ${fmtMins(h.mins)}` : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="serif wk-in text-lead text-ink" style={wk(0.1)}>{dots} {dots === 1 ? "task" : "tasks"} finished.</p>
        )}
        <p className="wk-in mx-auto mt-5 max-w-sm text-meta text-muted" style={wk(0.7)}>
          And each faint dot is a task you finished.
        </p>
      </>
    ),
  });

  // 4 — The seal.
  scenes.push({
    reveal: {},
    caption: (
      <>
        <div className="section-label wk-in mb-3" style={wk(0.05)}>{sealed ? "Sealed" : "So far"}</div>
        <p className="serif wk-in text-lead leading-relaxed text-ink" style={wk(0.15)}>
          {sealed ? "That's the week — sealed." : "That's the week so far. Friday will seal it."}
        </p>
      </>
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
  const carry = report.carryForward.length;

  return (
    <div
      className="atmosphere fixed inset-0 z-50 overflow-hidden"
      style={{
        background: "color-mix(in srgb, var(--bg) 96%, transparent)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}
    >
      {/* tap zones — left third back, right two-thirds forward (Wrapped pattern) */}
      <button className="absolute inset-y-0 left-0 z-0 w-1/3 cursor-default" onClick={() => go(-1)} aria-label="Previous" />
      <button className="absolute inset-y-0 right-0 z-0 w-2/3 cursor-default" onClick={() => go(1)} aria-label="Next" />

      {/* progress dots */}
      <div className="pointer-events-auto absolute left-1/2 top-6 z-20 flex -translate-x-1/2 gap-1.5">
        {scenes.map((_, idx) => (
          <button
            key={idx}
            onClick={() => setI(idx)}
            className="fast h-1 rounded-full"
            style={{ width: idx === i ? 24 : 8, background: idx <= i ? "var(--accent)" : "var(--line-strong)" }}
            aria-label={`Scene ${idx + 1}`}
          />
        ))}
      </div>

      {/* close */}
      <button onClick={onClose} className="pointer-events-auto absolute right-6 top-5 z-20 flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {/* The persistent emblem (accretes layers per scene) + the per-scene caption.
          The emblem sits OUTSIDE the keyed caption so it isn't remounted each scene —
          only the newly-revealed layer fades in. */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center px-8">
        <div className="flex h-[280px] items-center justify-center">
          <WeekEmblem spec={report.emblem} state={state} size={240} reveal={scenes[i].reveal} animate />
        </div>

        <div key={i} className="flex min-h-[210px] w-full max-w-lg flex-col items-center text-center">
          {scenes[i].caption}

          {last && (
            <div className="wk-in pointer-events-auto mt-8 flex flex-col items-center gap-4" style={wk(0.9)}>
              {carry > 0 && (
                <p className="serif max-w-md text-body leading-relaxed text-ink">
                  {/* A statement, not a promised act: carrying is a span write on
                      the row now, not a button that seeds next week's rocks. */}
                  {carry} still open — {carry === 1 ? "it'll" : "they'll"} be waiting on Monday.
                </p>
              )}
              <button onClick={onSeeDetail} className="fast rounded-full bg-accent px-6 py-2.5 text-label font-medium text-on-accent hover:opacity-90">
                See the full week →
              </button>
            </div>
          )}
        </div>
      </div>

      {!last && (
        <div className="pointer-events-none absolute bottom-7 left-1/2 z-10 -translate-x-1/2 text-meta text-muted/70">tap to continue</div>
      )}
    </div>
  );
}
