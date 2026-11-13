import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentAttachment, AgentSuggestion } from "../lib/agentTypes";
import type { AgentHandle } from "../hooks/useAgent";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useVerticalSelector } from "../hooks/useVertical";
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
import { Icon } from "./Icon";
import { Button, IconButton } from "./kit";

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
  const { rung, projectView, initiativeView, tab, focus } = nav;
  // The three names the hints say, not the vertical they come from — the panel
  // sat beside the Schedule re-rendering on every write for strings that never
  // changed.
  const projectName = useVerticalSelector((s) =>
    focus.projectId ? projectById(s.data, focus.projectId)?.name ?? null : null,
  );
  const initiativeName = useVerticalSelector((s) =>
    focus.initiativeId ? initiativeById(s.data, focus.initiativeId)?.name ?? null : null,
  );
  const domainName = useVerticalSelector((s) =>
    focus.domainId ? domainById(s.data, focus.domainId)?.name ?? null : null,
  );

  const hints = useMemo(
    () =>
      agentHints({
        rung,
        projectView,
        initiativeView,
        tab,
        projectName,
        initiativeName,
        domainName,
      }),
    [projectName, initiativeName, domainName, initiativeView, projectView, rung, tab],
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
        className="chat-rail agent-rail-collapsed"
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
          type="button"
          onClick={onToggle}
          title={`Open ${ASSISTANT_NAME} (⌘J)`}
          aria-label={`Open ${ASSISTANT_NAME}`}
          className="chat-rail-btn agent-rail-toggle"
        >
          {/* The walkthrough lights the badge, not the rail: the rail is a
              full-height sliver, and an orb around it is a bar with its ends
              off-screen. This is the thing you actually click. */}
          <span aria-hidden data-teach="nuvo" className="chat-mark">
            <Icon name="sparkles" size={15} />
          </span>
          <span>{ASSISTANT_NAME}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      // No border and no fill: the chat sits on the ground beside the panel
      // (D-190, the frame). The width is fixed so the slot can clip it during
      // the slide instead of squashing the content.
      className="chat agent-rail"
      data-agent-drop=""
      {...dropHandlers}
    >
      {dragging && <AgentDropOverlay />}

      <header className="chat-head">
        <span className="chat-title">
          <span className="chat-mark" aria-hidden>
            <Icon name="sparkles" size={12} />
          </span>
          {ASSISTANT_NAME}
        </span>
        {messages.length > 0 && (
          <Button kind="ghost" size="xs" onClick={clear} title="Clear chat">
            Clear
          </Button>
        )}
        <IconButton label="Collapse" shortcut={["⌘", "J"]} icon={<Icon name="chevron-right" size={16} />} onClick={onToggle} />
      </header>

      <div className="chat-log">
        {messages.length === 0 && !loading ? (
          <div className="chat-empty">
            <p>{hints.prompt}</p>
            <AgentSuggestionChips
              suggestions={hints.starters.map((s) => ({ label: s, message: s }))}
              onPick={pickSuggestion}
              onOther={focusOther}
            />
          </div>
        ) : (
          // Unboxed turns need air — without the bubble edge, a tight gap reads
          // as one run-on paragraph from two different speakers.
          <div className="chat-turns">
            {messages.map((m) => (
              <AgentMessageBubble
                key={m.id}
                message={m}
                onRetry={m.id === retryableId ? retry : undefined}
              />
            ))}
            {loading && last?.role !== "assistant" && <AgentThinking />}
            {activeSuggestions && (
              <AgentSuggestionChips
                suggestions={activeSuggestions}
                onPick={pickSuggestion}
                onOther={focusOther}
                disabled={loading}
              />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* A failure wears --danger, not --signal: this bar used to be the same
          hue as the calendar's now-line and an overdue block. And it carries
          its own "Try again", because the per-message retry only appears under
          the newest ASSISTANT bubble — and a request that dies before one
          streams removes its placeholder, so the exact case where the chat
          failed hardest was the one case with no way back but retyping.
          `retry` rewinds to the last USER turn, so it is the right act here. */}
      {error && (
        <div role="alert" className="chat-error">
          <span>{error}</span>
          {!loading && (
            <Button size="xs" kind="danger" onClick={retry}>
              Try again
            </Button>
          )}
        </div>
      )}

      {/* The walkthrough opens this rail and lights the composer — the place you
          type, not the whole 380px column. */}
      <footer className="chat-foot" data-teach="nuvo-panel">
        <AgentChatInput
          value={input}
          onChange={setInput}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onSubmit={() => submit()}
          loading={loading}
          placeholder={otherMode ? "Say something else…" : `Ask ${ASSISTANT_NAME}…`}
          autoFocus={otherMode}
          inputRef={inputRef}
        />
      </footer>
    </aside>
  );
}
