// The battery. Every scenario is an act the chat is supposed to be able to do,
// written as: this world, these words → this is what a correct agent does.
//
// The bar for adding one: it names a behavior somebody asked for, or a way the
// chat has actually been wrong. Not "the model should be smart" — a specific
// tool, with specific arguments, or a specific refusal to act. If a scenario
// can't be written that way it belongs in the docs, not here.
//
// Grouped by capability, and the groups mirror docs/agent-conformance.md so the
// map and the suite can't drift.
//
// **Every scenario is held to 100%**, on every run. There is no tier of
// scenarios the chat is allowed to fail sometimes: a chat that gets the week
// right four times in five is a chat you have to check, and a planner you have
// to check is not doing its job. A scenario that only passes sometimes is
// telling you one of two things — the chat is genuinely unreliable there, or
// the expectation is written loosely enough that a correct answer can fail it.
// Both are bugs. Neither is fixed by lowering the bar.
//
// The one escape hatch is `quarantined`, below: a dated sentence saying this
// one is known-red and being worked. It still runs, it still reports, it just
// doesn't hold the exit code hostage — and it is impossible to add silently.

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
  /** Set ONLY to park a known-failing scenario while it's being fixed. Must
   *  read "YYYY-MM-DD — why". It still runs and still prints; it just doesn't
   *  fail the exit code. Anything parked without a date fails `npm test`. */
  quarantined?: string;
  respond?: ToolResponder;
  navFocus?: { rung: string; projectId?: string };
  /** Why this scenario exists, when it isn't obvious — usually a real bug. */
  because?: string;
}

/** Identity — every scenario carries the same weight, so the only thing this
 *  does is keep the list reading as a list of pinned behaviors. */
const pin = (s: Scenario): Scenario => s;

export const SCENARIOS: Scenario[] = [
  // ── A · Capture and placement ──────────────────────────────────────────────

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
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

  pin({
    id: "structure-existing-is-not-a-creation",
    group: "structure",
    it: "when a project by that name already exists, the reply says so instead of claiming a new one",
    because:
      "the tool layer now returns the existing row (existing: true) rather than making a twin — a reply that still says 'created' turns a no-op into a lie the user has no way to catch",
    world: "loaded",
    turns: ["add a project for the Dayspring docs work"],
    respond: (c) =>
      c.name === "create_project"
        ? { id: ID.projDayspringDocs, name: "Dayspring docs", existing: true, status: "planned" }
        : { ok: true },
    expect: [
      replyLacks(/\b(created|new project|set up a project)\b/i, "calls a no-op a creation"),
      replyMatches(/already|exists|have one|got one/i, "says the project was already there"),
    ],
  }),

  pin({
    id: "structure-ambiguity-shows-the-options",
    group: "structure",
    it: "two projects with one name become a choice the user can tap, not a question repeated back",
    because:
      "2026-08-01: the chat said 'I need the exact one' four times. The error had only ever told it the count — now it carries the candidates, and the reply has to spend them",
    world: "loaded",
    turns: ["update the Dayspring support infrastructure project with a fuller description"],
    respond: (c) => {
      if (c.name !== "update_project" || c.args.project_id || c.args.in_initiative_name) return { ok: true };
      return {
        error:
          'Multiple projects match "Dayspring support infrastructure" (2). Show the user these options — the initiative each one sits under is usually what tells them apart — and call again with that project_id, or with in_initiative_name. Do not act on more than one unless the user names each.\n' +
          `Candidates: [{"project_id":"${ID.projDayspring}","name":"Build Dayspring Support Infrastructure","initiative":"Get Dayspring into the Public","domain":"Work","status":"backlog"},` +
          `{"project_id":"${ID.projDayspringDocs}","name":"Build Dayspring Support Infrastructure","initiative":"Dayspring v2","domain":"Work","status":"backlog"}]`,
      };
    },
    expect: [
      replyMatches(/Get Dayspring into the Public/i, "names the first candidate's initiative"),
      replyMatches(/Dayspring v2/i, "names the second candidate's initiative"),
      offersSuggestions(2),
      replyLacks(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, "shows the user an id"),
    ],
  }),

  pin({
    id: "structure-spends-the-answer",
    group: "structure",
    it: "an answer that narrows the target gets used, not asked for again",
    because:
      "the user said 'the one tied to Get Dayspring into the Public' and got 'there are still 2 matching projects' — the disambiguator was correct and the tool layer had nowhere to put it",
    world: "loaded",
    turns: [
      "update the Dayspring support infrastructure project with a fuller description",
      {
        assistant:
          "I found two projects by that name — one under **Get Dayspring into the Public**, one under **Dayspring v2**. Which one?",
      },
      "the one tied to Get Dayspring into the Public",
    ],
    respond: (c) => {
      if (c.name !== "update_project") return { ok: true };
      const narrowed = Boolean(c.args.project_id) || /Get Dayspring into the Public/i.test(String(c.args.in_initiative_name ?? ""));
      return narrowed
        ? { id: ID.projDayspring, name: "Build Dayspring Support Infrastructure" }
        : { error: 'Multiple projects match "Dayspring support infrastructure" (2).' };
    },
    expect: [
      called("update_project", {
        describe: "naming which one, by id or by the initiative the user gave",
        ok: (a) =>
          Boolean(a.project_id) || /Get Dayspring into the Public/i.test(String(a.in_initiative_name ?? "")),
      }),
      calledTimes("update_project", 1),
      replyLacks(/which one|need the exact|still \d+ matching/i, "asks again for something already answered"),
    ],
  }),

  pin({
    id: "structure-one-target-per-write",
    group: "structure",
    it: "an unclear target is never resolved by writing to every candidate",
    because:
      "the transcript's ending: two projects got the same description because 'both' was the only exit the tool layer offered from its own ambiguity",
    world: "loaded",
    turns: ["update the Dayspring support infrastructure project with a fuller description"],
    respond: (c) =>
      c.name === "update_project" && !c.args.project_id
        ? {
            error:
              'Multiple projects match "Dayspring support infrastructure" (2).\n' +
              `Candidates: [{"project_id":"${ID.projDayspring}","name":"Build Dayspring Support Infrastructure","initiative":"Get Dayspring into the Public"},` +
              `{"project_id":"${ID.projDayspringDocs}","name":"Build Dayspring Support Infrastructure","initiative":"Dayspring v2"}]`,
          }
        : { ok: true },
    expect: [
      check("does not update both candidates", (o) => {
        const ids = o.calls
          .filter((c) => c.name === "update_project" && c.args.project_id)
          .map((c) => String(c.args.project_id));
        return new Set(ids).size > 1
          ? `wrote the same update to ${new Set(ids).size} projects: ${[...new Set(ids)].join(", ")}`
          : null;
      }),
    ],
  }),

  pin({
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

  pin({
    id: "marquee-points-at-the-answer",
    group: "marquee",
    it: "a data answer brings the surface it's about onto the screen",
    world: "loaded",
    turns: ["what does my calendar look like today?"],
    expect: [pointedAt("schedule")],
  }),

  pin({
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

  pin({
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

  pin({
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

  pin({
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
