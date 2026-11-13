// The Shipped rail — the period's Gain beside the wall (D-190). The wall carries
// the "this is a project" cards; the rail carries how far you've come, measured
// the Gain way (Dan Sullivan): backward from the period's start line — not
// what's left. Sections under kit SectionHeaders on hairlines, no glass.
//
// Altitude: projects count by the QUARTER, initiatives by the calendar YEAR
// (one level out from what the wall groups by). A ‹ › stepper walks back through
// past periods — the constellation encodes WINS PER DOMAIN, so any past period
// redraws exactly from its stored ship dates alone (no stored snapshot).
//
//   · the count          — finish lines crossed in the period (20/600: the wall
//                          owns the page's one hero)
//   · where it landed    — the reused emblem, rings ∝ wins per domain
//   · where the hours went — the real ~90-day arc per domain (current only, since
//                          that's how deep the data goes)
//   · Nuvo's read        — one synthesis sentence

import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { readPeriodGain, type PeriodGain, type ShippedRung } from "../../lib/shipped";
import type { VerticalData } from "../../lib/vertical";
import WeekEmblem from "./WeekEmblem";
import { Dot, IconButton, SectionHeader } from "../kit";

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
    <aside className="fl-rail" aria-label="The Gain">
      {/* the Gain — how far you've come, with a stepper back through periods */}
      <section className="fl-sec">
        <SectionHeader
          title={gain.label}
          actions={
            <span className="flex items-center gap-0.5">
              <IconButton
                size="xs"
                label="Earlier period"
                icon={<Icon name="chevron-left" size={14} />}
                disabled={!gain.canGoBack}
                onClick={() => setOffset((o) => o + 1)}
              />
              <IconButton
                size="xs"
                label="Later period"
                icon={<Icon name="chevron-right" size={14} />}
                disabled={!gain.canGoForward}
                onClick={() => setOffset((o) => Math.max(0, o - 1))}
              />
            </span>
          }
        />
        <div className="fl-gain">
          <b>{gain.count}</b>
          <span>finish line{gain.count === 1 ? "" : "s"}</span>
        </div>
        {(gain.domainsInMotion > 0 || gain.loose.length > 0) && (
          <p className="fl-note">
            {gain.domainsInMotion} domain{gain.domainsInMotion === 1 ? "" : "s"} moved
            {gain.loose.length > 0 && <> · {gain.loose.length} without a domain</>}
          </p>
        )}
      </section>

      {/* the constellation — the period as a growing mark (wins per domain) */}
      {gain.contribution.length > 0 && (
        <section className="fl-sec">
          <SectionHeader title="Where it landed" />
          <div className="flex items-center justify-center py-2">
            <WeekEmblem spec={gain.emblem} state="sealed" size={176} />
          </div>
        </section>
      )}

      {/* where the hours went — the real ~90-day arc (current period only) */}
      {gain.hours && gain.hours.length > 0 && (
        <section className="fl-sec">
          <SectionHeader title="Where the hours went" count="90 days" />
          <div className="fl-rows">
            {gain.hours.map((h) => (
              <div key={h.domain.id} className="fl-hrow" style={{ display: "grid", gap: 6 }}>
                <div className="flex items-center gap-2">
                  <Dot color={h.domain.color} />
                  <span className="min-w-0 flex-1 truncate font-medium">{h.domain.name}</span>
                  <span className="fl-meta-fact">{h.hours}h</span>
                </div>
                <div className="fl-bar" style={{ height: "var(--track-h, 3px)" }}>
                  <i style={{ width: `${Math.round((h.hours / maxBar) * 100)}%`, background: h.domain.color }} />
                </div>
                <p className="fl-note">{h.note}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Nuvo's read — one synthesis sentence */}
      <section className="fl-sec">
        <SectionHeader title="Nuvo's read" />
        <div className="flex items-start gap-2.5 pt-1">
          <span className="mt-0.5 inline-flex shrink-0" style={{ color: "var(--accent)" }}>
            <Icon name="sparkles" size={14} />
          </span>
          <p className="m-0 text-body text-ink">{gain.nuvoRead}</p>
        </div>
      </section>
    </aside>
  );
}
