import type { FC } from "react";
import {
  WelcomeVisual,
  SpineMapVisual,
  FlowVisual,
  OnDeckVisual,
  TimeblockVisual,
  CaptureVisual,
  NuvoVisual,
  ReadyVisual,
} from "./Visuals";

// Bump when a launch is big enough that returning users should see the tour again.
// The stored user_settings.onboarding_completed_version is compared against this.
export const ORIENTATION_VERSION = 1;

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
    id: "map",
    eyebrow: "The layout",
    title: "Everything lives on the left rail.",
    teach:
      "Two zones: Execute — your Schedule (⌘1) — and Build — Projects (⌘2), Initiatives (⌘3), Domains (⌘4). This rail is how you move between altitudes.",
    Visual: SpineMapVisual,
  },
  {
    id: "flow",
    eyebrow: "The flow",
    title: "Big life goals become today's tasks.",
    teach:
      "A Domain (⌘4) holds Initiatives (⌘3), which hold Projects (⌘2), which break into Tasks (⌘1). Meaning flows all the way down — so nothing you do is busywork.",
    Visual: FlowVisual,
  },
  {
    id: "ondeck",
    eyebrow: "Projects · ⌘2",
    title: "On Deck: pick this sprint's projects.",
    teach:
      "A sprint is one or two weeks you commit to. On Deck lets you drag projects into the week you'll actually do them — and warns you when a week is overloaded.",
    Visual: OnDeckVisual,
  },
  {
    id: "schedule",
    eyebrow: "Schedule · ⌘1",
    title: "Give the work a real time.",
    teach:
      "Drag a task onto your Schedule and it becomes a block of time — a scheduled task IS a time block. This is where the plan meets your actual day.",
    Visual: TimeblockVisual,
  },
  {
    id: "capture",
    eyebrow: "Your inbox · ⌘K",
    title: "Get it out of your head — fast.",
    teach:
      "Hit ⌘K anytime and brain-dump in plain words. Nuvo parses the date, domain, and priority for you — no forms, sort it later.",
    Visual: CaptureVisual,
  },
  {
    id: "nuvo",
    eyebrow: "Your co-pilot · ⌘J",
    title: "Nuvo can do almost anything.",
    teach:
      "Open Nuvo (⌘J) and just ask in plain words — it plans the week, finds open time, grooms the inbox, and moves things. You always make the call.",
    Visual: NuvoVisual,
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
