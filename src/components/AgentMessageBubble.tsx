import ReactMarkdown from "react-markdown";
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

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`agent-bubble max-w-[90%] ${isUser ? "agent-bubble-user" : "agent-bubble-assistant"}`}
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
          <ul className="mt-2 space-y-1 border-t border-line/50 pt-2">
            {message.actions.map((a) => (
              <li key={a.summary} className="mono text-meta text-muted">
                ✓ {a.summary}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
