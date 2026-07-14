// Timezone awareness. Nuvo stores every time as a UTC instant and renders it in
// the browser's *device* zone — where your body is. That's the right default for
// a planner you carry while traveling: a 9am block should read as 9am wherever
// you wake up. The one gap is that it's invisible — land in Chicago and your
// Pacific-planned day silently slides two hours with no sign of why. This module
// makes the device zone legible and flags when it diverges from a stable "home",
// so travel is obvious instead of quietly confusing.

/** The browser/OS timezone — where the user physically is right now. */
export function detectDeviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Short abbreviation for a zone at an instant — "PST", "CDT", "GMT+5:30". */
export function tzAbbrev(tz: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

/** A friendly place name from an IANA id — "America/Chicago" → "Chicago". */
export function tzCity(tz: string): string {
  const seg = tz.split("/").pop() ?? tz;
  return seg.replace(/_/g, " ");
}

/** Offset (minutes east of UTC) of a zone at an instant. DST-correct because it
 *  reads the zone's actual wall clock for that moment rather than a fixed rule. */
export function tzOffsetMinutes(tz: string, at: Date = new Date()): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value])) as Record<string, string>;
    const hour = p.hour === "24" ? "00" : p.hour; // some engines emit 24 at midnight
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second);
    return Math.round((asUTC - at.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

function fmtDelta(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export interface TzStatus {
  homeTz: string;
  deviceTz: string;
  homeAbbr: string;
  deviceAbbr: string;
  /** The device is a different zone than home AND their wall clocks differ now.
   *  Two ids that happen to share the current offset (LA vs Vancouver) don't
   *  count — the times align, so there's nothing to flag. */
  traveling: boolean;
  /** Minutes the device is ahead of home right now (negative = behind). */
  deltaMins: number;
  /** "2h ahead" / "1h 30m behind" / "" when aligned. */
  deltaLabel: string;
}

export function tzStatus(homeTz: string, deviceTz: string, at: Date = new Date()): TzStatus {
  const deltaMins = tzOffsetMinutes(deviceTz, at) - tzOffsetMinutes(homeTz, at);
  const traveling = homeTz !== deviceTz && deltaMins !== 0;
  const deltaLabel = deltaMins === 0 ? "" : `${fmtDelta(Math.abs(deltaMins))} ${deltaMins > 0 ? "ahead" : "behind"}`;
  return {
    homeTz,
    deviceTz,
    homeAbbr: tzAbbrev(homeTz, at),
    deviceAbbr: tzAbbrev(deviceTz, at),
    traveling,
    deltaMins,
    deltaLabel,
  };
}

// A small, dependable fallback for the Settings picker on engines without
// Intl.supportedValuesOf (older WebKit). The live list is used when available.
const FALLBACK_ZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Athens",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

/** Every IANA zone the runtime knows (for the Settings picker), or a curated
 *  fallback list on engines that lack Intl.supportedValuesOf. */
export function supportedTimeZones(): string[] {
  try {
    const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const vals = anyIntl.supportedValuesOf?.("timeZone");
    if (Array.isArray(vals) && vals.length) return vals;
  } catch {
    /* fall through */
  }
  return FALLBACK_ZONES;
}
