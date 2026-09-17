// What's new is written for someone using Nuvo, not for the commit log.
// If a change isn't a thing they would notice and understand, it stays quiet.
// Keep the quiet line and the engineering filter in sync with scripts/release-notes.mjs.

/** Published when nothing user-facing is clear. Folded to "+ N smaller updates" in Settings. */
export const GENERIC_NOTES = "✨ A few quiet improvements behind the scenes.";

const GENERIC_LINE =
  /^(?:[-*•]\s*)?(?:✨\s*)?(?:minor improvements|a little polish|a few quiet improvements|automated build from)\b/i;

const CONVENTIONAL =
  /^(?:feat|fix|chore|docs|refactor|test|build|ci|style|perf)(?:\([^)]*\))?:/i;

// Mechanism, plumbing, and engine names — not a benefit a person would recognize.
// Keep in sync with scripts/release-notes.mjs.
const ENGINEERING =
  /\b(?:date bounds|reconcil(?:e|iation)|placeholderData|prefetch|RLS\b|webhook|debounce|harness|type-?cast|\bcast(?:ing|ed)\b|schema|migration|edge function|CORS\b|payload|backdrop blur|re-?check(?:ing)? the whole|FullCalendar|webview|service worker|TypeScript|Tailwind|TanStack|minisign|notariz|codesign)\b/i;

const FILEISH = /(?:^|\s)(?:src|supabase|scripts|tests)\/|\.\b(?:tsx?|mjs|jsx?|yml|sql)\b/i;

function bodyOf(line: string): string {
  return line.replace(/^[-*•]\s*/, "").replace(/^[✨🎉]\s*/, "").trim();
}

function isQuietLine(line: string): boolean {
  const body = bodyOf(line);
  return !body || GENERIC_LINE.test(line) || GENERIC_LINE.test(body);
}

function isEngineeringLine(line: string): boolean {
  const body = bodyOf(line);
  return CONVENTIONAL.test(body) || ENGINEERING.test(body) || FILEISH.test(body);
}

/**
 * Notes a person using the app should see: what they get, in their words.
 * Returns null when the whole update should stay quiet (generic / internal / unclear).
 */
export function notableNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const kept: string[] = [];
  for (const raw of notes.split(/\n+/)) {
    const line = raw.trim();
    if (!line || isQuietLine(line) || isEngineeringLine(line)) continue;
    kept.push(/^[-*•]\s/.test(line) ? line.replace(/^[•*]\s/, "- ") : `- ${line}`);
  }
  return kept.length > 0 ? kept.join("\n") : null;
}

/** True when Settings should fold this version into "+ N smaller updates". */
export function isMinor(notes: string): boolean {
  return notableNotes(notes) == null;
}
