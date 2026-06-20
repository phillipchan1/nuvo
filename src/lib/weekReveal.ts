// The Friday reveal — the Review's "it's ready, come receive it" invitation.
//
// There's no generation step: the Review is a pure function of live rows, always
// ready. So this is purely about the *invitation* — a gentle nudge at a
// configurable time (default Friday 1pm). Per-device for now (localStorage); a
// notification is device-specific anyway. Stateless + per-week so reconfiguring
// is trivial: the reveal "fires" whenever now ≥ this week's reveal moment and the
// week hasn't been acknowledged yet. Changing the time just moves an unfired
// trigger; an already-acknowledged week never re-fires.

import { addDays } from "date-fns";
import { parseDateISO } from "./dates";

export interface RevealConfig {
  enabled: boolean;
  /** 0=Sun … 6=Sat. Default 5 (Friday). */
  dow: number;
  /** minutes past midnight. Default 780 (13:00). */
  minutes: number;
}

export const DEFAULT_REVEAL: RevealConfig = { enabled: true, dow: 5, minutes: 780 };

const CONFIG_KEY = "nuvo.review.reveal";

export function readRevealConfig(): RevealConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_REVEAL;
    const p = JSON.parse(raw) as Partial<RevealConfig>;
    return {
      enabled: typeof p.enabled === "boolean" ? p.enabled : DEFAULT_REVEAL.enabled,
      dow: typeof p.dow === "number" ? p.dow : DEFAULT_REVEAL.dow,
      minutes: typeof p.minutes === "number" ? p.minutes : DEFAULT_REVEAL.minutes,
    };
  } catch {
    return DEFAULT_REVEAL;
  }
}

export function writeRevealConfig(c: RevealConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

/** Monday=1 → 0 days past Monday; Friday=5 → 4; Sunday=0 → 6. */
function offsetFromMonday(dow: number): number {
  return (dow + 6) % 7;
}

/** The reveal moment for a given (Monday-anchored) week. */
export function revealAt(weekStartISO: string, c: RevealConfig): Date {
  const d = addDays(parseDateISO(weekStartISO), offsetFromMonday(c.dow));
  d.setHours(0, c.minutes, 0, 0);
  return d;
}

/** Has this week's reveal moment arrived? */
export function isRevealReady(now: Date, weekStartISO: string, c: RevealConfig): boolean {
  return c.enabled && now.getTime() >= revealAt(weekStartISO, c).getTime();
}

// ── Per-week acknowledgement (the user opened or dismissed the invitation) ────
const ackKey = (w: string) => `nuvo.review.ack.${w}`;
export function isAcknowledged(weekStartISO: string): boolean {
  try {
    return localStorage.getItem(ackKey(weekStartISO)) === "1";
  } catch {
    return false;
  }
}
export function acknowledge(weekStartISO: string): void {
  try {
    localStorage.setItem(ackKey(weekStartISO), "1");
  } catch {
    /* ignore */
  }
}

// ── One announcement toast per week (separate from ack, so the glow can persist
//    after the toast is gone without re-toasting every reload) ────────────────
const toastKey = (w: string) => `nuvo.review.toasted.${w}`;
export function wasToasted(weekStartISO: string): boolean {
  try {
    return localStorage.getItem(toastKey(weekStartISO)) === "1";
  } catch {
    return false;
  }
}
export function markToasted(weekStartISO: string): void {
  try {
    localStorage.setItem(toastKey(weekStartISO), "1");
  } catch {
    /* ignore */
  }
}

/** "Fri · 1:00 PM" — for the settings summary. */
export function revealLabel(c: RevealConfig): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const h = Math.floor(c.minutes / 60);
  const m = c.minutes % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${days[c.dow]} · ${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
