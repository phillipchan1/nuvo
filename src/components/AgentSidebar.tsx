import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentAttachment, AgentSuggestion } from "../lib/agentTypes";
import type { AgentHandle } from "../hooks/useAgent";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useVertical } from "../hooks/useVertical";
import { useFileDrop, isFileDrag } from "../hooks/useFileDrop";
import { filesToAttachments } from "../lib/agentAttachments";
import { domainById, initiativeById, projectById } from "../lib/vertical";
import { agentHints } from "../lib/agentHints";
import { ASSISTANT_NAME } from "../lib/assistant";
import AgentChatInput from "./AgentChatInput";
import AgentDropOverlay from "./AgentDropOverlay";
import AgentMessageBubble from "./AgentMessageBubble";
import AgentSuggestionChips from "./AgentSuggestionChips";
import AgentThinking from "./AgentThinking";
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

  const { messages, loading, error, sendMessage, clear, retry } = agent;
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

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  /** `display` is set only when the turn came from a tap — it's the words on the
   *  button, and it replaces the wire text in the transcript (D-087). */
  const submit = (text?: string, display?: string) => {
    const msg = (text ?? input).trim();
    if ((!msg && attachments.length === 0) || loading) return;
    const files = attachments;
    setInput("");
    setAttachments([]);
    setOtherMode(false);
    void sendMessage(msg, files, { display });
  };

  const last = messages[messages.length - 1];
  // Only the newest reply offers "try again" — retrying an older one would
  // silently discard every exchange after it.
  const retryableId = !loading && last?.role === "assistant" ? last.id : null;
  const activeSuggestions =
    !loading && last?.role === "assistant" && last.suggestions?.length ? last.suggestions : null;

  const pickSuggestion = (s: AgentSuggestion) => submit(s.message, s.label);

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
      <aside
        className="agent-rail-collapsed flex h-full w-11 shrink-0 flex-col items-center"
        onDragEnter={(e) => {
          if (isFileDrag(e)) {
            e.preventDefault();
            onToggle();
          }
        }}
        onDragOver={(e) => {
          if (isFileDrag(e)) e.preventDefault();
        }}
      >
        <button
          onClick={onToggle}
          title={`Open ${ASSISTANT_NAME} (⌘J)`}
          aria-label={`Open ${ASSISTANT_NAME}`}
          className="agent-rail-toggle fast group flex h-full w-full flex-col items-center gap-2.5 py-4 text-muted hover:text-accent"
        >
          {/* The walkthrough lights the badge, not the rail: the rail is a
              full-height sliver, and an orb around it is a bar with its ends
              off-screen. This is the thing you actually click. */}
          <span
            aria-hidden
            data-teach="nuvo"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-[18px] leading-none text-accent transition-colors group-hover:bg-accent/15"
          >
            ✦
          </span>
          <span className="text-meta font-semibold tracking-tight [writing-mode:vertical-rl] rotate-180">
            {ASSISTANT_NAME}
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      // No border and no fill: this is not a pane beside the app, it is the
      // shell the app is resting on. A divider here would flatten the two
      // planes back into one. The width is fixed so the slot can clip it
      // during the slide instead of squashing the content.
      className="agent-rail relative flex h-full min-h-0 w-[380px] shrink-0 flex-col"
      data-agent-drop=""
      {...dropHandlers}
    >
      {dragging && <AgentDropOverlay />}

      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-caption text-accent">✦</span>
        <span className="text-body font-semibold">{ASSISTANT_NAME}</span>
        <span className="mono text-meta text-muted">your planner</span>
        <div className="flex-1" />
        {messages.length > 0 && (
          <button
            onClick={clear}
            className="fast rounded-md px-2 py-1 text-label text-muted hover:bg-surface-2 hover:text-ink"
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
            <p className="text-body leading-relaxed text-muted">{hints.prompt}</p>
            <div className="w-full max-w-[300px]">
              <AgentSuggestionChips
                suggestions={hints.starters.map((s) => ({ label: s, message: s }))}
                onPick={pickSuggestion}
                onOther={focusOther}
              />
            </div>
          </div>
        ) : (
          // Unboxed turns need air — without the bubble edge, 12px reads as one
          // run-on paragraph from two different speakers.
          <div className="mt-auto space-y-5">
            {messages.map((m) => (
              <AgentMessageBubble
                key={m.id}
                message={m}
                onRetry={m.id === retryableId ? retry : undefined}
              />
            ))}
            {loading && last?.role !== "assistant" && <AgentThinking />}
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
        <div className="shrink-0 border-t border-line bg-signal-soft px-3.5 py-2 text-label text-signal">
          {error}
        </div>
      )}

      {/* The walkthrough opens this rail and lights the composer — the place you
          type, not the whole 380px column. */}
      <footer className="shrink-0 border-t border-line p-3" data-teach="nuvo-panel">
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
