import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";
import type { AgentAttachment } from "../../lib/agentTypes";
import type { AgentHandle } from "../../hooks/useAgent";
import { useFileDrop } from "../../hooks/useFileDrop";
import { filesToAttachments } from "../../lib/agentAttachments";
import { agentHints, type AgentHintContext } from "../../lib/agentHints";
import { ASSISTANT_NAME } from "../../lib/assistant";
import AgentChatInput from "../AgentChatInput";
import AgentMessageBubble from "../AgentMessageBubble";
import AgentSuggestionChips from "../AgentSuggestionChips";

// The Nuvo chat body. It rides inside a full-screen overlay summoned by the
// floating ✦ launcher — a permanent action reachable from any screen, not a
// bottom-bar destination. Reuses the same agent the desktop sidebar drives (so
// the conversation persists across screens) — it can read the day, add tasks,
// and move blocks. `hint` is the LIVE screen context, so the starter chips match
// wherever you summoned it from.
export default function ChatPane({
  agent,
  hint,
  onClose,
}: {
  agent: AgentHandle;
  hint: AgentHintContext;
  onClose?: () => void;
}) {
  const hints = useMemo(() => agentHints(hint), [hint]);
  const { messages, loading, error, sendMessage, clear } = agent;
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [otherMode, setOtherMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const kbInset = useKeyboardInset();

  const addFiles = useCallback(async (files: File[]) => {
    const { attachments: next } = await filesToAttachments(files);
    if (next.length) setAttachments((prev) => [...prev, ...next].slice(0, 6));
  }, []);

  const { dragging, dropHandlers } = useFileDrop(addFiles, !loading);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = (text?: string) => {
    const msg = (text ?? input).trim();
    if ((!msg && attachments.length === 0) || loading) return;
    const files = attachments;
    setInput("");
    setAttachments([]);
    setOtherMode(false);
    void sendMessage(msg, files);
  };

  const last = messages[messages.length - 1];
  const activeSuggestions =
    !loading && last?.role === "assistant" && last.suggestions?.length ? last.suggestions : null;

  const focusOther = () => {
    setOtherMode(true);
    setInput("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dropHandlers}>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-accent-soft/75 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-6 py-5 text-center shadow-lg">
            <span className="text-display">↓</span>
            <p className="mt-1 text-body font-medium text-accent">Drop to attach</p>
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-1 pt-2">
        <span className="mono text-label text-muted">{ASSISTANT_NAME} · your planner</span>
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <button onClick={clear} className="fast text-caption text-muted hover:text-ink">
              Clear
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close chat"
              className="tap fast flex h-8 w-8 items-center justify-center rounded-full text-lead text-muted active:bg-surface-2"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="mobile-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2">
        {messages.length === 0 && !loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center">
            <p className="text-head text-muted">{hints.prompt}</p>
            <div className="w-full max-w-sm">
              <AgentSuggestionChips
                suggestions={hints.starters.map((s) => ({ label: s, message: s }))}
                onPick={send}
                onOther={focusOther}
              />
            </div>
          </div>
        ) : (
          <div className="mt-auto space-y-3">
            {messages.map((m) => (
              <AgentMessageBubble key={m.id} message={m} compact />
            ))}
            {loading && last?.role !== "assistant" && (
              <div className="agent-bubble agent-bubble-assistant w-fit">
                <span className="mono shimmer text-caption">Thinking…</span>
              </div>
            )}
            {activeSuggestions && (
              <AgentSuggestionChips
                suggestions={activeSuggestions}
                onPick={send}
                onOther={focusOther}
                disabled={loading}
              />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {error && (
        <div className="shrink-0 border-t border-line bg-signal-soft px-4 py-2 text-caption text-signal">
          {error}
        </div>
      )}

      <div
        className="shrink-0 border-t border-line p-3 pb-safe"
        // Keep the composer above the iOS keyboard (the layout viewport never
        // shrinks for it); the class pb-safe still applies when no keyboard.
        style={kbInset ? { paddingBottom: kbInset + 12 } : undefined}
      >
        <AgentChatInput
          value={input}
          onChange={setInput}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onSubmit={() => send()}
          loading={loading}
          placeholder={otherMode ? "Say something else…" : `Ask ${ASSISTANT_NAME}…`}
          compact
          enterToSend={false}
          inputRef={inputRef}
        />
      </div>
    </div>
  );
}
