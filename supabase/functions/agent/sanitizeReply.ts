/** Strip internal ids from text shown to the user. */
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

export function sanitizeUserFacingText(text: string): string {
  return text
    .replace(/\b(?:initiative|project|domain|task|event|key_result|calendar)_id\s*[:=]\s*/gi, "")
    .replace(UUID_RE, "")
    .replace(/\(\s*\)/g, "")
    .replace(/^\s*[-*•]\s*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
