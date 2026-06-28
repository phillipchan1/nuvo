import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, supabaseUrl, supabaseAnonKey } from "../lib/supabase";
import { attachmentPromptBlock, isImageAttachment } from "../lib/agentAttachments";
import type {
  AgentAction,
  AgentAttachment,
  AgentContentPart,
  AgentMessage,
  AgentRequestMessage,
  AgentStreamEvent,
  AgentSuggestion,
} from "../lib/agentTypes";

function uid() {
  return crypto.randomUUID();
}

function toApiMessage(m: AgentMessage): AgentRequestMessage {
  const text = m.content.trim();
  const images = (m.attachments ?? []).filter(isImageAttachment);
  const textBlocks = (m.attachments ?? [])
    .filter((a) => !isImageAttachment(a))
    .map(attachmentPromptBlock);

  const fullText = [text, ...textBlocks].filter(Boolean).join("\n\n");

  if (images.length === 0) {
    return { role: m.role, content: fullText };
  }

  const parts: AgentContentPart[] = [];
  if (fullText) parts.push({ type: "text", text: fullText });
  for (const img of images) {
    if (img.dataUrl) parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
  }
  return { role: m.role, content: parts.length ? parts : fullText || "(attachment)" };
}

export function useAgent(range: { start: string; end: string }) {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (text: string, attachments: AgentAttachment[] = []) => {
      const trimmed = text.trim();
      const hasAttachments = attachments.length > 0;
      if ((!trimmed && !hasAttachments) || loading) return;

      const userMsg: AgentMessage = {
        id: uid(),
        role: "user",
        content: trimmed,
        attachments: hasAttachments ? attachments : undefined,
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      setError(null);

      // The assistant bubble is created lazily on the first streamed chunk so
      // the "Thinking…" indicator shows until the reply actually starts.
      const assistantId = uid();
      let created = false;
      let streamed = "";
      const ensureAssistant = () => {
        if (created) return;
        created = true;
        setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
      };
      const patchAssistant = (patch: Partial<AgentMessage>) => {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));
      };

      try {
        const history = [...messages, userMsg].map(toApiMessage);

        // The agent replies over SSE; `functions.invoke` can't consume a stream,
        // so call the function endpoint directly and read the body ourselves.
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? supabaseAnonKey;
        const res = await fetch(`${supabaseUrl}/functions/v1/agent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ messages: history, rangeStart: range.start, rangeEnd: range.end }),
        });

        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Agent request failed (${res.status})`);
        }

        let finalActions: AgentAction[] | undefined;
        let finalSuggestions: AgentSuggestion[] | undefined;

        const handle = (evt: AgentStreamEvent) => {
          if (evt.t === "c") {
            streamed += evt.v;
            ensureAssistant();
            patchAssistant({ content: streamed });
          } else if (evt.t === "d") {
            finalActions = evt.actions?.length ? evt.actions : undefined;
            finalSuggestions = evt.suggestions?.length ? evt.suggestions : undefined;
            const content = (typeof evt.content === "string" && evt.content) || streamed;
            ensureAssistant();
            patchAssistant({ content: content || "Done.", actions: finalActions, suggestions: finalSuggestions });
          } else if (evt.t === "e") {
            throw new Error(evt.msg || "Agent error");
          }
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === "[DONE]") continue;
            let evt: AgentStreamEvent;
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }
            handle(evt);
          }
        }

        // Stream closed without a final/text event — surface whatever streamed.
        if (!created) {
          ensureAssistant();
          patchAssistant({ content: streamed || "Done." });
        }

        if (finalActions?.length) {
          const tools = finalActions.map((a) => a.tool);
          qc.invalidateQueries({ queryKey: ["tasks"] });
          qc.invalidateQueries({ queryKey: ["external_events"] });
          if (tools.some((t) => isVerticalAgentTool(t))) {
            qc.invalidateQueries({ queryKey: ["vertical"] });
          }
          // Priorities (big rocks) live on the week's sprint record.
          if (tools.some((t) => t.endsWith("_priority"))) {
            qc.invalidateQueries({ queryKey: ["sprint"] });
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        // Drop an empty placeholder bubble; keep partial text if any streamed.
        if (created && !streamed) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        }
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, qc, range.end, range.start],
  );

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, loading, error, sendMessage, clear };
}

export type AgentHandle = ReturnType<typeof useAgent>;

const VERTICAL_AGENT_TOOLS = new Set([
  "create_domain", "update_domain", "delete_domain",
  "create_initiative", "update_initiative", "delete_initiative",
  "create_project", "update_project", "delete_project",
  "create_key_result", "update_key_result", "delete_key_result",
]);

function isVerticalAgentTool(tool: string) {
  return VERTICAL_AGENT_TOOLS.has(tool);
}
