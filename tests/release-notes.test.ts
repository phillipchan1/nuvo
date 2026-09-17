import { describe, expect, it } from "vitest";
import {
  GENERIC_NOTES,
  isMinor,
  notableNotes,
} from "../src/lib/releaseNotesVoice";
import {
  finalizeNotes,
  GENERIC_NOTES as SCRIPT_GENERIC,
  userPrompt,
} from "../scripts/release-notes.mjs";

const JOIN =
  "- Added a Join button for meeting links found in an event’s location, so it’s quicker to jump into the right call.";
const DRAG = "- Made Schedule click-and-drag feel instant again, so moving things around is smooth and responsive.";
const BOUNDS = "- ✨ Prevented empty date bounds from being sent during sync, keeping your calendar and planning data nice and steady.";
const RECONCILE = "- Streamlined the calendar reconciliation so everything feels snappier and less “taxing” to interact with.";
const GRID = "- Smooth out the schedule view so it doesn’t constantly re-check the whole calendar grid as you browse and update your day.";
const HARNESS = "- Fixed a task display/casting issue in the year harness, so task items render more reliably when interacting with year view.";
const BLUR = "- Drop the heavy backdrop blur on the schedule so the calendar feels clearer and more “in focus” while you plan";
const OLD_GENERIC = "✨ Minor improvements and behind-the-scenes fixes.";

describe("release notes voice", () => {
  it("keeps the quiet line identical in the generator and the app", () => {
    expect(SCRIPT_GENERIC).toBe(GENERIC_NOTES);
  });

  it("stays quiet when nothing user-facing is clear", () => {
    expect(isMinor("")).toBe(true);
    expect(isMinor(OLD_GENERIC)).toBe(true);
    expect(isMinor(GENERIC_NOTES)).toBe(true);
    expect(isMinor("A little polish.")).toBe(true);
    expect(notableNotes(BOUNDS)).toBeNull();
    expect(notableNotes(RECONCILE)).toBeNull();
    expect(notableNotes(GRID)).toBeNull();
    expect(notableNotes(HARNESS)).toBeNull();
    expect(notableNotes(BLUR)).toBeNull();
    expect(notableNotes("feat(sync): skip empty date bounds")).toBeNull();
    expect(notableNotes("- fix the prefetch in src/hooks/useCalendar.ts")).toBeNull();
  });

  it("keeps notes that say what the person gets", () => {
    expect(notableNotes(JOIN)).toBe(JOIN);
    expect(notableNotes(DRAG)).toBe(DRAG);
    expect(
      notableNotes("- Tap empty time on the Day canvas to quickly capture something right there at that slot."),
    ).toContain("Tap empty time");
    expect(
      notableNotes(
        "- 💳 Subscription now works smoothly with Stripe on the web and StoreKit on iOS for consistent in-app access.",
      ),
    ).toContain("Subscription");
  });

  it("drops the engineering bullets and keeps the rest", () => {
    expect(notableNotes(`${JOIN}\n${BOUNDS}`)).toBe(JOIN);
    expect(notableNotes(`${RECONCILE}\n${DRAG}`)).toBe(DRAG);
  });

  it("the generator finalizes the same way the app filters", () => {
    const samples = [JOIN, DRAG, BOUNDS, RECONCILE, GRID, HARNESS, BLUR, OLD_GENERIC, GENERIC_NOTES, `${JOIN}\n${BOUNDS}`];
    for (const sample of samples) {
      expect(finalizeNotes(sample)).toBe(notableNotes(sample) ?? GENERIC_NOTES);
    }
  });

  it("asks the model for what the person gets, and to stay quiet when that isn't clear", () => {
    const prompt = userPrompt("- feat(sync): skip empty date bounds");
    expect(prompt).toContain("what they GET");
    expect(prompt).toContain(GENERIC_NOTES);
    expect(prompt).toContain("do not guess");
    expect(prompt).toContain("Prevented empty date bounds");
  });
});
