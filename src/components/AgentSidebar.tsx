/**
 * The Nuvo panel (D-198, D-200) — what would help on the page beside it.
 *
 * It was a chat. The chat is gone (D-200): an engine that offers the right next
 * act on the page you're on — draft this project's path, keep this pattern of
 * your week — is worth more than a box you have to think of a question for.
 * Conversation, for anyone who wants it, happens in their own assistant over
 * Nuvo's MCP server (D-112), connected in Settings → Apps & devices.
 *
 * The door is unchanged: the ✦ rail and ⌘J. It wears one dot while there's an
 * offer you haven't seen; opening the panel spends it (and Memory's).
 */

import { useEffect } from "react";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useMemory } from "../hooks/useMemory";
import { ASSISTANT_NAME } from "../lib/assistant";
import { useNuvoOffers } from "./nuvo/useNuvoOffers";
import NuvoOffers from "./nuvo/NuvoOffers";
import { NuvoConnect } from "./nuvo/NuvoConnect";
import { Icon } from "./Icon";
import { IconButton } from "./kit";

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

export default function AgentSidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { nav, openRecord, openOverlay, setSettingsSection } = useAppNavigation();
  const { focus } = nav;
  const memory = useMemory();
  const offers = useNuvoOffers({ memory, projectId: focus.projectId || null });
  const { markSeen } = offers;
  useEffect(() => {
    if (open) markSeen();
  }, [open, markSeen]);

  const connect = () => {
    setSettingsSection("apps");
    openOverlay("settings");
  };

  if (!open) {
    return (
      <aside className="chat-rail agent-rail-collapsed">
        <button
          type="button"
          onClick={onToggle}
          title={`Open ${ASSISTANT_NAME} (⌘J)`}
          aria-label={offers.unseen ? `Open ${ASSISTANT_NAME} · something to show you` : `Open ${ASSISTANT_NAME}`}
          className="chat-rail-btn agent-rail-toggle"
        >
          <span aria-hidden data-teach="nuvo" className="chat-mark" data-dot={offers.unseen ? "" : undefined}>
            <Icon name="sparkles" size={15} />
          </span>
          <span>{ASSISTANT_NAME}</span>
        </button>
      </aside>
    );
  }

  return (
    // No border and no fill: the panel sits on the ground beside the work
    // (D-190, the frame). Fixed width so the slot can clip it in the slide.
    <aside className="chat agent-rail" data-teach="nuvo-panel">
      <header className="chat-head">
        <span className="chat-title">
          <span className="chat-mark" aria-hidden>
            <Icon name="sparkles" size={12} />
          </span>
          {ASSISTANT_NAME}
        </span>
        <IconButton label="Collapse" shortcut={["⌘", "J"]} icon={<Icon name="chevron-right" size={16} />} onClick={onToggle} />
      </header>

      <div className="chat-log nuvo-panel-body">
        {offers.offers.length ? (
          <NuvoOffers state={offers} memory={memory} projectId={focus.projectId || null} onOpenProject={(id) => openRecord("project", id)} />
        ) : (
          <p className="nuvo-quiet">Nothing to offer here. {ASSISTANT_NAME} speaks when it's sure.</p>
        )}
      </div>

      <footer className="chat-foot">
        <NuvoConnect onConnect={connect} />
      </footer>
    </aside>
  );
}
