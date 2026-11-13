// COMMIT — the moment Plan the week is committed, on both shells (D-187).
//
// The one ceremony in the planning loop that is actually a moment: the week
// you just shaped stops being a draft. It used to end three different ways —
// the desktop rail printed "12 things → 7 blocks" in serif, the phone a centred
// "The week is set", the old walk its own card with domain bands that grew in —
// three drawings of one act, and only one of them moved. This is the one.
//
// What it draws is the week by WORLD: one band per domain, in its hue, sized by
// the hours committed to it, and under them a single seal line in the accent
// that sweeps across once the bands have landed. The bands are the read (where
// did my week go?), the seal is the commit (it is locked). Nothing counts up,
// nothing bursts, nothing repeats — it plays once, on the act, and then is
// simply the summary you read (P9). Reduced motion and E-ink get the final
// frame.
//
// It computes nothing: callers hand it the bands from `sprintMinsByDomain`.

import type { ReactNode } from "react";

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
  /** one mono line of what was committed — the caller's own counts */
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
    <div className={`flex flex-col ${centred ? "items-center text-center" : "items-start text-left"}`}>
      <div className="section-label !p-0" style={{ color: "var(--accent)" }}>
        {eyebrow}
      </div>
      <h1 className="arrive mt-2 text-display masthead text-ink">{title}</h1>

      {bands.length > 0 && (
        <div className={`mt-4 w-full ${centred ? "max-w-[320px]" : ""}`}>
          {/* the week by world — each band lands, one beat apart */}
          <div className="flex h-2.5 w-full gap-[3px]" role="img" aria-label={bands.map((b) => `${b.label} ${hrs(b.mins)}h`).join(", ")}>
            {bands.map((b, i) => (
              <span
                key={b.key}
                title={`${b.label} · ${hrs(b.mins)}h`}
                className="commit-band block h-full rounded-[3px]"
                style={{
                  width: `${(b.mins / total) * 100}%`,
                  background: b.color,
                  ["--i" as string]: i,
                }}
              />
            ))}
          </div>
          {/* the seal — the commit itself, drawn once the bands are down */}
          <span className="commit-seal mt-1.5 block h-[2px] w-full rounded-full" style={{ background: "var(--landed)" }} aria-hidden />
          <div className={`mono mt-2 flex flex-wrap gap-x-3 gap-y-1 text-micro text-muted ${centred ? "justify-center" : ""}`}>
            {bands.map((b) => (
              <span key={b.key} className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.color }} aria-hidden />
                {b.label} {hrs(b.mins)}h
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mono mt-3 text-label text-muted">{facts}</p>
      {goal?.trim() && <p className="mt-2 text-body text-ink">“{goal.trim()}”</p>}
      {action && <div className={`mt-5 w-full ${centred ? "max-w-[320px]" : ""}`}>{action}</div>}
    </div>
  );
}
