// The confirmation that stands between the agent and someone else's inbox.
//
// The agent can resolve who "Matt" is, pick the hour, choose the calendar and
// stage all of it — but it cannot send. This card is where an invite becomes
// real, and it exists for the reason D-046 gives: a button labelled "Create"
// must never be the thing that mails three humans. So the recipients are named
// (a count is not a who), the two honest outcomes are separate buttons, and the
// write runs through the same mutations the grid composer uses — a tap here and
// a tap there produce the same event.
//
// Nothing about the draft is trusted as state: it's a proposal until the user
// acts on it, and once they have, the card stops being a control and becomes a
// receipt.
//
// A kit Card (D-190): the event as its title, the guests as hairline rows, the
// two outcomes as kit Buttons, primary first.
import { useState } from "react";
import { toast } from "sonner";
import { useExternalEventMutations } from "../hooks/useCalendar";
import { fmtDayLabel, fmtDuration, fmtTime } from "../lib/dates";
import { Icon } from "./Icon";
import { Button, IconButton } from "./kit";
import {
  QUIET_HINT,
  inviteConsentPrompt,
  sourceLabel,
  type InviteDraft,
} from "../../supabase/functions/_shared/invites.ts";

/** The calendar date an instant falls on, in the viewer's zone. */
function localDateISO(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}

/** A short label from the RRULE lines the invite carries — good enough to
 *  confirm "yes, this repeats" before sending; the full picker lives on the
 *  calendar once the series exists. */
function recurrenceLabel(rrule: string[] | undefined): string | null {
  const line = rrule?.[0];
  if (!line) return null;
  const freq = /FREQ=(\w+)/.exec(line)?.[1];
  if (!freq) return null;
  const interval = Number(/INTERVAL=(\d+)/.exec(line)?.[1] ?? 1);
  const unit = freq === "DAILY" ? "day" : freq === "WEEKLY" ? "week" : "month";
  return interval > 1 ? `Every ${interval} ${unit}s` : `Every ${unit}`;
}

function whenLine(draft: InviteDraft): string | null {
  if (!draft.startAt) return null;
  const day = fmtDayLabel(localDateISO(draft.startAt));
  const time = fmtTime(draft.startAt);
  if (!draft.endAt) return `${day} · ${time}`;
  const mins = Math.round((new Date(draft.endAt).getTime() - new Date(draft.startAt).getTime()) / 60_000);
  return `${day} · ${time} · ${fmtDuration(mins)}`;
}

type Phase = "idle" | "working" | "sent" | "quiet" | "dismissed";

export default function AgentInviteCard({ draft }: { draft: InviteDraft }) {
  const { createEvent, inviteToEvent } = useExternalEventMutations();
  const [dropped, setDropped] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const recipients = draft.recipients.filter((r) => !dropped.includes(r.email));
  const when = whenLine(draft);
  const unresolved = draft.unresolved ?? [];

  const run = async (notifyGuests: boolean) => {
    if (!recipients.length || phase === "working") return;
    setPhase("working");
    setError(null);
    const attendees = recipients.map((r) => r.email);
    try {
      if (draft.mode === "add_guests") {
        if (!draft.eventId) throw new Error("This invite lost its event — open the event and add them there.");
        await inviteToEvent({ id: draft.eventId, attendees, notifyGuests });
      } else {
        await createEvent({
          title: draft.title,
          start_at: draft.startAt!,
          end_at: draft.endAt!,
          recurrence: draft.recurrence,
          attendees,
          accountId: draft.accountId,
          calendarId: draft.calendarId,
          location: draft.location,
          notifyGuests,
          addMeet: draft.addMeet,
        });
      }
      setPhase(notifyGuests ? "sent" : "quiet");
      toast.success(
        notifyGuests
          ? `Invite sent to ${attendees.length === 1 ? recipients[0].name ?? attendees[0] : `${attendees.length} guests`}`
          : `Added ${attendees.length === 1 ? "1 guest" : `${attendees.length} guests`} — no email sent`,
      );
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Couldn't do that — try the event on your calendar.");
    }
  };

  if (phase === "dismissed") return null;

  // Settled: what happened, not what could. The card keeps its place in the
  // transcript so scrolling back tells the truth about what was sent.
  if (phase === "sent" || phase === "quiet") {
    const names = draft.recipients.filter((r) => !dropped.includes(r.email)).map((r) => r.name ?? r.email);
    return (
      <div className="k-card agent-card agent-invite">
        <div className="agent-card-top">
          <Icon name="check" size={14} />
          <div className="agent-card-main">
            <div className="agent-card-title">
              {phase === "sent" ? "Invite sent" : "Added quietly"} · {draft.title}
            </div>
            <div className="agent-card-sub">
              {names.join(", ")}
              {phase === "quiet" ? " — no email went out" : ""}
              {when ? ` · ${when}` : ""}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const busy = phase === "working";

  return (
    <div className="k-card agent-card agent-invite">
      {/* What is being proposed — the event first, so the recipients have a
          subject. On add_guests the event already exists; say which. */}
      <div className="agent-card-top">
        <div className="agent-card-main">
          <div className="agent-card-title">{draft.title}</div>
          <div className="agent-card-sub">
            {[when, recurrenceLabel(draft.recurrence), draft.calendarName, draft.location, draft.addMeet ? "Google Meet" : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <IconButton size="xs" label="Dismiss" icon={<Icon name="close" size={12} />} onClick={() => setPhase("dismissed")} className="tap-icon" />
      </div>

      {/* Who. Named, removable, and honest about where the address came from —
          "met before" is a weaker claim than an address book and reads that way. */}
      <ul className="agent-invite-list">
        {recipients.map((r) => (
          <li key={r.email} className="agent-invite-row">
            {/* Two lines, not one: at rail width a single line truncates the
                address, and the address is the part that decides who actually
                gets the mail. The name can be missing; the address never is. */}
            <span className="agent-invite-who">
              {r.name && <span className="agent-invite-name">{r.name}</span>}
              <span className={r.name ? "agent-invite-mail" : "agent-invite-name"}>{r.email}</span>
            </span>
            <span className="agent-invite-src">{r.known ? r.sources.map(sourceLabel).join(" · ") : "not in contacts"}</span>
            <IconButton
              size="xs"
              label={`Remove ${r.name ?? r.email}`}
              icon={<Icon name="close" size={12} />}
              onClick={() => setDropped((d) => [...d, r.email])}
              disabled={busy}
              className="tap-icon"
            />
          </li>
        ))}
      </ul>

      {unresolved.length > 0 && (
        <p className="agent-card-sub">
          Still unplaced: {unresolved.map((u) => `"${u.query}"`).join(", ")} — answer above and I'll add them. Sending now goes to the{" "}
          {recipients.length} listed.
        </p>
      )}

      {error && <p className="agent-card-sub text-danger">{error}</p>}

      {/* The consent sentence, shared with the composer so both doors say the
          same thing, then the two outcomes as separate buttons. */}
      <div className="agent-card-foot agent-invite-foot">
        <p className="agent-card-sub">
          {recipients.length
            ? inviteConsentPrompt({ mode: draft.mode, count: recipients.length, addMeet: draft.addMeet })
            : "Nobody left on this invite."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" size="md" className="tap flex-1" onClick={() => run(true)} disabled={busy || !recipients.length}>
            {busy ? "Sending…" : recipients.length > 1 ? `Send to ${recipients.length}` : "Send invite"}
          </Button>
          <Button size="md" className="tap flex-1" onClick={() => run(false)} disabled={busy || !recipients.length} title={QUIET_HINT}>
            Add without emailing
          </Button>
        </div>
      </div>
    </div>
  );
}
