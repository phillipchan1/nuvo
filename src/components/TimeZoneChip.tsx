import { memo } from "react";
import { useHomeTimezone } from "../hooks/useHomeTimezone";
import { Icon } from "./Icon";
import { Chip } from "./kit";
import { detectDeviceTz, tzCity, tzStatus } from "../lib/timezone";

// The schedule's clock label. Always compact in the toolbar — glyph (at home) or
// the kit's accent chip with the device abbr (while traveling). The full story
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
export default memo(function TimeZoneChip({
  now,
  className = "",
  hideAtHome = false,
}: {
  now: Date;
  className?: string;
  /** Render NOTHING while the device clock is the home clock. For toolbars that
   *  are already over-subscribed — the phone's calendar header carried this
   *  glyph on four of five lenses, where it said only "you are where you live".
   *  It reappears the moment it has something to report (you're travelling),
   *  which is the only moment it was ever load-bearing. */
  hideAtHome?: boolean;
}) {
  const [homeTz] = useHomeTimezone();
  const deviceTz = detectDeviceTz();
  const s = tzStatus(homeTz, deviceTz, now);

  if (!s.traveling && hideAtHome) return null;

  if (!s.traveling) {
    // At home: glyph only — the abbr lives in the tooltip so the toolbar stays quiet.
    return (
      <span
        className={`inline-flex shrink-0 items-center ${className}`}
        style={{ color: "var(--muted)" }}
        title={`Times shown in ${tzCity(deviceTz)} time (${s.deviceAbbr})`}
      >
        <GlobeGlyph size={14} />
      </span>
    );
  }

  // Traveling: the kit's accent chip (abbr only). Long "Nh ahead of home" copy
  // used to collide with the view switcher on mid-width Schedule — it's in the title.
  return (
    <Chip
      tone="accent"
      icon={<GlobeGlyph />}
      className={`shrink-0 tabular-nums ${className}`}
      title={`You're in ${tzCity(deviceTz)} time (${s.deviceAbbr}) — ${s.deltaLabel} of home (${tzCity(homeTz)}, ${s.homeAbbr}). The schedule shows times in ${s.deviceAbbr}. Change home in Settings → Schedule.`}
    >
      {s.deviceAbbr}
    </Chip>
  );
});
