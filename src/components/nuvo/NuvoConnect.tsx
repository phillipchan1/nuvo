/**
 * The way to talk to Nuvo now that the in-app chat is gone (D-200): from your
 * own assistant, over Nuvo's MCP server (D-112). One quiet card at the foot of
 * the Nuvo panel and the phone's Nuvo sheet; the act opens Settings → Apps &
 * devices, where the Full account token is minted and the steps are listed.
 * "MCP" is the protocol, never the name (P11).
 */

import { Button } from "../kit";

export function NuvoConnect({ onConnect, phone = false }: { onConnect: () => void; phone?: boolean }) {
  return (
    <div className="nuvo-connect" data-phone={phone ? "" : undefined}>
      <p className="nuvo-connect-say">Talk to your week from your own assistant</p>
      <p className="nuvo-connect-sub">Claude, ChatGPT, Cursor or anything else that connects to apps can read and plan your Nuvo.</p>
      <Button kind="secondary" size="sm" onClick={onConnect}>
        Connect an assistant
      </Button>
    </div>
  );
}
