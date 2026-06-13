import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { AgentMessage } from "../../lib/agentTypes";
import type { useAgent } from "../../hooks/useAgent";
import { ASSISTANT_NAME } from "../../lib/assistant";
import Sheet from "./Sheet";

// Full-height chat, reachable from every tab. Reuses the same agent the desktop
// sidebar drives — it can read the day, add tasks, and move blocks.
export default function ChatSheet({
  agent,
  onClose,
}: {
  agent: ReturnType<typeof useAgent>;
  onClose: () => void;
}) {
  const { messages, loading, error, sendMessage, clear } = agent;
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    void sendMessage(text);
  };

  const starters = [
    "What's in my inbox?",
    "Plan my afternoon",
    "What should I prep next?",
    "Move my non-urgent tasks to tomorrow",
  ];

  const title = (
    <span className="flex items-center gap-2">
      {ASSISTANT_NAME}
      <span className="mono text-[11px] font-normal text-muted">your planner</span>
    </span>
  );

  return (
    <Sheet onClose={onClose} title={title} tall contentClassName="flex flex-col">
      {messages.length > 0 && (
        <div className="flex shrink-0 justify-end px-4 pb-1">
          <button onClick={clear} className="fast text-[12px] text-muted hover:text-ink">
            Clear
          </button>
        </div>
      )}

      <div className="mobile-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-2">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-3 px-2 pt-8 text-center">
            <p className="text-[14px] text-muted">
              Ask about your day, add tasks, or reschedule blocks.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {starters.map((s) => (
                <button
                  key={s}
                  onClick={() => void sendMessage(s)}
                  className="fast rounded-full border border-line px-3 py-1.5 text-[12.5px] text-muted hover:border-accent hover:text-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {loading && (
          <div className="agent-bubble agent-bubble-assistant w-fit">
            <span className="mono shimmer text-[12px]">Thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="shrink-0 border-t border-line bg-signal-soft px-4 py-2 text-[12px] text-signal">
          {error}
        </div>
      )}

      <div className="shrink-0 border-t border-line p-3">
        <div className="fast flex items-end gap-2 rounded-2xl border border-line bg-surface-2 px-3 py-2 focus-within:border-accent">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={`Ask ${ASSISTANT_NAME}…`}
            disabled={loading}
            className="max-h-28 min-h-[24px] min-w-0 flex-1 resize-none bg-transparent py-1 text-[16px] outline-none placeholder:text-muted/70 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            aria-label="Send"
            className="tap fast flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-[16px] text-white active:translate-y-px disabled:opacity-30"
          >
            ↑
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function Bubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`agent-bubble max-w-[88%] ${isUser ? "agent-bubble-user" : "agent-bubble-assistant"}`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{message.content}</p>
        ) : (
          <div className="agent-markdown text-[14px] leading-relaxed">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {message.actions && message.actions.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-line/50 pt-2">
            {message.actions.map((a) => (
              <li key={a.summary} className="mono text-[11px] text-muted">
                ✓ {a.summary}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
