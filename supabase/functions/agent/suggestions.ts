export interface AgentSuggestion {
  label: string;
  message: string;
}

const TAG_RE = /<suggestions>\s*([\s\S]*?)\s*<\/suggestions>/i;

export function parseSuggestions(reply: string): { content: string; suggestions: AgentSuggestion[] } {
  const match = reply.match(TAG_RE);
  if (!match) return { content: reply.trim(), suggestions: [] };

  let suggestions: AgentSuggestion[] = [];
  try {
    const raw = JSON.parse(match[1]) as unknown;
    if (Array.isArray(raw)) {
      suggestions = raw
        .filter((x): x is Record<string, unknown> => x && typeof x === "object")
        .map((x) => ({
          label: String(x.label ?? x.message ?? "").trim(),
          message: String(x.message ?? x.label ?? "").trim(),
        }))
        .filter((x) => x.label && x.message)
        .slice(0, 5);
    }
  } catch {
    /* ignore malformed tag */
  }

  const content = reply.replace(TAG_RE, "").trim();
  return { content, suggestions };
}
