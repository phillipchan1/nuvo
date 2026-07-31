// The battery. Every scenario is an act the chat is supposed to be able to do,
// written as: this world, these words → this is what a correct agent does.
//
// The bar for adding one: it names a behavior somebody asked for, or a way the
// chat has actually been wrong. Not "the model should be smart" — a specific
// tool, with specific arguments, or a specific refusal to act. If a scenario
// can't be written that way it belongs in the docs, not here.
//
// Grouped by capability, and the groups mirror docs/agent-conformance.md so the
// map and the suite can't drift. `weight: "must"` scenarios are the contract —
// a release with one of them red is a broken chat. `should` scenarios are
// judgment: a dip is a signal to look, not a stop-ship.

import {
  called, calledTimes, check, isLocalTime, isWrittenTitle, notCalled,
  offersSuggestions, pointedAt, readOnly, replyLacks, replyMatches, startsAt,
  type Check,
} from "./expect.ts";
import { ID, TODAY } from "./world.ts";
import type { ToolResponder } from "./harness.ts";
import type { WorldName } from "./world.ts";

export interface Scenario {
  id: string;
  /** Which capability group — must match a section in agent-conformance.md. */
  group: string;
  /** What this pins, in one line. Printed on failure. */
  it: string;
  world: WorldName;
  turns: (string | { assistant: string })[];
  expect: Check[];
  weight?: "must" | "should";
  respond?: ToolResponder;
  navFocus?: { rung: string; projectId?: string };
  /** Why this scenario exists, when it isn't obvious — usually a real bug. */
  because?: string;
}

const must = (s: Omit<Scenario, "weight">): Scenario => ({ ...s, weight: "must" });
const should = (s: Omit<Scenario, "weight">): Scenario => ({ ...s, weight: "should" });

export const SCENARIOS: Scenario[] = [
  // ── A · Capture and placement ──────────────────────────────────────────────

  must({
    id: "capture-inbox",
    group: "capture",
    it: "a bare thought lands in the inbox with no date invented",
    world: "loaded",
    turns: ["remember I need to look into the new insurance thing"],
    expect: [
      called("create_task", {
        describe: "with no do_date and no start_time",
        ok: (a) => !a.do_date && !a.start_time,
      }),
      notCalled("schedule_task", "plan_task", "create_slot"),
    ],
  }),

  must({
    id: "capture-no-phantom-date",
    group: "capture",
    it: '"need to work on X" is context, not a date — the golden rule',
    because: "the single most common wrong write: describing work reads as planning it for today",
    world: "loaded",
    turns: ["I need to work on the Stampede subdomain stuff, it's been bugging me"],
    expect: [
      check("sets no do_date anywhere", (o) => {
        const hit = o.calls.find((c) => c.args.do_date != null || c.args.start_time != null || c.args.start_local != null);
        return hit ? `${hit.name} dated it: ${JSON.stringify(hit.args)}` : null;
      }),
      notCalled("schedule_task", "create_slot"),
    ],
  }),

  must({
    id: "capture-into-project",
    group: "capture",
    it: "items named against a project file under that project, undated",
    world: "loaded",
    turns: ["for the Dayspring docs project: rewrite the install page, add a troubleshooting section"],
    expect: [
      called("create_task", {
        describe: `with project_id = Dayspring docs`,
        ok: (a) => a.project_id === ID.projDayspringDocs,
      }),
      check("does not date backlog work", (o) => {
        const hit = o.calls.find((c) => c.name === "create_task" && c.args.do_date != null);
        return hit ? `dated a backlog item: ${JSON.stringify(hit.args)}` : null;
      }),
    ],
  }),

  should({
    id: "capture-title-hygiene",
    group: "capture",
    it: "a task filed under a project doesn't repeat the project's name in its title",
    world: "loaded",
    turns: ["add a task to the Dayspring docs project: fix the typos in the dayspring docs install guide"],
    expect: [
      called("create_task", {
        describe: "with a title that doesn't echo the parent",
        ok: (a) => typeof a.title === "string" && !/dayspring docs/i.test(a.title),
      }),
    ],
  }),

  must({
    id: "capture-timed",
    group: "capture",
    it: "a stated time becomes a local wall-clock string, never a UTC conversion",
    because: "a model doing its own zone math is how blocks landed hours off while traveling",
    world: "traveling",
    turns: ["call the ATC reviewer tomorrow at 2pm for 30 minutes"],
    expect: [
      check("passes a local time, unconverted", (o) => {
        const c = o.calls.find((x) => ["create_task", "schedule_task", "create_calendar_event"].includes(x.name));
        if (!c) return `expected a timed write; got ${o.calls.map((x) => x.name).join(", ") || "nothing"}`;
        const t = c.args.start_time ?? c.args.start_local;
        if (!isLocalTime(t)) return `expected local 'YYYY-MM-DDTHH:MM', got ${JSON.stringify(t)}`;
        return String(t).endsWith("T14:00") ? null : `expected 14:00 (2pm where the user is standing), got ${t}`;
      }),
    ],
  }),

  // ── B · Slots: one block of time that holds several tasks ──────────────────

  must({
    id: "slot-one-window-many-items",
    group: "slots",
    it: "one window + several pieces of work = ONE named block, not one block per item",
    because:
      "2026-07-31, the screenshot that started this suite: this exact sentence produced three " +
      "consecutive one-hour tasks (9–10, 10–11, 11–12) because the agent had no slot vocabulary at all",
    world: "loaded",
    turns: ["9am slot today where I'll update documentation get day spring deployed get stampede subdomains working"],
    expect: [
      calledTimes("create_slot", 1),
      called("create_slot", { ...startsAt(`${TODAY}T09:00`) }),
      called("create_slot", {
        describe: "carrying all three pieces of work inside it",
        ok: (a) => Array.isArray(a.tasks) && a.tasks.length === 3,
      }),
      called("create_slot", {
        describe: "with a title the agent wrote, not the user's sentence",
        ok: (a) => isWrittenTitle(a.title),
      }),
      notCalled("schedule_task"),
      calledTimes("create_task", 0),
    ],
  }),

  must({
    id: "slot-single-item-is-not-a-slot",
    group: "slots",
    it: "one piece of work at a stated time is still a plain time block",
    because: "a new tool that eats the old tool's cases is worse than no tool",
    world: "loaded",
    turns: ["put the Dayspring deploy on the calendar at 2pm today for an hour"],
    expect: [
      notCalled("create_slot"),
      check("schedules the one thing", (o) =>
        o.calls.some((c) => ["schedule_task", "create_task", "create_calendar_event"].includes(c.name))
          ? null
          : `expected a single time block; got ${o.calls.map((c) => c.name).join(", ") || "nothing"}`),
    ],
  }),

  must({
    id: "slot-add-to-existing",
    group: "slots",
    it: "adding to a block the user already holds goes inside it, not beside it",
    world: "loaded",
    turns: [
      "block 9 to 11 this morning for the Stampede push — subdomains and the ATC follow-up",
      { assistant: "Held **Stampede push** — 9:00–11:00 AM, two items inside." },
      "actually add the deploy to that block too",
    ],
    expect: [
      called("add_to_slot"),
      notCalled("schedule_task"),
      calledTimes("create_slot", 1), // only the first turn's block
    ],
  }),

  should({
    id: "slot-move-carries-its-work",
    group: "slots",
    it: "moving a block moves the block, not each task inside it",
    world: "loaded",
    turns: [
      "hold 9 to 11 for the Stampede push — subdomains, the deploy, the ATC follow-up",
      { assistant: "Held **Stampede push** — 9:00–11:00 AM, three items inside." },
      "push that block to 1pm",
    ],
    expect: [
      called("reschedule_slot"),
      notCalled("reschedule_task", "schedule_task"),
    ],
  }),

  must({
    id: "slot-time-is-busy",
    group: "slots",
    it: "time the user has already held reads as busy, not open",
    because: "slots were invisible to the context, so the agent offered hours the user had already claimed",
    world: "loaded",
    turns: ["am I free at 9 this morning?"],
    expect: [
      readOnly(),
      replyMatches(/\b(no|not|busy|booked|taken|already)\b/i, "says the 9am hour isn't open"),
    ],
    respond: () => ({ ok: true }),
  }),

  should({
    id: "slot-names-the-throughline",
    group: "slots",
    it: "the block's name is the through-line of the work, in 2–4 words",
    world: "loaded",
    turns: ["give me a 2 hour block this afternoon to do the grocery run, pick up the dry cleaning and get the car washed"],
    expect: [
      called("create_slot", {
        describe: "with a short written name, not a comma list or 'Work block'",
        ok: (a) => isWrittenTitle(a.title),
      }),
      called("create_slot", {
        describe: "sized to the 2 hours the user asked for",
        ok: (a) => a.duration_minutes === 120,
      }),
    ],
  }),

  // ── C · Calendar ───────────────────────────────────────────────────────────

  must({
    id: "cal-named-calendar-wins",
    group: "calendar",
    it: "a calendar the user names beats their stored default",
    world: "loaded",
    turns: ["put dinner with Ann on my Family calendar Saturday at 6:30"],
    expect: [
      called("create_calendar_event", {
        describe: "targeting Family",
        ok: (a) => typeof a.calendar_name === "string" && /family/i.test(a.calendar_name),
      }),
    ],
  }),

  must({
    id: "cal-never-infers-from-subject",
    group: "calendar",
    it: "the subject of an event never picks a calendar",
    because:
      '2026-07-28: "Call with Tiffany Souers" landed on a Women\'s calendar hidden months earlier. ' +
      "Unnamed always means the default — which means omitting calendar_name.",
    world: "loaded",
    turns: ["add a call with Tiffany Souers Thursday at 3pm"],
    expect: [
      called("create_calendar_event", {
        describe: "with no calendar named at all",
        ok: (a) => a.calendar_name == null,
      }),
    ],
  }),

  must({
    id: "cal-move-not-duplicate",
    group: "calendar",
    it: "re-homing an event it just created is a move, never a second create",
    world: "loaded",
    turns: [
      "add dinner with Ann Saturday at 6:30",
      { assistant: "Added **Dinner with Ann** to **phillipchan1@gmail.com** (your default) for Sat Aug 1, 6:30–8:00 PM." },
      "put that on Family instead",
    ],
    expect: [
      called("move_event"),
      calledTimes("create_calendar_event", 1),
    ],
  }),

  must({
    id: "cal-cancel-asks-first",
    group: "calendar",
    it: "cancelling on other people's calendars asks before it acts",
    world: "loaded",
    turns: ["cancel my meetings this afternoon"],
    expect: [
      notCalled("cancel_event", "decline_event"),
      replyMatches(/\?|confirm/i, "asks which ones / for confirmation"),
    ],
  }),

  must({
    id: "cal-confirmed-cancel-executes",
    group: "calendar",
    it: "once confirmed it cancels immediately — no second ask",
    because: "double-confirm loops were a real complaint; a tapped suggestion IS the yes",
    world: "loaded",
    turns: [
      "cancel my lunch today",
      { assistant: "That's **Lunch**, 12:00–1:00 PM today. Cancel it?" },
      "yes",
    ],
    expect: [called("cancel_event")],
  }),

  // ── D · The week ───────────────────────────────────────────────────────────

  must({
    id: "week-slate-is-not-empty",
    group: "week",
    it: "never calls the week unplanned while the slate holds projects",
    because:
      "the agent read big_rocks (a verdict, usually empty) while every UI surface derived the " +
      "week from project spans — so it reported 'no priorities set' over a full deck",
    world: "loaded",
    turns: ["what are my priorities this week?"],
    expect: [
      readOnly(),
      replyLacks(/\b(no|nothing|haven't|not) (week |weekly )?(priorities|set|planned)/i, "claims the week is empty"),
      replyMatches(/stampede/i, "names what's actually on the slate"),
    ],
  }),

  must({
    id: "week-plan-proposes-first",
    group: "week",
    it: '"plan my week" opens a conversation and writes nothing on the first turn',
    world: "loaded",
    turns: ["help me plan this week"],
    expect: [
      readOnly(),
      replyMatches(/stampede|dayspring/i, "reads the slate back before proposing anything"),
      offersSuggestions(2),
    ],
  }),

  should({
    id: "week-priority-carries-project",
    group: "week",
    it: "bringing a bet onto the week passes the project id, not just a title",
    because: "a priority with no project is a phantom — it renders on none of the week's surfaces",
    world: "loaded",
    turns: ["put the fall sermon series on this week too"],
    expect: [
      called("create_priority", {
        describe: "with the Fall sermon series project id",
        ok: (a) => a.project_id === ID.projSermon,
      }),
    ],
  }),

  should({
    id: "week-overload-names-the-cost",
    group: "week",
    it: "on a full week, adding something says what comes off",
    world: "overloaded",
    turns: ["I want to add a new project this week for the budget rewrite"],
    expect: [
      replyMatches(/\b(already|full|carry|drop|push|instead of|comes off|too much|trade)\b/i,
        "names the cost rather than silently agreeing"),
    ],
  }),

  // ── E · Availability and judgment ──────────────────────────────────────────

  must({
    id: "avail-from-windows-only",
    group: "availability",
    it: "availability answers come from the computed windows, not from counting gaps",
    world: "loaded",
    turns: ["when's my next open hour today?"],
    expect: [
      readOnly(),
      replyMatches(/1(:00)?\s*(pm|PM)|3(:00)?\s*(pm|PM)/, "names one of the real open windows"),
      replyLacks(/\b9(:\d\d)?\s*(am|AM)\b/, "offers a window that is actually booked"),
    ],
  }),

  should({
    id: "judgment-names-the-rollover",
    group: "availability",
    it: "an item that has rolled four times gets named, not silently rescheduled",
    world: "loaded",
    turns: ["what should I do about my inbox?"],
    expect: [
      replyMatches(/atc reviewer/i, "names the item that keeps rolling"),
      replyMatches(/\b(4|four|rolled|keeps|again|times)\b/i, "says that it has been rolling"),
    ],
  }),

  must({
    id: "cold-account-invents-nothing",
    group: "availability",
    it: "an empty account gets an honest empty answer, not a fabricated week",
    because: "Principle 16 — the failure mode that only shows up in an account that isn't the builder's",
    world: "cold",
    turns: ["what's on my plate this week?"],
    expect: [
      readOnly(),
      replyLacks(/stampede|dayspring|sermon/i, "names data this account does not have"),
    ],
  }),

  // ── F · Structure ──────────────────────────────────────────────────────────

  should({
    id: "structure-routes-by-domain",
    group: "structure",
    it: "a new project lands in the life area its subject belongs to",
    world: "loaded",
    turns: ["new project: rebuild the church's volunteer onboarding"],
    expect: [
      called("create_project", {
        describe: "under Church",
        ok: (a) => a.domain_id === ID.domChurch || /church/i.test(String(a.domain_name ?? "")),
      }),
    ],
  }),

  must({
    id: "structure-no-phantom-claims",
    group: "structure",
    it: "it never claims to have created something when the write failed",
    because: "a confident confirmation over a failed tool is the worst possible outcome — the user stops checking",
    world: "loaded",
    turns: ["create a project called Meridian Phase 2 under Work"],
    respond: () => ({ error: "duplicate key value violates unique constraint" }),
    expect: [
      replyLacks(/\b(created|added|set up|done)\b.*meridian/i, "claims a creation the tool refused"),
    ],
  }),

  // ── G · Showing alongside telling ──────────────────────────────────────────

  should({
    id: "marquee-points-at-the-answer",
    group: "marquee",
    it: "a data answer brings the surface it's about onto the screen",
    world: "loaded",
    turns: ["what does my calendar look like today?"],
    expect: [pointedAt("schedule")],
  }),

  should({
    id: "marquee-quiet-on-confirmations",
    group: "marquee",
    it: "a pure confirmation doesn't move the user's screen",
    world: "loaded",
    turns: [
      "trash the 'Review the deck' capture",
      { assistant: "Trashed **Review the deck**." },
      "thanks",
    ],
    expect: [notCalled("point_at")],
  }),

  // ── H · Guardrails ─────────────────────────────────────────────────────────

  must({
    id: "guard-off-topic",
    group: "guardrails",
    it: "off-topic gets one sentence and no tools",
    world: "loaded",
    turns: ["who won the Lakers game last night?"],
    expect: [
      readOnly(),
      notCalled("point_at"),
      check("keeps it to a sentence", (o) =>
        o.turn.content.length <= 220 ? null : `replied with ${o.turn.content.length} chars`),
    ],
  }),

  must({
    id: "guard-no-ids-in-reply",
    group: "guardrails",
    it: "the user never sees a uuid or a field name",
    world: "loaded",
    turns: ["what's in my inbox?"],
    expect: [
      replyLacks(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, "leaks an id"),
      replyLacks(/\b(project_id|initiative_id|domain_id|task_id)\b/, "leaks a field name"),
    ],
  }),

  should({
    id: "guard-ambiguity-asks-once",
    group: "guardrails",
    it: "a genuinely ambiguous target asks once, with tappable options",
    world: "loaded",
    turns: ["add a task to Dayspring: check the redirect rules"],
    expect: [
      check("either asks which Dayspring, or picks one and says which", (o) => {
        const asked = /which|dayspring docs/i.test(o.turn.content);
        const wrote = o.calls.some((c) => c.name === "create_task");
        if (asked) return null;
        if (wrote) return null; // picking and naming it is a legitimate answer
        return `neither asked nor acted: ${JSON.stringify(o.turn.content.slice(0, 200))}`;
      }),
    ],
  }),
];

export const GROUPS = [...new Set(SCENARIOS.map((s) => s.group))];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
