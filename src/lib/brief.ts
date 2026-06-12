// Nuvo's morning brief — the voice of an assistant who walked in early, read
// your whole day, and now tells it to you like a person. Deterministic and
// instant (no model round-trip); the numbers underneath are the real day.

import { fmtMins, type DayRead, type Suggestion } from "./now";

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
}: {
  now: Date;
  name: string;
  dayRead: DayRead;
  top: Suggestion | null;
  tired: boolean;
}): Brief {
  const h = now.getHours();
  const part = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
  const at = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const minsLeft = dayRead.current
    ? Math.max(1, Math.round((dayRead.current.end.getTime() - now.getTime()) / 60_000))
    : 0;
  const firstGap = dayRead.gaps[0] ?? null;

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

  // the shape of the day
  if (dayRead.remaining >= 6) {
    parts.push(`It's a full one — ${dayRead.remaining} commitments ahead${firstGap ? `, but it opens up around ${at(firstGap.start)}` : ""}.`);
  } else if (dayRead.remaining >= 3) {
    parts.push(`A steady day — ${dayRead.remaining} commitments, ${fmtMins(dayRead.openMins)} of open room.`);
  } else if (dayRead.remaining === 0) {
    parts.push(`Your calendar's clear — ${fmtMins(dayRead.openMins)} that's entirely yours.`);
  } else {
    parts.push(`An open day — ${dayRead.remaining} commitment${dayRead.remaining > 1 ? "s" : ""}, ${fmtMins(dayRead.openMins)} to make yours.`);
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

  // the plan I'm holding for you
  if (top) {
    const due = top.task.deadlineDaysAway != null && top.task.deadlineDaysAway <= 1 ? ", since it's due tomorrow" : "";
    if (dayRead.current && firstGap) {
      parts.push(`Your first clear block is ${at(firstGap.start)} — I'm holding it for "${top.task.title}"${due}.`);
    } else if (firstGap && firstGap.start.getTime() > now.getTime() + 60_000) {
      parts.push(`At ${at(firstGap.start)} you're free — "${top.task.title}" is what I'd line up${due}.`);
    } else {
      parts.push(`Right now I'd start "${top.task.title}"${due}.`);
    }
  }

  return { greeting: `${part}, ${name}.`, body: parts.join(" ") };
}
