import type { CalendarAccount } from "../lib/types";
import { supabase } from "../lib/supabase";

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
  const broken = accounts.filter((a) => a.needs_reconnect);
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
    const fn = a.provider === "google" ? "google-oauth" : "m365-oauth";
    window.location.href = `${base}/functions/v1/${fn}?action=start&token=${token}&redirect=${encodeURIComponent(window.location.origin)}`;
  };

  return (
    <div className="flex items-center gap-3 border-b border-signal bg-signal-soft px-4 py-1.5">
      <span className="text-caption font-medium text-signal">
        Calendar sync paused — {broken.map((a) => `${LABEL[a.provider]} (${a.email})`).join(", ")} needs to reconnect.
      </span>
      {broken.map((a) => (
        <button
          key={a.id}
          onClick={() => reconnect(a)}
          className="fast rounded-md border border-signal px-2 py-0.5 text-label font-medium text-signal hover:bg-signal hover:text-white"
        >
          Reconnect {LABEL[a.provider]}
        </button>
      ))}
    </div>
  );
}
