import { lazy, Suspense, useState } from "react";
import { Icon } from "./Icon";
import { IconButton } from "./kit";
// react-markdown (plus its unified/remark tail) is ~107 KB that only chat
// replies render — lazy so opening the app doesn't parse it. The fallback is
// the raw text, so a reply streaming in before the chunk lands is still
// readable, just unformatted for a frame.
const ReactMarkdown = lazy(() => import("react-markdown"));
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

  return (
    <div className={`agent-turn-actions ${compact ? "" : "opacity-0"}`}>
      <IconButton
        size="xs"
        label={copied ? "Copied" : "Copy reply"}
        icon={<Icon name={copied ? "check" : "copy"} size={13} />}
        onClick={copy}
        className="tap-icon"
      />
      {onRetry && <IconButton size="xs" label="Try again" icon={<Icon name="refresh" size={13} />} onClick={onRetry} className="tap-icon" />}
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

  const attachments = message.attachments?.length ? (
    <div className="agent-attachments">
      {message.attachments.map((a) =>
        isImageAttachment(a) && a.dataUrl ? (
          <a key={a.id} href={a.dataUrl} target="_blank" rel="noreferrer" className="agent-attachment-thumb">
            <img src={a.dataUrl} alt={a.name} />
          </a>
        ) : (
          <span key={a.id} className="k-chip agent-attachment-chip">
            <Icon name="paperclip" size={12} />
            <span>{a.name}</span>
            <span className="agent-attachment-size">{formatBytes(a.size)}</span>
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
      <div className="agent-user">
        {message.display ? (
          <span
            className="agent-bubble-pick"
            // The wire text stays reachable for the curious, and nowhere else.
            title={message.content !== message.display ? message.content : undefined}
          >
            <Icon name="check" size={12} className="agent-bubble-pick-mark" />
            <span className="min-w-0">{message.display}</span>
          </span>
        ) : (
          <div className="agent-bubble agent-bubble-user" data-compact={compact || undefined} data-selectable>
            {attachments}
            {message.content && <p>{message.content}</p>}
          </div>
        )}
        {message.at && <span className="agent-time">{fmtTime(message.at)}</span>}
      </div>
    );
  }

  // What Nuvo says is plain text on the ground — no bubble. A boxed reply reads
  // as a quotation from somewhere else; unboxed it reads as the app talking,
  // and the record cards below it stop looking like a nested frame.
  return (
    <div className="agent-turn group/turn w-full">
      {attachments}

      {message.content && (
        <div className="agent-markdown" data-compact={compact || undefined} data-selectable>
          <Suspense fallback={<span className="whitespace-pre-wrap">{message.content}</span>}>
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </Suspense>
        </div>
      )}

      {message.actions && message.actions.length > 0 && <AgentActions actions={message.actions} />}

      {/* A turn that ran out of steps carries a visible mark. Without it the
          synthesized "Created X. Scheduled Y." reads exactly like success and
          the dropped remainder is never noticed. Hairline + --warn, no frame —
          it's a state of this reply, not a card of its own. */}
      {message.incomplete && <p className="agent-incomplete">Unfinished — I hit my step limit with work still queued.</p>}
      {/* A staged invite — the only thing in a reply that hasn't happened yet. */}
      {message.invite && <AgentInviteCard draft={message.invite} />}

      {message.content && (
        <AgentTurnActions content={message.content} onRetry={onRetry} compact={compact} />
      )}
    </div>
  );
}
