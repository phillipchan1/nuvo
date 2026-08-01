// What the model is handed, exactly: two system messages then the conversation.
//
// The split is deliberate and load-bearing. The first message is byte-identical
// on every request from every account, so the provider's prompt-prefix cache
// actually hits; the second carries the date, the snapshot and the user's
// current view, which change every turn. Splicing the dynamic half into the
// static one would break the prefix match and pay full price for ~3k tokens on
// every message — see the note above STATIC_SYSTEM_PROMPT.
//
// Pure, so the battery assembles the turn the same way the edge function does.

import type { AgentContext } from "./contextShape.ts";
import { contextToPrompt } from "./contextShape.ts";
import type { ChatMessage, ContentPart } from "./loop.ts";
import { buildNavSection, dynamicContextPrompt, systemPromptFor, type NavFocus, type PromptVariant } from "./prompt.ts";

export interface TurnInput {
  ctx: AgentContext;
  /** The zone the user is standing in — named at the top of the snapshot. */
  tz: string;
  /** What's on screen behind the chat, when the client says. */
  navFocus?: NavFocus | null;
  /** The conversation so far, oldest first, ending with the new user message. */
  messages: { role: "user" | "assistant"; content: string | ContentPart[] }[];
  /** Which system prompt to send. Omitted means "full" — what ships today — so
   *  the thin variant is only ever reached by opting in. Both runtimes read it
   *  from the same env var, which is what makes an eval matrix cell honest. */
  promptVariant?: PromptVariant;
}

export function buildTurnMessages(input: TurnInput): ChatMessage[] {
  const { ctx, tz, navFocus, messages, promptVariant } = input;
  const navSection = buildNavSection(navFocus, ctx);
  return [
    { role: "system", content: systemPromptFor(promptVariant ?? "full") },
    {
      role: "system",
      content: dynamicContextPrompt(contextToPrompt(ctx), ctx.today, ctx.nowLabel, ctx.nowISO, navSection, tz),
    },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
}
