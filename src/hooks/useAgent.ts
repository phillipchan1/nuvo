import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { AgentMessage, AgentResponse } from "../lib/agentTypes";

function uid() {
  return crypto.randomUUID();
}

export function useAgent(range: { start: string; end: string }) {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMsg: AgentMessage = { id: uid(), role: "user", content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      setError(null);

      try {
        const history = [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        }));

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
        };
        setMessages((prev) => [...prev, assistantMsg]);

        if (data.actions?.length) {
          qc.invalidateQueries({ queryKey: ["tasks"] });
          qc.invalidateQueries({ queryKey: ["external_events"] });
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
