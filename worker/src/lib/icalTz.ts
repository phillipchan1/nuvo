// Time-zone half of CalDAV write-back: wall-clock stamps and VTIMEZONE blocks.
//
// Why this exists: we used to write every DTSTART as UTC (`…Z`). For a single
// event that is harmless. For a series it is wrong twice over — RFC 5545
// evaluates BYDAY and the weekly step in DTSTART's zone, so "every Wednesday
// 6pm Pacific" (= Thursday 01:00Z) expanded onto Tuesday evenings, and every
// occurrence after the DST change slid an hour. A mature calendar anchors a
// series to the zone it was made in; that needs `DTSTART;TZID=…` and, per the
// RFC, a VTIMEZONE describing that TZID. Pure and zero-import so the suite can
// drive it directly.

function pad(n: number, w = 2): string {
  return String(Math.abs(n)).padStart(w, "0");
}

/** Is `tz` an IANA zone this runtime can resolve (and not plain UTC)? */
export function isUsableTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== "string") return false;
  if (/^(utc|gmt|etc\/utc|etc\/gmt|z)$/i.test(tz.trim())) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall clock in `tz` at instant `ms`, as UTC-epoch fields. */
function wall(ms: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const parts: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return { y: parts.year, mo: parts.month, d: parts.day, h: parts.hour % 24, mi: parts.minute, s: parts.second };
}

/** Offset of `tz` from UTC at instant `ms`, in minutes (Pacific summer = -420). */
export function tzOffsetMinutes(ms: number, tz: string): number {
  const w = wall(ms, tz);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** ISO instant → `YYYYMMDDTHHMMSS` wall clock in `tz` (for `;TZID=tz:` lines). */
export function toIcalLocal(iso: string, tz: string): string {
  const w = wall(new Date(iso).getTime(), tz);
  return `${w.y}${pad(w.mo)}${pad(w.d)}T${pad(w.h)}${pad(w.mi)}${pad(w.s)}`;
}

/** `YYYYMMDDTHHMMSS` wall clock in `tz` → epoch ms. A wall time DST skips or
 *  repeats resolves to the earlier of its two readings. */
export function localIcalToMs(stamp: string, tz: string): number {
  const m = stamp.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/);
  if (!m) return NaN;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  // Two passes converge for every real zone: guess with the offset at the
  // naive instant, then correct with the offset at the guess.
  const first = naive - tzOffsetMinutes(naive, tz) * 60_000;
  const second = naive - tzOffsetMinutes(first, tz) * 60_000;
  return Math.min(first, second);
}

function fmtOffset(min: number): string {
  const sign = min < 0 ? "-" : "+";
  return `${sign}${pad(Math.floor(Math.abs(min) / 60))}${pad(Math.abs(min) % 60)}`;
}

function utcStampOfLocal(ms: number, offsetMin: number): string {
  // The observance DTSTART/RDATE is the wall clock in the offset in force
  // BEFORE the transition (RFC 5545 §3.6.5).
  const d = new Date(ms + offsetMin * 60_000);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/** Every offset change of `tz` between two instants (exact to the minute). */
function transitions(tz: string, fromMs: number, toMs: number): { at: number; from: number; to: number }[] {
  const out: { at: number; from: number; to: number }[] = [];
  const STEP = 7 * 86_400_000; // real zones never change twice inside a week
  let prevMs = fromMs;
  let prevOff = tzOffsetMinutes(prevMs, tz);
  for (let t = fromMs + STEP; t <= toMs + STEP; t += STEP) {
    const off = tzOffsetMinutes(t, tz);
    if (off !== prevOff) {
      // Search whole minutes: the first minute that reads the new offset.
      let lo = Math.floor(prevMs / 60_000);
      let hi = Math.ceil(t / 60_000);
      while (hi - lo > 1) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (tzOffsetMinutes(mid * 60_000, tz) === prevOff) lo = mid;
        else hi = mid;
      }
      out.push({ at: hi * 60_000, from: prevOff, to: off });
      prevOff = off;
    }
    prevMs = t;
  }
  return out;
}

/**
 * A VTIMEZONE for `tz` that is exact for the years a series realistically
 * spans: every transition from a year before `aroundISO` to fifteen after is
 * listed as an RDATE, read straight off the runtime's tz database — no
 * guessed "second Sunday in March" rule that a zone could break.
 */
export function buildVtimezone(tz: string, aroundISO: string): string {
  const year = new Date(aroundISO).getUTCFullYear();
  const fromMs = Date.UTC(year - 1, 0, 1);
  const toMs = Date.UTC(year + 15, 11, 31);
  const list = transitions(tz, fromMs, toMs);
  const lines = ["BEGIN:VTIMEZONE", `TZID:${tz}`];

  if (!list.length) {
    const off = tzOffsetMinutes(fromMs, tz);
    lines.push(
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${fmtOffset(off)}`,
      `TZOFFSETTO:${fmtOffset(off)}`,
      "END:STANDARD",
    );
  } else {
    // The smaller offset of a pair is standard time; group identical
    // (from → to) changes into one observance carrying all their dates.
    const minOff = Math.min(...list.flatMap((t) => [t.from, t.to]));
    const groups = new Map<string, { from: number; to: number; stamps: string[] }>();
    for (const t of list) {
      const key = `${t.from}>${t.to}`;
      const g = groups.get(key) ?? { from: t.from, to: t.to, stamps: [] };
      g.stamps.push(utcStampOfLocal(t.at, t.from));
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const kind = g.to > minOff ? "DAYLIGHT" : "STANDARD";
      lines.push(
        `BEGIN:${kind}`,
        `DTSTART:${g.stamps[0]}`,
        // Every onset as an RDATE, the first included: ical.js reads an
        // observance's DTSTART as an onset only when it has no RDATE, and
        // dropping it put the first months of a series at UTC+0.
        ...g.stamps.map((s) => `RDATE:${s}`),
        `TZOFFSETFROM:${fmtOffset(g.from)}`,
        `TZOFFSETTO:${fmtOffset(g.to)}`,
        `END:${kind}`,
      );
    }
  }
  lines.push("END:VTIMEZONE");
  return lines.join("\r\n");
}
