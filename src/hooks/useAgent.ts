import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, supabaseUrl, supabaseAnonKey } from "../lib/supabase";
import { attachmentPromptBlock, isImageAttachment } from "../lib/agentAttachments";
import { marqueeManifest } from "../lib/marqueeRegistry";
import { detectDeviceTz } from "../lib/timezone";
import { invalidateWhenSafe } from "../lib/sync";
import type {
  AgentAction,
  AgentAttachment,
  AgentContentPart,
  AgentMessage,
  AgentRequestMessage,
  AgentStreamEvent,
  AgentSuggestion,
  InviteDraft,
} from "../lib/agentTypes";
import type { MarqueeDirective } from "../lib/marquee";

export interface NavFocus {
  rung: string;
  domainId?: string;
  initiativeId?: string;
  projectId?: string;
}

function uid() {
  return crypto.randomUUID();
}

// The server resends the full history every turn (there's no server-side
// session) — cap how much of it we resend so a long-running conversation
// doesn't keep growing the per-message token cost without bound. The system
// prompt already carries a fresh data snapshot each turn, so older turns
// mostly serve as conversational memory; this many recent turns is plenty.
const MAX_HISTORY_MESSAGES = 24;

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

export function useAgent(range: { start: string; end: string }, navFocus?: NavFocus) {
  const qc = useQueryClient();
  const navFocusRef = useRef(navFocus);
  navFocusRef.current = navFocus;
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The history a turn is sent with is read from here, not from the `messages`
  // closure: `retry` has to rewind the transcript and send in the same tick, and
  // a closure would still be holding the un-rewound array.
  const messagesRef = useRef<AgentMessage[]>(messages);
  messagesRef.current = messages;

  const sendMessage = useCallback(
    async (
      text: string,
      attachments: AgentAttachment[] = [],
      // `display` splits what the user *said* from what Nuvo *hears*: a tapped
      // button renders its own label in the transcript while the resolving text
      // travels unseen. Only the wire half (`content`) is ever sent — the label
      // never reaches the model, so it can't be mistaken for an instruction.
      opts?: { display?: string },
    ) => {
      const trimmed = text.trim();
      const hasAttachments = attachments.length > 0;
      if ((!trimmed && !hasAttachments) || loading) return;

      const userMsg: AgentMessage = {
        id: uid(),
        role: "user",
        content: trimmed,
        at: Date.now(),
        display: opts?.display?.trim() || undefined,
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
        const history = [...messagesRef.current, userMsg]
          .slice(-MAX_HISTORY_MESSAGES)
          .map(toApiMessage);

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
          body: JSON.stringify({
            messages: history,
            rangeStart: range.start,
            rangeEnd: range.end,
            navFocus: navFocusRef.current,
            marqueeTargets: marqueeManifest(),
            // Where the user physically is. The app renders every instant in the
            // device zone (src/lib/timezone.ts), so the agent has to read and
            // write times in that same zone — the edge used to assume Pacific,
            // which silently landed "3pm" two hours late while traveling.
            tz: detectDeviceTz(),
          }),
        });

        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Agent request failed (${res.status})`);
        }

        let finalActions: AgentAction[] | undefined;
        let finalSuggestions: AgentSuggestion[] | undefined;
        let finalInvite: InviteDraft | undefined;

        const handle = (evt: AgentStreamEvent) => {
          if (evt.t === "c") {
            streamed += evt.v;
            ensureAssistant();
            patchAssistant({ content: streamed });
          } else if (evt.t === "d") {
            finalActions = evt.actions?.length ? evt.actions : undefined;
            finalSuggestions = evt.suggestions?.length ? evt.suggestions : undefined;
            const ui = evt.ui as MarqueeDirective | undefined;
            finalInvite = evt.invite;
            const content = (typeof evt.content === "string" && evt.content) || streamed;
            ensureAssistant();
            // "Done." is only honest when the turn actually finished — an
            // exhausted turn falls back to saying so instead.
            const fallback = evt.exhausted
              ? "I ran out of steps before finishing — nothing further was changed."
              : "Done.";
            patchAssistant({
              content: content || fallback,
              actions: finalActions,
              suggestions: finalSuggestions,
              ui,
              invite: finalInvite,
              incomplete: evt.exhausted === true,
            });
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
          // Syncable tables defer behind the drain — the agent wrote through
          // the service role, so its result and this device's queued edits are
          // two concurrent writers and the refetch must not land first.
          invalidateWhenSafe(qc, "tasks", ["tasks"]);
          qc.invalidateQueries({ queryKey: ["external_events"] });
          if (tools.some((t) => isVerticalAgentTool(t))) {
            qc.invalidateQueries({ queryKey: ["vertical"] });
          }
          // Priorities (big rocks) live on the week's sprint record.
          if (tools.some((t) => t.endsWith("_priority"))) {
            invalidateWhenSafe(qc, "sprints", ["sprint"]);
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
    [loading, qc, range.end, range.start],
  );

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  /** Ask the last question again. Rewinds to just before the newest user turn
   *  and re-sends it, so the retried answer REPLACES the one you rejected
   *  instead of piling a duplicate question onto the transcript. */
  const retry = useCallback(() => {
    if (loading) return;
    const msgs = messagesRef.current;
    let i = msgs.length - 1;
    while (i >= 0 && msgs[i].role !== "user") i--;
    if (i < 0) return;
    const target = msgs[i];
    const rewound = msgs.slice(0, i);
    // Set the ref too — sendMessage reads history from it in this same tick.
    messagesRef.current = rewound;
    setMessages(rewound);
    setError(null);
    // Carry the label too — a retried tap is still the same tap, and rewriting
    // it as its raw wire text would put the words back in the user's mouth.
    void sendMessage(target.content, target.attachments ?? [], { display: target.display });
  }, [loading, sendMessage]);

  return { messages, loading, error, sendMessage, clear, retry };
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
