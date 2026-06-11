export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: AgentAction[];
}

export interface AgentAction {
  tool: string;
  summary: string;
}

export interface AgentRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  rangeStart?: string;
  rangeEnd?: string;
}

export interface AgentResponse {
  reply: string;
  actions?: AgentAction[];
}
