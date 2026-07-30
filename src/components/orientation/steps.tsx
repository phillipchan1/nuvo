import type { FC } from "react";
import {
  WelcomeVisual,
  TimeblockVisual,
  OnDeckVisual,
  InitiativeVisual,
  DomainVisual,
  NuvoVisual,
  CaptureVisual,
  AppearanceVisual,
  ReadyVisual,
} from "./Visuals";
import type { TeachTargetKey } from "./teachTargets";

// Bump when a launch is big enough that returning users should see the tour again.
// The stored user_settings.onboarding_completed_version is compared against this.
export const ORIENTATION_VERSION = 4;

// A step's optional call-to-action. `action` is a semantic verb the shell wires to
// something real (desktop/mobile open their own Settings surface for "connect-calendars").
export type OrientationAction = "connect-calendars";

export interface OrientationStep {
  id: string;
  /** Tracked small-caps eyebrow. */
  eyebrow: string;
  /** The Fraunces hero line — names the concept and, where it matters, its ⌘ home. */
  title: string;
  /** One short supporting line. Keep it tight — the visual does the teaching. */
  teach: string;
  Visual: FC;
  /** An extra button beside Back/Next that does something real in the app. */
  cta?: { label: string; action: OrientationAction };
}

// The single source of truth for the walkthrough. Each concept is anchored to WHERE
// it lives in the app (the Spine's ⌘1–4, ⌘K capture, ⌘J Nuvo) so a new user can
// actually find it. Adding a feature later = one object here.
//
// Deliberately additive, one concept at a time, starting from what's already familiar
// (a task) rather than naming all four altitudes up front: task → project → initiative
// → domain. The real, in-app lifecycle (Inbox → Groom → Slot — the same two acts at
// every altitude, see planning-kernel.md) IS the teaching device, not an invented one:
// a task lands in the Inbox loose, then gets time-blocked; a project sits ungroomed
// until it earns a real slot on On Deck; an initiative is the same pattern one size up.
// Domain is deliberately the exception — it's never slotted, just ongoing.
//
// Nuvo (⌘J) rides after the ladder so its teach line can reuse the exact words just
// taught ("grooms your inbox, slots your projects") as a payoff, not a new vocabulary.
// Capture (⌘K) and Appearance are the "nice things" cluster at the end — power-user
// speed and personalization, not core concepts a first read needs.
export const ORIENTATION_STEPS: OrientationStep[] = [
  {
    // The fork. Orientation renders two doors here instead of Next — some people
    // want to be shown and left alone, some want to be walked through it, and
    // guessing wrong makes the walkthrough either useless or patronising.
    id: "welcome",
    eyebrow: "Before we start",
    title: "Ready to organize your life?",
    teach:
      "You're carrying a lot — work, family, faith, health. Nuvo gives each its own place and connects them into one plan. Want the quick read, or shall we set up your first week together?",
    Visual: WelcomeVisual,
  },
  {
    id: "schedule",
    eyebrow: "Schedule · ⌘1",
    title: "Everything starts in your Inbox.",
    teach: "A task lands loose. Time-block it onto your Schedule, and it's real work.",
    Visual: TimeblockVisual,
  },
  {
    id: "ondeck",
    eyebrow: "Projects · ⌘2",
    title: "More than one task? Groom it into a Project.",
    teach: "Once it's ready, slot it onto a week (or two) on On Deck.",
    Visual: OnDeckVisual,
  },
  {
    id: "initiative",
    eyebrow: "Initiatives · ⌘3",
    title: "More than one project? That's an Initiative.",
    teach: "Same idea, groomed and sized to a quarter, not a week.",
    Visual: InitiativeVisual,
  },
  {
    id: "domain",
    eyebrow: "Domains · ⌘4",
    title: "It all rolls up to a Domain.",
    teach:
      "The area of your life all of this belongs to — always on, never finished, never slotted away.",
    Visual: DomainVisual,
  },
  {
    id: "nuvo",
    eyebrow: "Your co-pilot · ⌘J",
    title: "Nuvo can do almost anything.",
    teach:
      "Ask in plain words — it grooms your inbox, slots your projects, and plans the week for you. You always make the call.",
    Visual: NuvoVisual,
  },
  {
    id: "capture",
    eyebrow: "Your inbox · ⌘K",
    title: "The fast way into your Inbox.",
    teach: "Hit ⌘K anytime, brain-dump in plain words — no forms, it lands right where you saw it.",
    Visual: CaptureVisual,
  },
  {
    id: "appearance",
    eyebrow: "Make it yours",
    title: "Pick a look that feels like you.",
    teach: "Nuvo comes in a few skins, from warm glass to a mono terminal. Change it anytime in Settings.",
    Visual: AppearanceVisual,
  },
  {
    id: "ready",
    eyebrow: "You're set",
    title: "Let's make this week land.",
    teach: "Name what matters, block it in, let Nuvo help. First step: bring your calendars in.",
    Visual: ReadyVisual,
    cta: { label: "Connect your calendars →", action: "connect-calendars" },
  },
];

// ══ The other door: "Walk me through it" ═══════════════════════════════════════
//
// The visual tour above teaches with rebuilt art, which asks the reader to map a
// picture onto a screen they've never seen. This path removes that translation:
// the card docks out of the way, the *real* app stays live behind it, and each
// step names one act the user performs in the real UI. The panel then watches for
// it in real data.
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
    id: "done",
    eyebrow: "You're set",
    title: "Let's make this week land.",
    teach: "That's the whole app: capture it, groom it, slot it. Everything else is a bigger clock.",
    Visual: ReadyVisual,
  },
];
