import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { AgentMessage } from "../lib/agentTypes";
import type { useAgent } from "../hooks/useAgent";
import { ASSISTANT_NAME } from "../lib/assistant";
import { Keycap } from "./ui";

const STORAGE_KEY = "nuvo-agent-open";

export function readAgentOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAgentOpen(open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export default function AgentSidebar({
  agent,
  open,
  onToggle,
}: {
  agent: ReturnType<typeof useAgent>;
  open: boolean;
  onToggle: () => void;
}) {
  const { messages, loading, error, sendMessage, clear } = agent;
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    if (!input.trim() || loading) return;
    const text = input;
    setInput("");
    void sendMessage(text);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  if (!open) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-l border-line bg-surface">
        <button
          onClick={onToggle}
          title={`Open ${ASSISTANT_NAME} (⌘J)`}
          className="fast flex h-full w-full flex-col items-center gap-2 py-3 text-muted hover:text-ink"
        >
          <span className="text-[11px] font-semibold tracking-tight [writing-mode:vertical-rl] rotate-180">
            {ASSISTANT_NAME}
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[13px] font-semibold">{ASSISTANT_NAME}</span>
        <span className="mono text-[10px] text-muted">your planner</span>
        <div className="flex-1" />
        {messages.length > 0 && (
          <button
            onClick={clear}
            className="fast text-[11px] text-muted hover:text-ink"
            title="Clear chat"
          >
            Clear
          </button>
        )}
        <button
          onClick={onToggle}
          className="fast text-[11px] text-muted hover:text-ink"
          title="Collapse (⌘J)"
        >
          <Keycap>⌘J</Keycap>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
        {messages.length === 0 && !loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-[13px] text-muted">
              Ask about your day, add tasks, reschedule blocks…
            </p>
            <p className="mono text-[10px] text-muted/70">
              e.g. &quot;What&apos;s in my inbox?&quot; · &quot;Schedule call David tomorrow 2pm&quot;
            </p>
          </div>
        )}

        <div className="space-y-3">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {loading && (
            <div className="agent-bubble agent-bubble-assistant">
              <span className="mono shimmer text-[11px]">Thinking…</span>
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="shrink-0 border-t border-line bg-signal-soft px-3 py-2 text-[11px] text-signal">
          {error}
        </div>
      )}

      <footer className="shrink-0 border-t border-line p-3">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Nuvo…"
          rows={2}
          disabled={loading}
          className="w-full resize-none rounded-md border border-line bg-surface-2 px-2.5 py-2 text-[13px] outline-none focus:border-accent disabled:opacity-50"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="mono text-[10px] text-muted">Enter to send · Shift+Enter for newline</span>
          <button
            onClick={submit}
            disabled={!input.trim() || loading}
            className="fast rounded-md border border-accent bg-accent px-3 py-1 text-[11px] font-medium text-white shadow-sm hover:brightness-110 active:translate-y-px disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </footer>
    </aside>
  );
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`agent-bubble max-w-[90%] ${isUser ? "agent-bubble-user" : "agent-bubble-assistant"}`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{message.content}</p>
        ) : (
          <div className="agent-markdown text-[13px] leading-relaxed">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {message.actions && message.actions.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-line/50 pt-2">
            {message.actions.map((a) => (
              <li key={a.summary} className="mono text-[10px] text-muted">
                {a.summary}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
