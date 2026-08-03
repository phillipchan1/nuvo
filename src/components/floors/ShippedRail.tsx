// The Shipped rail — the celebratory layer beside the wall of cards. The cards
// carry the "this is a project" language (congruent with the other Build views);
// this rail carries the feeling. Measured in the language of Gain (Dan Sullivan):
// backward from the period's start line — how far you've come, not what's left.
//
// Altitude: projects celebrate by the QUARTER, initiatives by the calendar YEAR
// (one level out from what the wall groups by). A ‹ › stepper walks back through
// past periods — the constellation encodes WINS PER DOMAIN, so any past period
// redraws faithfully from `targetDate` alone (no stored snapshot).
//
//   · the count        — finish lines crossed this period, as a quiet stat
//   · the constellation — the reused emblem, rings ∝ wins per domain, ambient
//     light for shipped volume (a keepsake that grows)
//   · where the hours went — the real ~90-day arc per domain (current only, since
//     that's how deep the data goes) + a vow line
//   · Nuvo's read       — one warm synthesis sentence

import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { readPeriodGain, type PeriodGain, type ShippedRung } from "../../lib/shipped";
import type { VerticalData } from "../../lib/vertical";
import WeekEmblem from "./WeekEmblem";

export default function ShippedRail({
  data,
  rung,
  now,
}: {
  data: VerticalData;
  rung: ShippedRung;
  now: Date;
}) {
  const [offset, setOffset] = useState(0);
  const gain: PeriodGain = useMemo(() => readPeriodGain(data, rung, now, offset), [data, rung, now, offset]);
  const maxBar = Math.max(1, ...(gain.hours ?? []).map((h) => h.hours));

  return (
    <aside className="flex flex-col gap-4">
      {/* the Gain — how far you've come, with a stepper back through periods */}
      <div className="glass-card rounded-2xl px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <StepButton dir="back" disabled={!gain.canGoBack} onClick={() => setOffset((o) => o + 1)} />
          <span className="section-label">{gain.label}</span>
          <StepButton dir="fwd" disabled={!gain.canGoForward} onClick={() => setOffset((o) => Math.max(0, o - 1))} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="masthead text-[2.5rem] leading-none text-ink">{gain.count}</span>
          <span className="text-body text-muted">finish line{gain.count === 1 ? "" : "s"}</span>
        </div>
        <p className="mt-1 text-caption text-muted">
          {gain.isCurrent ? "so far — how far you've come, not what's left." : `landed in ${gain.label}.`}
        </p>
        {(gain.domainsInMotion > 0 || gain.loose.length > 0) && (
          <div className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2.5 text-micro text-muted">
            <span>{gain.domainsInMotion} domain{gain.domainsInMotion === 1 ? "" : "s"} moved</span>
            {gain.loose.length > 0 && (
              <>
                <span>·</span>
                <span style={{ color: "var(--accent)" }}>{gain.loose.length} loose</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* the constellation — the period as a growing celestial mark (wins per domain) */}
      {gain.contribution.length > 0 && (
        <div className="glass-card rounded-2xl px-4 pb-3 pt-4">
          <div className="section-label mb-1">Where it landed</div>
          <div className="flex items-center justify-center py-1">
            <WeekEmblem spec={gain.emblem} state="sealed" size={196} />
          </div>
        </div>
      )}

      {/* where the hours went — the real ~90-day arc (current period only) */}
      {gain.hours && gain.hours.length > 0 && (
        <div className="glass-card rounded-2xl px-4 py-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="section-label">Where the hours went</span>
            <span className="text-micro text-muted">last ~90 days</span>
          </div>
          <div className="flex flex-col gap-3">
            {gain.hours.map((h) => (
              <div key={h.domain.id}>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: h.domain.color }} />
                  <span className="flex-1 truncate text-caption font-medium text-ink">{h.domain.name}</span>
                  <span className="mono text-micro text-muted">{h.hours}h</span>
                </div>
                <div className="mt-1 h-[5px] overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.round((h.hours / maxBar) * 100)}%`, background: h.domain.color }}
                  />
                </div>
                <div className="mt-1 text-micro italic text-muted">{h.vow}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Nuvo's read — one warm synthesis sentence */}
      <div className="glass-card rounded-2xl px-4 py-4">
        <div className="section-label mb-2">Nuvo's read</div>
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 h-4 w-4 shrink-0 rounded-full"
            style={{ background: "radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--accent) 70%, white), var(--accent))" }}
          />
          <p className="text-caption leading-relaxed text-ink">{gain.nuvoRead}</p>
        </div>
      </div>
    </aside>
  );
}

function StepButton({ dir, disabled, onClick }: { dir: "back" | "fwd"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "back" ? "Earlier period" : "Later period"}
      className="tap flex h-6 w-6 items-center justify-center rounded-full border border-line text-muted transition disabled:opacity-30 enabled:hover:text-ink"
    >
      <Icon name="chevron-left" size={7} style={{ transform: dir === "fwd" ? "scaleX(-1)" : undefined }} />
    </button>
  );
}
