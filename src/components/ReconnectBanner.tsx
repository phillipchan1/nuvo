import type { CalendarAccount } from "../lib/types";
import { supabase } from "../lib/supabase";
import { Icon } from "./Icon";
import { Button } from "./kit";

const LABEL: Record<CalendarAccount["provider"], string> = {
  google: "Google",
  m365: "Microsoft 365",
  ics: "Subscribed calendar",
  icloud: "Apple Calendar",
};

export default function ReconnectBanner({
  accounts,
  onManualReconnect,
}: {
  accounts: CalendarAccount[];
  /** Open Settings → Calendars, where non-OAuth providers (ICS/iCloud) reconnect. */
  onManualReconnect?: () => void;
}) {
  // Microsoft 365 is no longer offered, so there is nothing to reconnect it to;
  // a leftover account stays disconnectable in Settings → Calendars.
  const broken = accounts.filter((a) => a.needs_reconnect && a.provider !== "m365");
  if (broken.length === 0) return null;

  const reconnect = async (a: CalendarAccount) => {
    // ICS and iCloud aren't OAuth — their credential is re-entered in Settings.
    if (a.provider === "ics" || a.provider === "icloud") {
      onManualReconnect?.();
      return;
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const base = import.meta.env.VITE_SUPABASE_URL;
    window.location.href = `${base}/functions/v1/google-oauth?action=start&token=${token}&redirect=${encodeURIComponent(window.location.origin)}`;
  };

  // A bar across the top of the work, in the kit's voice: what stopped, whose
  // account, and the one act that fixes it. `--danger`, never `--signal`
  // (which means "now").
  return (
    <div className="k-banner" role="status">
      <Icon name="refresh" size={14} />
      <span className="k-banner-text">
        <b>Calendar sync paused</b>{" "}
        <span>— {broken.map((a) => `${LABEL[a.provider]} (${a.email})`).join(", ")} needs to reconnect.</span>
      </span>
      {broken.map((a) => (
        <Button key={a.id} size="xs" onClick={() => reconnect(a)}>
          Reconnect {LABEL[a.provider]}
        </Button>
      ))}
    </div>
  );
}
