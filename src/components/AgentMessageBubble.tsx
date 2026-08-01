import ReactMarkdown from "react-markdown";
import AgentActions from "./AgentRecordCards";
import type { AgentMessage } from "../lib/agentTypes";
import { formatBytes, isImageAttachment } from "../lib/agentAttachments";

export default function AgentMessageBubble({
  message,
  compact,
}: {
  message: AgentMessage;
  compact?: boolean;
}) {
  const isUser = message.role === "user";
  const textSize = compact ? "text-caption" : "text-body";
  // A bubble hugs its text, but record cards are structure, not prose — left to
  // hug, they squeeze into a narrow column with dead space beside them. A reply
  // that carries records takes the full width.
  const hasRecords = message.actions?.some((a) => a.ref) ?? false;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`agent-bubble ${hasRecords ? "w-full" : "max-w-[90%]"} ${isUser ? "agent-bubble-user" : "agent-bubble-assistant"}`}
      >
        {message.attachments && message.attachments.length > 0 && (
          <div className={`mb-2 flex flex-wrap gap-1.5 ${message.content ? "" : ""}`}>
            {message.attachments.map((a) =>
              isImageAttachment(a) && a.dataUrl ? (
                <a
                  key={a.id}
                  href={a.dataUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="agent-attachment-thumb group block overflow-hidden rounded-md border border-line/60"
                >
                  <img
                    src={a.dataUrl}
                    alt={a.name}
                    className="max-h-36 max-w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                </a>
              ) : (
                <span
                  key={a.id}
                  className="agent-attachment-chip mono flex items-center gap-1.5 rounded-md border border-line/60 bg-surface px-2 py-1 text-meta text-muted"
                >
                  <span aria-hidden>📄</span>
                  <span className="max-w-[140px] truncate">{a.name}</span>
                  <span className="text-line">{formatBytes(a.size)}</span>
                </span>
              ),
            )}
          </div>
        )}

        {message.content ? (
          isUser ? (
            <p className={`whitespace-pre-wrap leading-relaxed ${textSize}`}>{message.content}</p>
          ) : (
            <div className={`agent-markdown leading-relaxed ${textSize}`}>
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )
        ) : null}

        {message.actions && message.actions.length > 0 && (
          <AgentActions actions={message.actions} />
        )}

        {/* A turn that ran out of steps carries a visible mark. Without it the
            synthesized "Created X. Scheduled Y." reads exactly like success and
            the dropped remainder is never noticed. Hairline + --signal, no
            frame — it's a state of this reply, not a card of its own. */}
        {message.incomplete && (
          <p className="text-meta mt-2 border-t border-[--line] pt-2 text-[--signal]">
            Unfinished — I hit my step limit with work still queued.
          </p>
        )}
      </div>
    </div>
  );
}
