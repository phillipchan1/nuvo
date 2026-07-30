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

// Bump when a launch is big enough that returning users should see the tour again.
// The stored user_settings.onboarding_completed_version is compared against this.
export const ORIENTATION_VERSION = 3;

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
    id: "welcome",
    eyebrow: "A 2-minute walkthrough",
    title: "Ready to organize your life?",
    teach:
      "You're carrying a lot — work, family, faith, health. Nuvo gives each its own place and connects them into one plan. Let me show you around.",
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
