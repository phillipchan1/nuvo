// The intelligent Now. Given the vertical + the current moment, rank the ready
// tasks and explain *why* each rose — the daily dividend of the whole vertical.
// Heuristic for now; easy to swap weights or move to the agent later.

import {
  domainById,
  faithfulness,
  initiativeById,
  type Domain,
  type Initiative,
  type VerticalData,
  type VTask,
} from "./vertical";

export interface Reason {
  glyph: string;
  text: string;
}

export interface Suggestion {
  task: VTask;
  domain: Domain | null;
  initiative: Initiative | null;
  score: number;
  reasons: Reason[];
}

export interface NowContext {
  /** Minutes until the next calendar commitment (the open gap). */
  gapMins: number;
  /** Is this a natural deep-focus window (mid-morning / mid-afternoon)? */
  deepWindow: boolean;
  clockLabel: string; // e.g. "3:12 PM"
  gapLabel: string; // e.g. "33m till your next meeting"
}

/** Build the moment from the wall clock (no live calendar wired yet). */
export function nowContext(at: Date): NowContext {
  const h = at.getHours();
  const m = at.getMinutes();
  const deepWindow = (h >= 9 && h < 12) || (h >= 14 && h < 16);
  // Stub the next-commitment gap until the calendar feeds it in.
  const toNextHalf = 30 - (m % 30);
  const gapMins = h >= 18 || h < 8 ? 90 : Math.max(20, toNextHalf + 15);
  const clockLabel = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const gapLabel =
    h >= 18 || h < 8 ? "open evening — no meetings" : `${gapMins}m till your next commitment`;
  return { gapMins, deepWindow, clockLabel, gapLabel };
}

const ENERGY_GLYPH: Record<string, string> = { deep: "◆", decide: "▲", delegate: "⇢", quick: "•" };

export function rankNow(data: VerticalData, ctx: NowContext): Suggestion[] {
  const candidates = data.tasks.filter((t) => t.status === "ready");

  const scored = candidates.map((task): Suggestion => {
    const domain = domainById(data, task.domainId);
    const initiative = initiativeById(data, task.initiativeId);
    const reasons: Reason[] = [];
    let score = 0;

    // Faithfulness — the strongest pull. A starving domain wants you back.
    if (domain) {
      const f = faithfulness(domain);
      if (!f.lit) {
        const w = domain.lastTouchedDays >= 10 ? 4 : 3;
        score += w;
        reasons.push({ glyph: "⚖", text: `${domain.name} has been quiet ${domain.lastTouchedDays} days` });
      }
    }

    // Deadline pressure.
    if (task.deadlineDaysAway != null) {
      if (task.deadlineDaysAway <= 1) { score += 3; reasons.push({ glyph: "⚑", text: "due tomorrow" }); }
      else if (task.deadlineDaysAway <= 2) { score += 2; reasons.push({ glyph: "⚑", text: `due in ${task.deadlineDaysAway} days` }); }
      else if (task.deadlineDaysAway <= 5) { score += 1; reasons.push({ glyph: "⚑", text: `due in ${task.deadlineDaysAway} days` }); }
    }

    // Does it fit the open gap?
    if (task.durationMins <= ctx.gapMins) {
      score += 1;
      reasons.push({ glyph: "⏱", text: `fits your ${ctx.gapMins}m gap` });
    } else {
      score -= 2;
      reasons.push({ glyph: "⏱", text: `needs ${task.durationMins}m — bigger than this gap, block it` });
    }

    // Energy match to the window.
    if (task.energy) {
      const g = ENERGY_GLYPH[task.energy];
      if (ctx.deepWindow && task.energy === "deep") { score += 2; reasons.push({ glyph: g, text: "your deep-focus window" }); }
      else if (!ctx.deepWindow && (task.energy === "quick" || task.energy === "delegate")) { score += 1; reasons.push({ glyph: g, text: "low-friction, right for now" }); }
    }

    // Initiative momentum — keep the moving things moving.
    if (initiative && initiative.momentum === "up") {
      score += 1;
      reasons.push({ glyph: "↑", text: `moves ${initiative.name} ${initiative.progress}%→` });
    }

    return { task, domain, initiative, score, reasons };
  });

  return scored.sort((a, b) => b.score - a.score || a.task.durationMins - b.task.durationMins);
}
