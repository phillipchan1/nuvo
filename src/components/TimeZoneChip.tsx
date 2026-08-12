import { memo } from "react";
import { useHomeTimezone } from "../hooks/useHomeTimezone";
import { Icon } from "./Icon";
import { detectDeviceTz, tzCity, tzStatus } from "../lib/timezone";

// The schedule's clock label. Always compact in the toolbar — glyph (at home) or
// a short accent pill with the device abbr (while traveling). The full story
// (city, delta from home) lives in the tooltip so mid-width Schedule never
// collides. Informational (the device zone is set by the OS, not here); home
// is configured in Settings.

function GlobeGlyph({ size = 12 }: { size?: number }) {
  return (
    <Icon name="globe" size={size} />
  );
}

// Memoized: it rides toolbars that re-render on every data change, and its
// tzStatus derive runs Intl formatters — real work for a chip whose answer
// changes at most when the 30s clock prop ticks.
export default memo(function TimeZoneChip({ now, className = "" }: { now: Date; className?: string }) {
  const [homeTz] = useHomeTimezone();
  const deviceTz = detectDeviceTz();
  const s = tzStatus(homeTz, deviceTz, now);

  if (!s.traveling) {
    // At home: glyph only — the abbr lives in the tooltip so the toolbar stays quiet.
    return (
      <span
        className={`inline-flex shrink-0 items-center text-muted ${className}`}
        title={`Times shown in ${tzCity(deviceTz)} time (${s.deviceAbbr})`}
      >
        <GlobeGlyph size={13} />
      </span>
    );
  }

  // Traveling: short accent pill (abbr only). Long "Nh ahead of home" copy used to
  // collide with Plan + the view switcher on mid-width Schedule — keep that in title.
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-meta font-medium text-accent ${className}`}
      title={`You're in ${tzCity(deviceTz)} time (${s.deviceAbbr}) — ${s.deltaLabel} of home (${tzCity(homeTz)}, ${s.homeAbbr}). The schedule shows times in ${s.deviceAbbr}. Change home in Settings → Schedule.`}
    >
      <GlobeGlyph />
      <span className="mono leading-none">{s.deviceAbbr}</span>
    </span>
  );
});
