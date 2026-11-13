import type { FC } from "react";
import { InitiativeVisual, DomainVisual } from "./Visuals";
import type { TeachTargetKey } from "./teachTargets";

// Bump when a launch is big enough that returning users should see the tour again.
// The stored user_settings.onboarding_completed_version is compared against this.
export { ORIENTATION_VERSION } from "./version";

// A step's optional call-to-action. `action` is a semantic verb the shell wires to
// something real (desktop/mobile open their own Settings surface for "connect-calendars").
export type OrientationAction = "connect-calendars";


// ══ The walkthrough ════════════════════════════════════════════════════════════
//
// There used to be a second path here — a card tour of rebuilt art. It's gone
// (D-065): a diagram asks the reader to map a picture onto a screen they've never
// seen, which is the exact problem this path removes. The card docks out of the
// way, the *real* app stays live behind it, and each step names one act the user
// performs in the real UI. The panel then watches for it in real data.
//
// It cannot simply be "coach marks over the app," because at first-run there IS
// no data: FirstRun gates the shell on `domains.length === 0` (AppShell), so the
// account arrives here with domains and nothing else. Pointing at an empty Inbox
// teaches less than the diagram does. So this path teaches by *making the thing
// exist* — every row it lands is created by the user, in their words (D-026 holds:
// we still seed nothing).
//
// The acts are, deliberately, the five GettingStarted milestones in order — this
// walkthrough IS that tracker, performed live — so finishing here retires the
// tracker through the path it already has and clears the floors' empty states.
//
// THE VOICE (D-200). The reader is someone with more ambition than hours
// (D-186). So each step is a statement, not a coach's prompt: short, in the
// imperative or the declarative, ending on a full stop (drawn as the ember
// `Stop` — the thing in front of you is *now*). It never cheers ("nice!"),
// never counts a streak, never says hustle (brandscript §10). The emotion comes
// from the user's own words coming back to them as each act lands, and from the
// last picture: the ladder, filled with what they made.

/** A milestone this step is waiting on, derived from real data — never a click. */
export type TeachMilestone = "inbox" | "timeblock" | "project" | "nuvo" | "calendar";

export interface TeachStep {
  id: string;
  /** Where the step happens: the place's name and its key, as the Spine says it. */
  where: { label: string; keys?: string };
  /** The statement, WITHOUT its final full stop — the card draws the ember one. */
  title: string;
  /** One line naming the act. The real UI is the visual. */
  teach: string;
  /** The real element to light + how to get there (see teachTargets.ts). */
  target?: TeachTargetKey;
  /** When this ticks in real data, the step is done. Omit for a read-only step. */
  milestone?: TeachMilestone;
  /** Only where no honest act exists on day one — the step falls back to art. */
  Visual?: FC;
  /** The closing picture: the ladder, drawn from what this account now holds. */
  ladder?: boolean;
  cta?: { label: string; action: OrientationAction };
}

export const ORIENTATION_TEACH_STEPS: TeachStep[] = [
  {
    // Start with the act, not the concept — and start small on purpose. The
    // whole walkthrough climbs from this one line to a domain, so the first
    // thing it asks for is the smallest true thing on their mind.
    id: "capture",
    where: { label: "Schedule", keys: "⌘1" },
    title: "Start with one thing you're carrying",
    teach: "Type it the way you'd say it. No form, no folder.",
    target: "capture",
    milestone: "inbox",
  },
  {
    id: "inbox",
    where: { label: "Inbox", keys: "⌘1" },
    title: "It's in. Nothing gets lost now",
    teach: "Everything you capture lands here first. What it is can be decided later — not now.",
    target: "inbox-tab",
  },
  {
    id: "timeblock",
    where: { label: "Schedule", keys: "⌘1" },
    title: "Give it an hour",
    teach: "Drag it onto the calendar. A task with a time stops being a wish.",
    target: "day-list",
    milestone: "timeblock",
  },
  {
    id: "project",
    where: { label: "Projects", keys: "⌘2" },
    title: "Bigger than a task? Make it a project",
    teach: "Name something you mean to finish. Its tasks are what earn it a week.",
    target: "project-new",
    milestone: "project",
  },
  {
    // They won't make one today — an initiative is several projects and a fresh
    // account has one. But "you won't need this yet" only lands once you've been
    // shown where it would go, so this navigates like every other step.
    id: "initiative",
    where: { label: "Initiatives", keys: "⌘3" },
    title: "Bigger than a project? That's an initiative",
    teach: "Several projects, one outcome, a quarter to land it. This is where the big ones live — nothing to make today.",
    target: "initiative-new",
    Visual: InitiativeVisual,
  },
  {
    id: "domain",
    where: { label: "Domains", keys: "⌘4" },
    title: "And it all answers to a domain",
    teach: "The ones you just named. Never finished, never put away — and you'll see when one goes quiet.",
    target: "domain-card",
    Visual: DomainVisual,
  },
  {
    id: "nuvo",
    where: { label: "Nuvo", keys: "⌘J" },
    title: "Nuvo offers what would help",
    teach: "On each page it suggests the next step: the steps a project is missing, a pattern in your week. It proposes; you decide.",
    target: "nuvo",
    milestone: "nuvo",
  },
  {
    id: "calendars",
    where: { label: "Settings · Calendars" },
    title: "Show it what's already booked",
    teach: "Ambition without arithmetic is a wish list. Nuvo can't say what fits until it sees your calendar.",
    target: "calendars",
    milestone: "calendar",
    cta: { label: "Connect your calendars", action: "connect-calendars" },
  },
  {
    // The rules come after the doing. Stated up front they're terms of service —
    // vocabulary with nothing to attach to. Stated here they consolidate: the
    // reader has just done it, and the picture is THEIR line — the ladder from the
    // welcome, filled with the task, the project and the domain they just made.
    id: "rules",
    where: { label: "How it works" },
    title: "That's the whole machine",
    teach: "Nothing moves down a rung until it's ready for the one below. That's why the week can be trusted.",
    ladder: true,
  },
  {
    // …and the ritual comes after the rules, because it's what makes obeying them
    // easy. The law on its own reads as a constraint; landing here immediately
    // after reframes it as something handled for you once a week.
    //
    // Ending *inside* the ritual is the point: the walkthrough stops with the act
    // in front of you and your own project sitting in "needs a week", rather than
    // depositing you on an empty Schedule with a sign-off. It's also why the
    // calendars step sits two back — the ritual opens by asking what room the week
    // has, which is only answerable once it can see what's booked.
    id: "plan",
    where: { label: "Plan the week" },
    title: "Now make this week count",
    teach: "Twenty minutes, once a week: pull what matters, give it room, commit. You're in it — bring your project in.",
    target: "plan-week",
  },
];
