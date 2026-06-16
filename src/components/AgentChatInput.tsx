import { useCallback, useRef, useState, type RefObject } from "react";
import type { AgentAttachment } from "../lib/agentTypes";
import { filesToAttachments, formatBytes, isImageAttachment } from "../lib/agentAttachments";

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

  const canSend = (value.trim() || attachments.length > 0) && !loading;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  };

  return (
    <div className="agent-compose relative">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="agent-attachment-pill group flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 py-1 pl-1 pr-1.5 transition-colors hover:border-accent/40 hover:bg-accent-soft/30"
            >
              {isImageAttachment(a) && a.dataUrl ? (
                <img src={a.dataUrl} alt="" className="h-7 w-7 rounded object-cover" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded bg-surface text-caption">📄</span>
              )}
              <span className="max-w-[100px] truncate text-label text-ink">{a.name}</span>
              <span className="mono text-micro text-muted">{formatBytes(a.size)}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                className="fast ml-0.5 flex h-5 w-5 items-center justify-center rounded text-label text-muted opacity-60 hover:bg-surface hover:text-signal hover:opacity-100"
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {attachError && (
        <p className="mb-1.5 text-meta text-signal">{attachError}</p>
      )}

      <div
        className={`agent-compose-box fast flex items-end gap-2 rounded-xl border border-line bg-surface-2 transition-[border-color,box-shadow,background] focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)] hover:border-line-strong ${
          compact ? "px-2.5 py-2" : "px-3 py-2.5"
        }`}
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          title="Attach files"
          className="agent-attach-btn fast mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-head text-muted transition-colors hover:bg-surface hover:text-accent disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
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
          rows={compact ? 1 : 2}
          disabled={loading}
          autoFocus={autoFocus}
          className={`max-h-32 min-w-0 flex-1 resize-none bg-transparent leading-relaxed outline-none placeholder:text-muted/70 disabled:opacity-50 ${
            compact ? "py-1 text-body" : "py-0.5 text-body"
          }`}
        />

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSend}
          aria-label="Send"
          className="agent-send-btn fast mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-head font-medium text-white shadow-sm transition-[transform,filter,box-shadow] hover:brightness-110 hover:shadow-[0_4px_12px_-4px_var(--accent-glow)] active:translate-y-px disabled:opacity-30 disabled:shadow-none"
        >
          ↑
        </button>
      </div>

      {!compact && (
        <div className="mt-1.5 px-0.5">
          <span className="mono text-meta text-muted">
            Enter to send · Shift+Enter newline · drag files anywhere
          </span>
        </div>
      )}
    </div>
  );
}
