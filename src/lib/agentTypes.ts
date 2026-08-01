import type { MarqueeDirective } from "./marquee";
import type { BigRock } from "./types";

export interface AgentAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  /** Base64 data URL for images. */
  dataUrl?: string;
  /** Extracted text for documents. */
  textContent?: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: AgentAttachment[];
  actions?: AgentAction[];
  /** Clickable quick replies rendered below this message. */
  suggestions?: AgentSuggestion[];
  /** Marquee — drive the left canvas (navigate + spotlight) alongside the reply. */
  ui?: MarqueeDirective;
}

export interface AgentSuggestion {
  label: string;
  message: string;
}

/** What an action DID to the record — drives the card's ribbon, not its layout. */
export type AgentVerb =
  | "created"
  | "slotted"
  | "moved"
  | "updated"
  | "done"
  | "trashed"
  | "unslotted";

/** A pointer to the row an action touched. The edge deliberately does NOT
 *  serialize the record's fields: the card looks the row up in the live cache,
 *  so scrolling back to it an hour later shows what's true now, not a snapshot
 *  that quietly went stale the moment you moved the task somewhere else. */
export interface AgentRef {
  kind: "task" | "event" | "priority" | "slot";
  id: string;
}

/** The inverse of an action — see the same type in supabase/functions/agent/tools.ts. */
export type AgentUndo =
  | { kind: "task"; patch: Record<string, unknown> }
  | { kind: "priority"; id: string; restore: BigRock | null }
  // Slots: a patch reverses a move; a delete reverses holding the block in the
  // first place, and names the tasks that were created inside it so undo takes
  // those with it instead of leaving three orphans on the day.
  | { kind: "slot"; patch: Record<string, unknown> }
  | { kind: "slot-delete"; id: string; childIds: string[] };

export interface AgentAction {
  tool: string;
  /** Always populated — cards degrade to this line when the ref can't render. */
  summary: string;
  verb?: AgentVerb;
  ref?: AgentRef;
  undo?: AgentUndo;
}

export type AgentContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface AgentRequestMessage {
  role: "user" | "assistant";
  content: string | AgentContentPart[];
}

export interface AgentRequest {
  messages: AgentRequestMessage[];
  rangeStart?: string;
  rangeEnd?: string;
}

export interface AgentResponse {
  reply: string;
  actions?: AgentAction[];
  suggestions?: AgentSuggestion[];
  ui?: MarqueeDirective;
}

// The agent function streams Server-Sent Events. Each `data:` line is one of:
//   { t: "c", v }      — a text chunk to append to the assistant reply
//   { t: "d", ... }    — the final payload: cleaned content + actions/suggestions
//   { t: "e", msg }    — a fatal error
export type AgentStreamEvent =
  | { t: "c"; v: string }
  | { t: "d"; content: string; actions?: AgentAction[]; suggestions?: AgentSuggestion[]; ui?: unknown }
  | { t: "e"; msg: string };
