import type { FC } from "react";
import { InitiativeVisual, DomainVisual, RulesVisual } from "./Visuals";
import type { TeachTargetKey } from "./teachTargets";

// Bump when a launch is big enough that returning users should see the tour again.
// The stored user_settings.onboarding_completed_version is compared against this.
export const ORIENTATION_VERSION = 4;

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

/** A milestone this step is waiting on, derived from real data — never a click. */
export type TeachMilestone = "inbox" | "timeblock" | "project" | "nuvo" | "calendar";

export interface TeachStep {
  id: string;
  eyebrow: string;
  title: string;
  /** One line naming the act. The real UI is the visual. */
  teach: string;
  /** The real element to light + how to get there (see teachTargets.ts). */
  target?: TeachTargetKey;
  /** When this ticks in real data, the step is done. Omit for a read-only step. */
  milestone?: TeachMilestone;
  /** Only where no honest act exists on day one — the step falls back to art. */
  Visual?: FC;
  cta?: { label: string; action: OrientationAction };
}

export const ORIENTATION_TEACH_STEPS: TeachStep[] = [
  {
    // Start with the act, not the concept. "Everything starts in your Inbox" is a
    // sentence about an abstraction; "add your first task" is a thing to do — and
    // the next step gets to *show* them the Inbox with their own words in it.
    id: "capture",
    eyebrow: "Schedule · ⌘1",
    title: "Let's add your first task.",
    teach: "Type one thing you're actually carrying — plain words, no form. I'll wait.",
    target: "capture",
    milestone: "inbox",
  },
  {
    id: "inbox",
    eyebrow: "Schedule · ⌘1",
    title: "There it is — your Inbox.",
    teach:
      "Everything you capture lands here first, and nothing else has to be decided yet. This is the one place nothing gets lost.",
    target: "inbox-tab",
  },
  {
    id: "timeblock",
    eyebrow: "Schedule · ⌘1",
    title: "Now give it a time.",
    teach: "Drag it onto the calendar. A task with a time isn't a wish anymore — it's work.",
    target: "day-list",
    milestone: "timeblock",
  },
  {
    id: "project",
    eyebrow: "Projects · ⌘2",
    title: "More than one task? That's a Project.",
    teach: "Name one you're carrying. Once it's groomed, you slot it onto a week — not a day.",
    target: "project-new",
    milestone: "project",
  },
  {
    // They won't make one today — an initiative is several projects and a fresh
    // account has one. But "you won't need this yet" only lands once you've been
    // shown where it would go, so this navigates like every other step.
    id: "initiative",
    eyebrow: "Initiatives · ⌘3",
    title: "More than one project? That's an Initiative.",
    teach: "Same two acts, one size up — a quarter instead of a week. Nothing to do here today.",
    target: "initiative-new",
    Visual: InitiativeVisual,
  },
  {
    id: "domain",
    eyebrow: "Domains · ⌘4",
    title: "It all rolls up to a Domain.",
    teach: "The ones you just named. Always on, never finished, never slotted away.",
    target: "domain-card",
    Visual: DomainVisual,
  },
  {
    id: "nuvo",
    eyebrow: "Your co-pilot · ⌘J",
    title: "This is Nuvo. Ask it something.",
    teach:
      "Plain words — it grooms your inbox, slots your projects, and plans the week. You always make the call.",
    target: "nuvo",
    milestone: "nuvo",
  },
  {
    id: "calendars",
    eyebrow: "Last thing",
    title: "Bring your calendars in.",
    teach: "Nuvo can't tell you what fits until it knows what's already there.",
    target: "calendars",
    milestone: "calendar",
    cta: { label: "Connect your calendars →", action: "connect-calendars" },
  },
  {
    // The rules come after the doing. Stated up front they're terms of service —
    // vocabulary with nothing to attach to. Stated here they consolidate: the
    // reader has just done all three, so this names a pattern they've felt.
    // Shortest screen in the flow.
    id: "rules",
    eyebrow: "You're set",
    title: "Now — the rules that make it sing.",
    teach:
      "You just did all three. Nothing moves down a floor until it's ready for the one below — that's the whole machine, and it's why the week can be trusted.",
    Visual: RulesVisual,
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
    eyebrow: "Every Sunday · 20 minutes",
    title: "And this is what makes it easy.",
    teach:
      "Twenty minutes here turns all of that into a real week. You're in it now — bring your project in.",
    target: "plan-week",
  },
];
