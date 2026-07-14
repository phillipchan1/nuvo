import { useHomeTimezone } from "../hooks/useHomeTimezone";
import { detectDeviceTz, tzCity, tzStatus } from "../lib/timezone";

// The schedule's clock label. Quiet at home — just names the zone your times are
// in, so the agenda is never ambiguous. While traveling it turns explicit: which
// zone you're in and how far it is from home, because that's the moment the shift
// actually matters. Informational (the device zone is set by the OS, not here);
// the tooltip carries the full story, and home is configured in Settings.

function GlobeGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.4 8h11.2M8 2.4v11.2M4.4 4.4c1.2 1.4 1.9 3.1 1.9 3.6 0 .5-.7 2.2-1.9 3.6M11.6 4.4c-1.2 1.4-1.9 3.1-1.9 3.6 0 .5.7 2.2 1.9 3.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export default function TimeZoneChip({ now, className = "" }: { now: Date; className?: string }) {
  const [homeTz] = useHomeTimezone();
  const deviceTz = detectDeviceTz();
  const s = tzStatus(homeTz, deviceTz, now);

  if (!s.traveling) {
    return (
      <span
        className={`mono inline-flex items-center gap-1 text-meta text-muted ${className}`}
        title={`Times shown in ${tzCity(deviceTz)} time (${s.deviceAbbr})`}
      >
        <GlobeGlyph />
        {s.deviceAbbr}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-meta font-medium text-accent ${className}`}
      title={`You're in ${tzCity(deviceTz)} time (${s.deviceAbbr}) — ${s.deltaLabel} of home (${tzCity(homeTz)}, ${s.homeAbbr}). The schedule shows times in ${s.deviceAbbr}. Change home in Settings → Schedule.`}
    >
      <GlobeGlyph />
      <span className="mono">{s.deviceAbbr}</span>
      <span className="opacity-80">· {s.deltaLabel} of home</span>
    </span>
  );
}
