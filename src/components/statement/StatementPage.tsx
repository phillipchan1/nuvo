import type { CSSProperties, ReactNode } from "react";
import { NuvoMark } from "../kit/Mark";

// StatementPage — the small pages that frame the app (D-192): sign-in, first
// run, the welcome, the paywall. They are where someone meets Nuvo or comes
// back to it, so they say the ambition out loud instead of being a card on a
// grey field.
//
//   STAGE (left; the top band on a phone) — always ink, whatever the theme:
//   the mark, one statement set huge and ending on the ember full stop (the
//   mark's own dot — `Stop`), and a small live week whose blocks land one by
//   one while the now-line finds its place. It plays once, on arrival.
//   DOOR (right; a sheet on a phone) — the theme's panel, holding the one
//   thing to do here: the sign-in doors, the domain list, the plans.
//
// Motion is transform/opacity only and stops for reduced motion.

/** The ember full stop that ends every statement — the mark's dot. */
export function Stop() {
  return (
    <span className="st-stop" aria-hidden="true">
      .
    </span>
  );
}

export function StatementPage({
  hero,
  kicker,
  stage,
  children,
  footer,
  wide = false,
  labelledBy,
}: {
  /** the statement, without its final full stop (Stop adds it) */
  hero: ReactNode;
  /** one small line above the statement */
  kicker?: ReactNode;
  /** the stage's visual; defaults to the landing week */
  stage?: ReactNode;
  /** the door's content */
  children: ReactNode;
  /** small print under the door */
  footer?: ReactNode;
  /** a door that holds a list or plans rather than a few buttons */
  wide?: boolean;
  /** id of the element that names the page, when it isn't the statement */
  labelledBy?: string;
}) {
  return (
    <div className="st-page" aria-labelledby={labelledBy}>
      <section className="st-stage" data-theme="dark" data-tauri-drag-region="deep">
        <div className="st-brand">
          <NuvoMark size={28} />
          <span>Nuvo</span>
        </div>
        <div className="st-statement">
          {kicker && <p className="st-kicker">{kicker}</p>}
          <h1 className="st-hero">
            {hero}
            <Stop />
          </h1>
        </div>
        <div className="st-visual" aria-hidden="true">
          {stage ?? <WeekStage />}
        </div>
      </section>
      <main className="st-door" data-wide={wide || undefined}>
        <div className="st-door-inner">{children}</div>
        {footer && <footer className="st-door-foot">{footer}</footer>}
      </main>
    </div>
  );
}

/** The door's own title — "Sign in." — with the same full stop, smaller. */
export function DoorTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 className="st-title" id={id}>
      {children}
      <Stop />
    </h2>
  );
}

// ── The landing week ─────────────────────────────────────────────────────────
// A Monday-to-Friday the way the Schedule draws it: each block lands in turn,
// then the now-line glides out to Wednesday afternoon. Domain hues are the dark
// theme's (the stage is always ink). Purely illustrative — no data.

type Block = { d: number; at: number; len: number; label: string; hue: string; kind?: "task" | "event" };

const HUE = {
  work: "var(--dk-work)",
  health: "var(--dk-health)",
  family: "var(--dk-family)",
  writing: "var(--dk-writing)",
};

const BLOCKS: Block[] = [
  { d: 0, at: 0, len: 1, label: "Run 5k", hue: HUE.health, kind: "task" },
  { d: 0, at: 1.5, len: 2, label: "Pricing page", hue: HUE.work, kind: "task" },
  { d: 0, at: 5, len: 1, label: "Lunch · Sam", hue: HUE.family },
  { d: 1, at: 0.5, len: 2.5, label: "Chapter 4", hue: HUE.writing, kind: "task" },
  { d: 1, at: 4, len: 1, label: "Investor update", hue: HUE.work },
  { d: 2, at: 0, len: 1, label: "Standup", hue: HUE.work },
  { d: 2, at: 1.5, len: 2, label: "Onboarding v2", hue: HUE.work, kind: "task" },
  { d: 2, at: 5.5, len: 1, label: "Pick up Maya", hue: HUE.family },
  { d: 3, at: 0, len: 1.5, label: "Long run", hue: HUE.health, kind: "task" },
  { d: 3, at: 2.5, len: 2, label: "Design review", hue: HUE.work },
  { d: 4, at: 1, len: 2, label: "Ship it", hue: HUE.work, kind: "task" },
  { d: 4, at: 4.5, len: 1.5, label: "Plan the week", hue: HUE.writing, kind: "task" },
];

const DAYS = [
  ["Mon", "16"],
  ["Tue", "17"],
  ["Wed", "18"],
  ["Thu", "19"],
  ["Fri", "20"],
];
const SPAN = 7; // hours drawn, 9am–4pm
const NOW = { d: 2, at: 4.6 };

export function WeekStage() {
  return (
    <div className="ws">
      <div className="ws-days">
        {DAYS.map(([w, n], i) => (
          <div key={w} className="ws-day" data-today={i === NOW.d || undefined}>
            <span>{w}</span>
            <b>{n}</b>
          </div>
        ))}
      </div>
      <div className="ws-grid">
        {DAYS.map((_, d) => (
          <div key={d} className="ws-col">
            {BLOCKS.filter((b) => b.d === d).map((b) => {
              const i = BLOCKS.indexOf(b);
              const style = {
                top: `${(b.at / SPAN) * 100}%`,
                height: `calc(${(b.len / SPAN) * 100}% - 3px)`,
                "--h": b.hue,
                "--i": i,
              } as CSSProperties;
              return (
                <div key={i} className="ws-block" data-kind={b.kind ?? "event"} style={style}>
                  {b.label}
                </div>
              );
            })}
          </div>
        ))}
        <div className="ws-now" style={{ top: `${(NOW.at / SPAN) * 100}%`, left: `${(NOW.d / DAYS.length) * 100}%` }} />
      </div>
    </div>
  );
}
