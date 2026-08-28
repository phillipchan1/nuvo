import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";
import { useRaiseKeyboard } from "../../hooks/useRaiseKeyboard";
import type { AgentAttachment, AgentSuggestion } from "../../lib/agentTypes";
import type { AgentHandle } from "../../hooks/useAgent";
import { useFileDrop } from "../../hooks/useFileDrop";
import { filesToAttachments } from "../../lib/agentAttachments";
import { agentHints, type AgentHintContext } from "../../lib/agentHints";
import { ASSISTANT_NAME } from "../../lib/assistant";
import AgentChatInput from "../AgentChatInput";
import AgentDropOverlay from "../AgentDropOverlay";
import AgentMessageBubble from "../AgentMessageBubble";
import AgentSuggestionChips from "../AgentSuggestionChips";
import AgentThinking from "../AgentThinking";

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
  // Same composer-first landing as MobileCapture — in-app ✦ is a gesture;
  // the lock-screen widget is not. See useRaiseKeyboard / D-115.
  useRaiseKeyboard(inputRef);

  // Swipe-down-to-dismiss on the handle + header — the ✕ sits top-right,
  // opposite the ✦ launcher that opened this (bottom-right thumb zone), so
  // it's a full-screen reach to close on a big phone. Same pointer-drag
  // technique as Sheet.tsx's grab pill (Tauri's webview swallows HTML5
  // drag-and-drop — pointer events only), kept local to this one overlay
  // rather than sharing Sheet's gesture code, since this panel is full-
  // screen with no scrim of its own to coordinate.
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number } | null>(null);

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY };
  };
  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !panelRef.current) return;
    const down = Math.max(0, e.clientY - drag.current.startY);
    panelRef.current.style.transition = "none";
    panelRef.current.style.transform = `translateY(${down}px)`;
  };
  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !panelRef.current) return;
    const delta = Math.max(0, e.clientY - drag.current.startY);
    drag.current = null;
    const threshold = panelRef.current.offsetHeight * 0.25;
    if (delta > threshold) {
      panelRef.current.style.transition = "transform 0.22s ease-in";
      panelRef.current.style.transform = "translateY(100%)";
      setTimeout(() => onClose?.(), 220);
    } else {
      panelRef.current.style.transition = "transform 0.22s ease-out";
      panelRef.current.style.transform = "translateY(0)";
    }
  };
  const dragHandleProps = {
    onPointerDown: onHandlePointerDown,
    onPointerMove: onHandlePointerMove,
    onPointerUp: onHandlePointerUp,
    onPointerCancel: onHandlePointerUp,
    style: { touchAction: "none" as const },
  };

  const addFiles = useCallback(async (files: File[]) => {
    const { attachments: next } = await filesToAttachments(files);
    if (next.length) setAttachments((prev) => [...prev, ...next].slice(0, 6));
  }, []);

  const { dragging, dropHandlers } = useFileDrop(addFiles, !loading);

  // Follow the conversation only when the user is already reading the tail —
  // scrolling up to reread an earlier message must never be yanked back down.
  // While a reply is streaming the follow is instant (smooth scrolling on every
  // token reads as jitter).
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const nearBottom =
      scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight) < 80;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: loading ? "auto" : "smooth" });
    }
  }, [messages, loading]);

  /** `display` is set only when the turn came from a tap — see AgentSidebar. */
  const send = (text?: string, display?: string) => {
    const msg = (text ?? input).trim();
    if ((!msg && attachments.length === 0) || loading) return;
    const files = attachments;
    setInput("");
    setAttachments([]);
    setOtherMode(false);
    void sendMessage(msg, files, { display });
  };

  const pickSuggestion = (s: AgentSuggestion) => send(s.message, s.label);

  const last = messages[messages.length - 1];
  // Only the newest reply offers "try again" — see AgentSidebar.
  const retryableId = !loading && last?.role === "assistant" ? last.id : null;
  const activeSuggestions =
    !loading && last?.role === "assistant" && last.suggestions?.length ? last.suggestions : null;

  const focusOther = () => {
    setOtherMode(true);
    setInput("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div
      ref={panelRef}
      className="relative flex min-h-0 flex-1 flex-col"
      data-agent-drop=""
      {...dropHandlers}
    >
      {dragging && <AgentDropOverlay compact />}

      {/* Grab handle — swipe down anywhere here (or the header row below) to
          close. Reaching the ✕ means crossing the whole screen from the ✦
          launcher's bottom-right thumb zone; this puts dismissal within
          reach of wherever a thumb already is after opening the chat. */}
      {onClose && (
        <div {...dragHandleProps} className="flex shrink-0 cursor-grab flex-col items-center pb-1 pt-1.5">
          <span className="h-1 w-9 rounded-full bg-line-strong" />
        </div>
      )}

      <div {...(onClose ? dragHandleProps : {})} className="flex shrink-0 items-center justify-between gap-2 px-4 pb-1 pt-1">
        <span className="mono text-label text-muted">{ASSISTANT_NAME} · your planner</span>
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <button
              onClick={clear}
              onPointerDown={(e) => e.stopPropagation()}
              className="fast text-caption text-muted hover:text-ink"
            >
              Clear
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Close chat"
              className="tap-icon fast flex h-8 w-8 items-center justify-center rounded-full text-lead text-muted active:bg-surface-2"
              style={{ cursor: "default" }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div ref={scrollerRef} className="mobile-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2">
        {messages.length === 0 && !loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center">
            <p className="text-head text-muted">{hints.prompt}</p>
            <div className="w-full max-w-sm">
              <AgentSuggestionChips
                suggestions={hints.starters.map((s) => ({ label: s, message: s }))}
                onPick={pickSuggestion}
                onOther={focusOther}
              />
            </div>
          </div>
        ) : (
          <div className="mt-auto space-y-5">
            {messages.map((m) => (
              <AgentMessageBubble
                key={m.id}
                message={m}
                compact
                onRetry={m.id === retryableId ? agent.retry : undefined}
              />
            ))}
            {loading && last?.role !== "assistant" && <AgentThinking compact />}
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
