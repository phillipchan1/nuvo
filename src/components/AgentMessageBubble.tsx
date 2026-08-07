import { useState } from "react";
import { Icon } from "./Icon";
import ReactMarkdown from "react-markdown";
import AgentActions from "./AgentRecordCards";
import AgentInviteCard from "./AgentInviteCard";
import type { AgentMessage } from "../lib/agentTypes";
import { formatBytes, isImageAttachment } from "../lib/agentAttachments";

function fmtTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}


/** Quiet per-turn actions. Hover-revealed on desktop; always visible on touch,
 *  where there is no hover to reveal them with (golden rule 4). */
function AgentTurnActions({
  content,
  onRetry,
  compact,
}: {
  content: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable (insecure context) — the button just does nothing */
    }
  };

  const btn =
    "tap-icon fast flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink";

  return (
    <div
      className={`agent-turn-actions mt-1.5 flex items-center gap-0.5 ${compact ? "" : "opacity-0"}`}
    >
      <button onClick={copy} className={btn} title={copied ? "Copied" : "Copy reply"} aria-label="Copy reply">
        {copied ? (
          <Icon name="check" size={13} />
        ) : (
          <Icon name="copy" size={13} />
        )}
      </button>
      {onRetry && (
        <button onClick={onRetry} className={btn} title="Try again" aria-label="Try again">
          <Icon name="refresh" size={13} />
        </button>
      )}
    </div>
  );
}

export default function AgentMessageBubble({
  message,
  compact,
  onRetry,
}: {
  message: AgentMessage;
  compact?: boolean;
  /** Present only on the newest assistant turn — retrying an older one would
   *  silently discard every exchange after it. */
  onRetry?: () => void;
}) {
  const isUser = message.role === "user";
  const textSize = compact ? "text-caption" : "text-body";

  const attachments = message.attachments?.length ? (
    <div className="mb-2 flex flex-wrap gap-1.5">
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
  ) : null;

  // What you said is a quotation — it keeps its bubble, tucked to the right.
  // What you *tapped* is not a quotation: the transcript records the choice
  // (the words on the button) as a pick, while the resolving text underneath it
  // — an address, an initiative, a constructed paragraph — goes to Nuvo unseen.
  // Speaking for the user is worse than saying nothing (D-087).
  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        {message.display ? (
          <span
            className="agent-bubble-pick max-w-[85%] text-caption"
            // The wire text stays reachable for the curious, and nowhere else.
            title={message.content !== message.display ? message.content : undefined}
          >
            <span aria-hidden className="agent-bubble-pick-mark">✓</span>
            <span className="min-w-0 leading-snug">{message.display}</span>
          </span>
        ) : (
          <div className="agent-bubble agent-bubble-user max-w-[85%]">
            {attachments}
            {message.content && (
              <p className={`whitespace-pre-wrap leading-relaxed ${textSize}`}>{message.content}</p>
            )}
          </div>
        )}
        {message.at && <span className="mono text-micro text-muted">{fmtTime(message.at)}</span>}
      </div>
    );
  }

  // What Nuvo says is the page itself — no bubble. A reply boxed in --surface-2
  // reads as a quotation from somewhere else; on the paper it reads as the app
  // talking, and the record cards below it stop looking like a nested frame.
  return (
    <div className="agent-turn group/turn w-full">
      {attachments}

      {message.content && (
        <div className={`agent-markdown leading-relaxed ${textSize}`}>
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      )}

      {message.actions && message.actions.length > 0 && <AgentActions actions={message.actions} />}

      {/* A turn that ran out of steps carries a visible mark. Without it the
          synthesized "Created X. Scheduled Y." reads exactly like success and
          the dropped remainder is never noticed. Hairline + --signal, no
          frame — it's a state of this reply, not a card of its own. */}
      {message.incomplete && (
        <p className="text-meta mt-2 border-t border-[--line] pt-2 text-[--signal]">
          Unfinished — I hit my step limit with work still queued.
        </p>
      )}
      {/* A staged invite — the only thing in a reply that hasn't happened yet. */}
      {message.invite && <AgentInviteCard draft={message.invite} />}

      {message.content && (
        <AgentTurnActions content={message.content} onRetry={onRetry} compact={compact} />
      )}
    </div>
  );
}
