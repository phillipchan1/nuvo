// What you'll be DOING — the axis a run of loose work is cut on.
//
// A run is time spent in one mode: on the phone, in the inbox, out of the house,
// at the keyboard writing. Cutting loose work by domain grouped by who the work is
// FOR, which put "call the plumber" and "renew the domain" in one "Home admin"
// block even though one is a phone call and the other is a browser tab — and the
// operator's own free time isn't divided by domain at all (ⓟ, 2026-11-06). So
// loose quick work is grouped by the kind of action its title starts with, and
// only falls back to domain when the verb says nothing.
//
// Read from the title's first words, deliberately conservative: an unknown verb
// returns null (→ the domain fallback), never a guess. A wrong run costs a
// re-group; a missed one costs nothing. See docs/plan-the-week-v2.md §5.

export type ActionKind = "calls" | "replies" | "errands" | "writing";

export const ACTION_KIND_NAME: Record<ActionKind, string> = {
  calls: "Calls",
  replies: "Replies",
  errands: "Out of the house",
  writing: "Writing",
};

const RULES: [ActionKind, RegExp][] = [
  ["calls", /^(call|ring|phone|text|facetime|catch up with|check in with)\b/],
  ["replies", /^(email|e-mail|reply|respond|answer|send|follow up|follow-up|followup|message|dm|write back|write to)\b/],
  ["errands", /^(buy|pick up|pickup|drop off|dropoff|return|grab|get|shop|post|mail|deliver|collect)\b/],
  ["writing", /^(write|draft|outline|edit|rewrite|journal)\b/],
];

/** The kind of action a task's title names, or null when it names none. */
export function actionKindOf(title: string | null | undefined): ActionKind | null {
  const s = (title ?? "").trim().toLowerCase().replace(/^[-*•\s]+/, "");
  if (!s) return null;
  for (const [kind, re] of RULES) if (re.test(s)) return kind;
  return null;
}
