import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp } from "lucide-react";
import { Icon } from "./Icon";
import { IconButton } from "./kit";
import type { AgentAttachment } from "../lib/agentTypes";
import { filesToAttachments, formatBytes, isImageAttachment } from "../lib/agentAttachments";

// The chat's composer — a kit field (D-190) that grows with what you write,
// an attach button on its left and the send IconButton on its right. Shared by
// the desktop rail and the phone's chat pane (`compact`).

export default function AgentChatInput({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  onSubmit,
  loading,
  placeholder,
  compact,
  autoFocus,
  enterToSend = true,
  inputRef: externalInputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  attachments: AgentAttachment[];
  onAttachmentsChange: (a: AgentAttachment[]) => void;
  onSubmit: () => void;
  loading?: boolean;
  placeholder?: string;
  compact?: boolean;
  autoFocus?: boolean;
  // Physical keyboards (desktop) send on Enter, newline on Shift+Enter. Touch
  // keyboards (iOS/Android) have no Shift+Enter, so Return should just insert a
  // newline and sending goes through the send button — set this false there.
  enterToSend?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement>;
}) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = externalInputRef ?? internalRef;
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setAttachError(null);
      const { attachments: next, errors } = await filesToAttachments(files);
      if (errors.length) setAttachError(errors[0]);
      if (next.length) onAttachmentsChange([...attachments, ...next].slice(0, 6));
    },
    [attachments, onAttachmentsChange],
  );

  const removeAttachment = (id: string) => {
    onAttachmentsChange(attachments.filter((a) => a.id !== id));
  };

  // Grow the textarea to fit its content (like Claude/ChatGPT) up to the CSS
  // max-height, past which the field scrolls internally.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, inputRef]);

  const canSend = (value.trim() || attachments.length > 0) && !loading;

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Don't submit while an IME candidate window is open (e.g. CJK, dictation),
    // and only treat Enter as "send" when a physical keyboard is in play.
    if (
      enterToSend &&
      e.key === "Enter" &&
      !e.shiftKey &&
      !(e.nativeEvent as { isComposing?: boolean }).isComposing
    ) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  };

  return (
    <div className="agent-compose">
      {attachments.length > 0 && (
        <div className="agent-attachments">
          {attachments.map((a) => (
            <div key={a.id} className="agent-attachment-pill">
              {isImageAttachment(a) && a.dataUrl ? (
                <img src={a.dataUrl} alt="" />
              ) : (
                <span className="agent-attachment-glyph" aria-hidden>
                  <Icon name="paperclip" size={12} />
                </span>
              )}
              <span className="agent-attachment-name">{a.name}</span>
              <span className="agent-attachment-size">{formatBytes(a.size)}</span>
              <IconButton
                size="xs"
                label={`Remove ${a.name}`}
                icon={<Icon name="close" size={12} />}
                onClick={() => removeAttachment(a.id)}
                className="tap-icon"
              />
            </div>
          ))}
        </div>
      )}

      {attachError && <p className="agent-attach-error">{attachError}</p>}

      <div className="k-field agent-compose-box" data-multiline="" data-compact={compact || undefined}>
        <IconButton
          size={compact ? "md" : "sm"}
          label="Attach files"
          icon={<Icon name="paperclip" size={compact ? 16 : 14} />}
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="agent-attach-btn tap-icon"
        />
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,.txt,.md,.csv,.json,.pdf,text/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />

        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={loading}
          autoFocus={autoFocus}
          aria-label={placeholder ?? "Message"}
        />

        <IconButton
          kind="primary"
          size={compact ? "md" : "sm"}
          label="Send"
          shortcut={enterToSend ? "↵" : undefined}
          icon={<ArrowUp size={compact ? 16 : 14} strokeWidth={2} aria-hidden />}
          onClick={onSubmit}
          disabled={!canSend}
          className="agent-send-btn tap-icon"
        />
      </div>
    </div>
  );
}
