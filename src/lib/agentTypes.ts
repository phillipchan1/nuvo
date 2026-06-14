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
}

export interface AgentSuggestion {
  label: string;
  message: string;
}

export interface AgentAction {
  tool: string;
  summary: string;
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
}
