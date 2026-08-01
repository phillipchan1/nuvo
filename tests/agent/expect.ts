// The assertion vocabulary a scenario is written in.
//
// Every check returns null (pass) or a sentence saying what the agent actually
// did (fail). A failure has to read like a bug report — "expected create_slot,
// got 3× create_task" — because the person reading it is deciding whether the
// chat regressed or the expectation was wrong, and a bare `false` can't help
// them do that.

import type { RunOutcome } from "./harness.ts";

export type Check = { describe: string; run: (o: RunOutcome) => string | null };

const list = (o: RunOutcome) =>
  o.calls.length ? o.calls.map((c) => c.name).join(", ") : "no tool calls";

/** Tools that write to the user's data. A scenario that says "read only" means
 *  none of these — the list is here rather than inline so adding a write tool
 *  can't quietly widen what a read-only scenario tolerates. */
export const WRITE_TOOLS = [
  "create_task", "create_recurring_task", "plan_task", "schedule_task", "unschedule_task", "reschedule_task",
  "complete_task", "trash_task", "move_to_inbox", "update_task",
  "create_slot", "add_to_slot", "reschedule_slot", "delete_slot",
  "create_calendar_event", "move_event", "reschedule_event", "cancel_event", "decline_event",
  "create_priority", "update_priority", "complete_priority", "delete_priority",
  "create_domain", "update_domain", "delete_domain",
  "create_initiative", "update_initiative", "delete_initiative",
  "create_project", "update_project", "delete_project",
  "create_key_result", "update_key_result", "delete_key_result",
];

export function called(
  name: string,
  args?: { describe: string; ok: (a: Record<string, unknown>) => boolean },
): Check {
  return {
    describe: args ? `calls ${name} (${args.describe})` : `calls ${name}`,
    run: (o) => {
      const hits = o.calls.filter((c) => c.name === name);
      if (!hits.length) return `expected ${name}; got ${list(o)}`;
      if (!args) return null;
      if (hits.some((h) => args.ok(h.args))) return null;
      return `${name} was called, but not ${args.describe} — args: ${hits.map((h) => JSON.stringify(h.args)).join(" | ")}`;
    },
  };
}

export function calledTimes(name: string, n: number): Check {
  return {
    describe: `calls ${name} exactly ${n}×`,
    run: (o) => {
      const c = o.calls.filter((x) => x.name === name).length;
      return c === n ? null : `expected ${n}× ${name}, got ${c} (${list(o)})`;
    },
  };
}

export function notCalled(...names: string[]): Check {
  return {
    describe: `never calls ${names.join(" / ")}`,
    run: (o) => {
      const hit = o.calls.find((c) => names.includes(c.name));
      return hit ? `called ${hit.name} with ${JSON.stringify(hit.args)}` : null;
    },
  };
}

/** No writes at all — the check behind every "propose, don't act" rule. */
export function readOnly(): Check {
  return {
    describe: "writes nothing",
    run: (o) => {
      const hit = o.calls.find((c) => WRITE_TOOLS.includes(c.name));
      return hit ? `wrote via ${hit.name}: ${JSON.stringify(hit.args)}` : null;
    },
  };
}

export function replyMatches(re: RegExp, why: string): Check {
  return {
    describe: `reply ${why}`,
    run: (o) => (re.test(o.turn.content) ? null : `reply did not ${why}. Got: ${JSON.stringify(o.turn.content.slice(0, 300))}`),
  };
}

export function replyLacks(re: RegExp, why: string): Check {
  return {
    describe: `reply never ${why}`,
    run: (o) => {
      const m = o.turn.content.match(re);
      return m ? `reply ${why}: "${m[0]}"` : null;
    },
  };
}

export function offersSuggestions(min = 2): Check {
  return {
    describe: `offers ≥${min} tappable replies`,
    run: (o) =>
      o.turn.suggestions.length >= min
        ? null
        : `expected ≥${min} suggestions, got ${o.turn.suggestions.length}`,
  };
}

export function pointedAt(target: string): Check {
  return {
    describe: `points the screen at "${target}"`,
    run: (o) => {
      const p = o.calls.filter((c) => c.name === "point_at");
      if (!p.length) return `never called point_at (${list(o)})`;
      return p.some((c) => c.args.target === target)
        ? null
        : `pointed at ${p.map((c) => c.args.target).join(", ")} instead of ${target}`;
    },
  };
}

/** A custom predicate, for the one-off shapes a vocabulary shouldn't grow for. */
export function check(describe: string, run: (o: RunOutcome) => string | null): Check {
  return { describe, run };
}

// ── shared argument predicates ───────────────────────────────────────────────

/** Local wall-clock times only: "2026-07-31T09:00". A Z or an offset means the
 *  model did the zone math itself, which is the bug that put blocks three hours
 *  off while traveling — the server converts, always. */
export const isLocalTime = (v: unknown): boolean =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);

export const startsAt = (local: string) => ({
  describe: `starting ${local}`,
  ok: (a: Record<string, unknown>) => a.start_local === local || a.start_time === local,
});

/** A title the model wrote, not the user's sentence handed back. */
export const isWrittenTitle = (v: unknown): boolean => {
  if (typeof v !== "string") return false;
  const t = v.trim();
  const words = t.split(/\s+/).length;
  return (
    words >= 1 && words <= 5 &&
    !/,/.test(t) &&                       // not a list of the contents
    !/^(work|task|tasks|block|time) block$/i.test(t) &&
    !/^(work|tasks|stuff|things|misc)$/i.test(t) &&
    !/\bslot\b/i.test(t)                  // not the user's word for the container
  );
};
