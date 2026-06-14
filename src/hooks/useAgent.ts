import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { attachmentPromptBlock, isImageAttachment } from "../lib/agentAttachments";
import type { AgentAttachment, AgentContentPart, AgentMessage, AgentRequestMessage, AgentResponse } from "../lib/agentTypes";

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

      try {
        const history = [...messages, userMsg].map(toApiMessage);

        const { data, error: fnError } = await supabase.functions.invoke<AgentResponse>("agent", {
          body: {
            messages: history,
            rangeStart: range.start,
            rangeEnd: range.end,
          },
        });

        if (fnError) throw new Error(fnError.message);
        if (!data) throw new Error("No response from agent");
        if ("error" in data && typeof (data as { error: string }).error === "string") {
          throw new Error((data as { error: string }).error);
        }

        const assistantMsg: AgentMessage = {
          id: uid(),
          role: "assistant",
          content: data.reply || "Done.",
          actions: data.actions,
          suggestions: data.suggestions?.length ? data.suggestions : undefined,
        };
        setMessages((prev) => [...prev, assistantMsg]);

        if (data.actions?.length) {
          const tools = data.actions.map((a) => a.tool);
          qc.invalidateQueries({ queryKey: ["tasks"] });
          qc.invalidateQueries({ queryKey: ["external_events"] });
          if (tools.some((t) => isVerticalAgentTool(t))) {
            qc.invalidateQueries({ queryKey: ["vertical"] });
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
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
