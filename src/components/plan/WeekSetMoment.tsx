// COMMIT — the moment Plan the week is committed, on both shells (D-187).
//
// The one ceremony in the planning loop that is actually a moment: the week
// you just shaped stops being a draft. It used to end three different ways —
// three drawings of one act, and only one of them moved. This is the one, and
// the old desktop walk now ends on it too.
//
// What it draws is the week by WORLD: one band per domain, in its hue, sized by
// the hours committed to it, and under them a single seal line in the accent
// that sweeps across once the bands have landed. The bands are the read (where
// did my week go?), the seal is the commit (it is locked). Nothing counts up,
// nothing bursts, nothing repeats — it plays once, on the act, and then is
// simply the summary you read (P9). Reduced motion gets the final frame.
//
// Instrument (D-189/D-190): a kicker, the one hero, the bands as the Flow
// meter's geometry (8px on --sunk, 2px seams), a tabular fact line, kit Dots.
// The motion classes — `arrive`, `commit-band`, `commit-seal` — are D-187's.
//
// It computes nothing: callers hand it the bands from `sprintMinsByDomain`.

import type { ReactNode } from "react";
import { Dot } from "../kit";

export interface WeekSetBand {
  key: string;
  label: string;
  color: string;
  mins: number;
}

export default function WeekSetMoment({
  eyebrow,
  title = "The week is set.",
  facts,
  goal,
  bands,
  action,
  align = "center",
}: {
  eyebrow: ReactNode;
  title?: string;
  /** one line of what was committed — the caller's own counts */
  facts: ReactNode;
  goal?: string | null;
  bands: WeekSetBand[];
  /** the way out (Done) */
  action?: ReactNode;
  align?: "center" | "start";
}) {
  const total = Math.max(1, bands.reduce((s, b) => s + b.mins, 0));
  const hrs = (m: number) => Math.round((m / 60) * 10) / 10;
  const centred = align === "center";

  return (
    <div className={`flex w-full flex-col ${centred ? "items-center text-center" : "items-start text-left"}`}>
      <div className="f-kicker" style={{ color: "var(--accent-ink)" }}>
        {eyebrow}
      </div>
      <h1 className="arrive mt-1.5 text-display masthead text-[var(--ink)]">{title}</h1>

      {bands.length > 0 && (
        <div className={`mt-5 w-full ${centred ? "max-w-[340px]" : ""}`}>
          {/* the week by world — each band lands, one beat apart */}
          <div
            className="flex h-2 w-full gap-[2px] overflow-hidden rounded-[4px]"
            style={{ background: "var(--sunk)" }}
            role="img"
            aria-label={bands.map((b) => `${b.label} ${hrs(b.mins)}h`).join(", ")}
          >
            {bands.map((b, i) => (
              <span
                key={b.key}
                title={`${b.label} · ${hrs(b.mins)}h`}
                className="commit-band block h-full"
                style={{
                  width: `${(b.mins / total) * 100}%`,
                  background: b.color,
                  ["--i" as string]: i,
                }}
              />
            ))}
          </div>
          {/* the seal — the commit itself, drawn once the bands are down */}
          <span className="commit-seal mt-1.5 block h-[2px] w-full rounded-[1px]" style={{ background: "var(--landed)" }} aria-hidden />
          <div className={`f-meter-legend mt-2.5 ${centred ? "justify-center" : ""}`}>
            {bands.map((b) => (
              <span key={b.key}>
                <Dot color={b.color} size="sm" />
                {b.label} <span className="text-[var(--ink-2)]">{hrs(b.mins)}h</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="f-fact mt-3">{facts}</p>
      {goal?.trim() && <p className="f-line mt-2 font-medium text-[var(--ink)]">“{goal.trim()}”</p>}
      {action && <div className={`mt-6 w-full ${centred ? "max-w-[340px]" : ""}`}>{action}</div>}
    </div>
  );
}
