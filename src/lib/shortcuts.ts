// One reading of "which act did you launch into" — shared by every door that can
// open the phone somewhere other than the tab you left it on:
//
//   · PWA manifest shortcuts (long-press the installed icon) → `/?shortcut=capture`
//   · iOS lock-screen / Home Screen widgets → `nuvo://capture` (custom scheme,
//     registered in `scripts/ios-postinit.sh`, delivered by tauri-plugin-deep-link)
//   · Siri / App Intents, when they land — the same two spellings
//
// Both forms name the same acts, so they parse through one function and land in
// one applier (`MobileShell`'s `applyShortcut`). A widget that opens capture and
// a long-press that opens capture must not be able to drift apart.

/** The acts a launch URL is allowed to name. Capture and the chat are the phone's
 *  two permanent floating actions; `today` is where the manifest shortcut lands. */
export type Shortcut = "capture" | "chat" | "today";

const SHORTCUTS: readonly Shortcut[] = ["capture", "chat", "today"] as const;

/** The scheme the iOS shell registers. Widgets link into `nuvo://<act>`. */
export const APP_SCHEME = "nuvo";

export function isShortcut(v: string | null | undefined): v is Shortcut {
  return !!v && (SHORTCUTS as readonly string[]).includes(v);
}

/** Where a capture files when you haven't named a day in the text.
 *
 *  A widget / icon shortcut is a thought dump — Inbox, always. The phone's
 *  last tab is usually Calendar, so inheriting "Today" from that screen made
 *  every lock-screen ＋ land on today. The in-app ＋ may still pre-file Today
 *  when you are actually looking at the day. */
export function captureDefaultDoDate(
  source: "shortcut" | "fab",
  lookingAtToday: boolean,
  today: string,
): string | null {
  if (source === "shortcut") return null;
  return lookingAtToday ? today : null;
}

/**
 * The act a launch URL names, or `null` when it names none.
 *
 * Accepts the query form the PWA uses (`https://day.nuvo.app/?shortcut=chat`) and
 * the scheme form the widgets use (`nuvo://chat`) — including the long spelling
 * `nuvo://open?shortcut=chat`, so a widget URL can carry other params later
 * without a second parser. Anything unrecognized returns `null` rather than
 * guessing: an unknown deep link should leave you where you were.
 */
export function shortcutFromUrl(raw: string): Shortcut | null {
  if (!raw) return null;

  // `?shortcut=` wins wherever it appears — it's the explicit spelling.
  const query = raw.split("?")[1];
  if (query) {
    const named = new URLSearchParams(query).get("shortcut");
    if (isShortcut(named)) return named;
  }

  // …otherwise the first path-ish segment of a `nuvo://` URL. Parsed by hand
  // rather than by `URL`, whose authority/path split for non-special schemes
  // differs between engines (`nuvo://chat` is host "chat" in one, path in another).
  const scheme = raw.slice(0, raw.indexOf(":"));
  if (scheme.toLowerCase() !== APP_SCHEME) return null;
  const rest = raw
    .slice(scheme.length + 1)
    .replace(/^\/+/, "")
    .split(/[?#]/)[0];
  const first = rest.split("/")[0]?.toLowerCase();
  return isShortcut(first) ? first : null;
}
