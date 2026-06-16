// Nuvo's morning brief — the voice of an assistant who walked in early, read
// your whole day, and now tells it to you like a person. Deterministic and
// instant (no model round-trip); the numbers underneath are the real day.

import { fmtMins, OPEN_OFFER_MINS, type DayRead, type Suggestion } from "./now";

export interface Brief {
  greeting: string;
  body: string; // a short paragraph, 2–4 sentences
}

export function composeBrief({
  now,
  name,
  dayRead,
  top,
  tired,
  restDay = false,
}: {
  now: Date;
  name: string;
  dayRead: DayRead;
  top: Suggestion | null;
  tired: boolean;
  /** Today is a day you don't work (weekend / marked off). The brief protects
   *  the rest instead of pointing at the next task to start. */
  restDay?: boolean;
}): Brief {
  const h = now.getHours();
  const part = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
  const at = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const minsLeft = dayRead.current
    ? Math.max(1, Math.round((dayRead.current.end.getTime() - now.getTime()) / 60_000))
    : 0;
  const firstGap = dayRead.gaps[0] ?? null;

  // A day off changes the whole job of the brief: not "here's the next thing to
  // start" but "you're off — here's only what's actually planned, then rest."
  // We never push the work backlog or promise a slot; the open time is the point.
  if (restDay) {
    const parts = ["Today's a day off — nothing's pushing on you."];
    if (dayRead.current) {
      parts.push(`You're in ${dayRead.current.title} — ${fmtMins(minsLeft)} left.`);
    } else if (dayRead.next) {
      const more = dayRead.remaining - 1;
      parts.push(`You've got ${dayRead.next.title} at ${at(dayRead.next.start)}${more > 0 ? `, then ${more} more` : ""} — otherwise it's open.`);
    } else {
      parts.push("Nothing's on the calendar — the day is yours.");
    }
    parts.push("Rest easy. I'll have your work ready when you're back to it.");
    return { greeting: `${part}, ${name}.`, body: parts.join(" ") };
  }

  // When you've told me you're spent, the brief changes its whole posture.
  if (tired) {
    const parts = ["You're running low — I've got today."];
    if (dayRead.current) parts.push(`Get through ${dayRead.current.title} (${fmtMins(minsLeft)} left), then breathe.`);
    parts.push("I've set the heavy work aside for now.");
    parts.push(
      top
        ? `Something gentle like "${top.task.title}" is plenty — quick wins and a real break.`
        : `Quick wins and a real break — that's the whole plan.`,
    );
    return { greeting: `Let's lighten this, ${name}.`, body: parts.join(" ") };
  }

  const parts: string[] = [];
  const open = dayRead.openMins;
  const rem = dayRead.remaining;
  const remLabel = `${rem} commitment${rem === 1 ? "" : "s"}`;

  // the shape of the day — keyed off BOTH what's left and how much is open, so
  // it never claims an "open day" when you're actually booked through.
  if (open <= 0) {
    parts.push(rem === 0 ? `That's a wrap — nothing left on the calendar.` : `You're booked through — ${remLabel} left and no open blocks.`);
  } else if (rem >= 6) {
    parts.push(`It's a full one — ${remLabel} ahead${firstGap ? `, but it opens up around ${at(firstGap.start)}` : ""}.`);
  } else if (rem >= 3) {
    parts.push(`A steady day — ${remLabel}, ${fmtMins(open)} of open room.`);
  } else if (rem === 0) {
    parts.push(`Your calendar's clear — ${fmtMins(open)} that's entirely yours.`);
  } else {
    parts.push(`Light ahead — ${remLabel} and ${fmtMins(open)} to make yours.`);
  }

  // where you are right now
  if (dayRead.current) {
    let s = `You're in ${dayRead.current.title} — ${fmtMins(minsLeft)} left.`;
    if (dayRead.overlapping.length) {
      const n = dayRead.overlapping.length;
      s += ` ${n} more ${n > 1 ? "are" : "is"} stacked on it; I'd let ${n > 1 ? "them" : "it"} ride.`;
    }
    parts.push(s);
  }

  // Nuvo doesn't push unplanned work. It only flags a genuinely big open block —
  // and leaves the choice to you. No big block → the day speaks for itself.
  if (top) {
    const focusGap = dayRead.gaps.reduce<typeof firstGap>((best, g) => (!best || g.mins > best.mins ? g : best), null);
    if (focusGap && focusGap.mins >= OPEN_OFFER_MINS) {
      const whenStr = focusGap.start.getTime() <= now.getTime() + 60_000 ? "right now" : `at ${at(focusGap.start)}`;
      parts.push(`You've a ${fmtMins(focusGap.mins)} open block ${whenStr} — say the word and I'll line something up.`);
    }
  }

  return { greeting: `${part}, ${name}.`, body: parts.join(" ") };
}
