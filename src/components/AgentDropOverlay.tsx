import { Icon } from "./Icon";

/** Full-panel file-drop affordance — the whole chat surface is the target. A
 *  flat accent wash with an accent edge and one raised card; nothing blurs. */
export default function AgentDropOverlay({ compact }: { compact?: boolean }) {
  return (
    <div className="agent-drop-zone">
      <div className="k-card agent-drop-zone-card">
        <Icon name="paperclip" size={18} />
        <span>Drop to attach</span>
        {!compact && <small>Images, PDFs, text</small>}
      </div>
    </div>
  );
}
