import { describe, it, expect } from "vitest";
import { shortcutFromUrl, isShortcut } from "../src/lib/shortcuts";

// The launch vocabulary is shared by the PWA manifest shortcuts and the iOS
// widgets (src-tauri/ios/NuvoWidgets). Both spellings have to keep naming the
// same three acts — a widget that stops opening capture fails silently on a lock
// screen, where nobody is watching a console.
describe("shortcutFromUrl", () => {
  it("reads the scheme form the iOS widgets link into", () => {
    expect(shortcutFromUrl("nuvo://capture")).toBe("capture");
    expect(shortcutFromUrl("nuvo://chat")).toBe("chat");
    expect(shortcutFromUrl("nuvo://today")).toBe("today");
  });

  it("reads the query form the PWA manifest shortcuts use", () => {
    expect(shortcutFromUrl("https://day.nuvo.app/?shortcut=capture")).toBe("capture");
    expect(shortcutFromUrl("https://day.nuvo.app/?shortcut=chat")).toBe("chat");
    expect(shortcutFromUrl("/?shortcut=today")).toBe("today");
  });

  it("accepts the long scheme spelling, so a widget URL can carry params later", () => {
    expect(shortcutFromUrl("nuvo://open?shortcut=capture")).toBe("capture");
    expect(shortcutFromUrl("nuvo://capture?source=lockscreen")).toBe("capture");
  });

  it("tolerates trailing slashes and case", () => {
    expect(shortcutFromUrl("nuvo://Capture/")).toBe("capture");
    expect(shortcutFromUrl("NUVO://chat")).toBe("chat");
  });

  it("leaves you where you were on anything it doesn't recognize", () => {
    expect(shortcutFromUrl("")).toBeNull();
    expect(shortcutFromUrl("nuvo://")).toBeNull();
    expect(shortcutFromUrl("nuvo://summit")).toBeNull();
    expect(shortcutFromUrl("nuvo://capture-everything")).toBeNull();
    expect(shortcutFromUrl("https://day.nuvo.app/")).toBeNull();
    expect(shortcutFromUrl("https://day.nuvo.app/?shortcut=nope")).toBeNull();
    // Another app's scheme naming one of our acts is not our deep link.
    expect(shortcutFromUrl("other://capture")).toBeNull();
  });

  it("guards the union", () => {
    expect(isShortcut("capture")).toBe(true);
    expect(isShortcut("nope")).toBe(false);
    expect(isShortcut(null)).toBe(false);
  });
});
