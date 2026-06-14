import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentAttachment } from "../lib/agentTypes";
import type { AgentHandle } from "../hooks/useAgent";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useVertical } from "../hooks/useVertical";
import { useFileDrop } from "../hooks/useFileDrop";
import { filesToAttachments } from "../lib/agentAttachments";
import { domainById, initiativeById, projectById } from "../lib/vertical";
import { agentHints } from "../lib/agentHints";
import { ASSISTANT_NAME } from "../lib/assistant";
import AgentChatInput from "./AgentChatInput";
import AgentMessageBubble from "./AgentMessageBubble";
import AgentSuggestionChips from "./AgentSuggestionChips";
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
  agent: AgentHandle;
  open: boolean;
  onToggle: () => void;
}) {
  const { nav } = useAppNavigation();
  const { data } = useVertical();
  const { rung, projectView, initiativeView, tab, focus } = nav;

  const hints = useMemo(
    () =>
      agentHints({
        rung,
        projectView,
        initiativeView,
        tab,
        projectName: focus.projectId ? projectById(data, focus.projectId)?.name : null,
        initiativeName: focus.initiativeId ? initiativeById(data, focus.initiativeId)?.name : null,
        domainName: focus.domainId ? domainById(data, focus.domainId)?.name : null,
      }),
    [data, focus.domainId, focus.initiativeId, focus.projectId, initiativeView, projectView, rung, tab],
  );

  const { messages, loading, error, sendMessage, clear } = agent;
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [otherMode, setOtherMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const addFiles = useCallback(async (files: File[]) => {
    const { attachments: next, errors } = await filesToAttachments(files);
    if (next.length) setAttachments((prev) => [...prev, ...next].slice(0, 6));
    if (errors.length) console.warn(errors[0]);
  }, []);

  const { dragging, dropHandlers } = useFileDrop(addFiles, open && !loading);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const submit = (text?: string) => {
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

  const pickSuggestion = (message: string) => submit(message);

  const focusOther = () => {
    setOtherMode(true);
    setInput("");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  if (!open) {
    return (
      <aside className="agent-rail-collapsed flex w-11 shrink-0 flex-col items-center border-l border-line bg-surface">
        <button
          onClick={onToggle}
          title={`Open ${ASSISTANT_NAME} (⌘J)`}
          className="agent-rail-toggle fast group flex h-full w-full flex-col items-center gap-2 py-4 text-muted hover:text-accent"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[14px] transition-colors group-hover:bg-accent-soft group-hover:text-accent">
            ✦
          </span>
          <span className="text-[10px] font-semibold tracking-tight [writing-mode:vertical-rl] rotate-180">
            {ASSISTANT_NAME}
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="agent-rail relative flex w-[380px] shrink-0 flex-col border-l border-line bg-surface shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.08)]"
      {...dropHandlers}
    >
      {dragging && (
        <div className="agent-drop-overlay pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-accent-soft/75 backdrop-blur-[3px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-surface/90 px-8 py-6 shadow-lg">
            <span className="text-[28px] opacity-80">↓</span>
            <span className="text-[13px] font-medium text-accent">Drop files to attach</span>
            <span className="mono text-[10px] text-muted">Images, PDFs, text files</span>
          </div>
        </div>
      )}

      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-[12px] text-accent">✦</span>
        <span className="text-[13px] font-semibold">{ASSISTANT_NAME}</span>
        <span className="mono text-[10px] text-muted">your planner</span>
        <div className="flex-1" />
        {messages.length > 0 && (
          <button
            onClick={clear}
            className="fast rounded-md px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-ink"
            title="Clear chat"
          >
            Clear
          </button>
        )}
        <button
          onClick={onToggle}
          className="fast rounded-md px-1.5 py-1 text-muted hover:bg-surface-2 hover:text-ink"
          title="Collapse (⌘J)"
        >
          <Keycap>⌘J</Keycap>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 py-3">
        {messages.length === 0 && !loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center">
            <p className="text-[13px] leading-relaxed text-muted">{hints.prompt}</p>
            <div className="w-full max-w-[300px]">
              <AgentSuggestionChips
                suggestions={hints.starters.map((s) => ({ label: s, message: s }))}
                onPick={pickSuggestion}
                onOther={focusOther}
              />
            </div>
          </div>
        ) : (
          <div className="mt-auto space-y-3">
            {messages.map((m) => (
              <AgentMessageBubble key={m.id} message={m} />
            ))}
            {loading && (
              <div className="agent-bubble agent-bubble-assistant w-fit">
                <span className="mono shimmer text-[11px]">Thinking…</span>
              </div>
            )}
            {activeSuggestions && (
              <div className="pl-0.5">
                <AgentSuggestionChips
                  suggestions={activeSuggestions}
                  onPick={pickSuggestion}
                  onOther={focusOther}
                  disabled={loading}
                />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {error && (
        <div className="shrink-0 border-t border-line bg-signal-soft px-3.5 py-2 text-[11px] text-signal">
          {error}
        </div>
      )}

      <footer className="shrink-0 border-t border-line p-3">
        <AgentChatInput
          value={input}
          onChange={setInput}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onSubmit={() => submit()}
          loading={loading}
          placeholder={otherMode ? "Say something else…" : "Ask Nuvo…"}
          autoFocus={otherMode}
          inputRef={inputRef}
        />
      </footer>
    </aside>
  );
}
