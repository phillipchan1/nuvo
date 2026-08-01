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
import { useState } from "react";
import { toast } from "sonner";
import { useExternalEventMutations } from "../hooks/useCalendar";
import { fmtDayLabel, fmtDuration, fmtTime } from "../lib/dates";
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
      <div className="glass-card mt-2 rounded-lg border border-line/60 px-3 py-2.5">
        <div className="text-caption text-ink">
          {phase === "sent" ? "Invite sent" : "Added quietly"} · <span className="font-medium">{draft.title}</span>
        </div>
        <div className="mt-1 text-micro text-muted">
          {names.join(", ")}
          {phase === "quiet" ? " — no email went out" : ""}
          {when ? ` · ${when}` : ""}
        </div>
      </div>
    );
  }

  const busy = phase === "working";

  return (
    <div className="glass-card mt-2 rounded-lg border border-line/60 px-3 py-3">
      {/* What is being proposed — the event first, so the recipients have a
          subject. On add_guests the event already exists; say which. */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-caption font-medium text-ink">{draft.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-muted">
            {when && <span>{when}</span>}
            {draft.calendarName && <span>· {draft.calendarName}</span>}
            {draft.location && <span>· {draft.location}</span>}
            {draft.addMeet && <span>· Google Meet</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPhase("dismissed")}
          aria-label="Dismiss"
          className="fast tap -mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink md:h-8 md:w-8"
        >
          ✕
        </button>
      </div>

      {/* Who. Named, removable, and honest about where the address came from —
          "met before" is a weaker claim than an address book and reads that way. */}
      <ul className="mt-2.5 space-y-1">
        {recipients.map((r) => (
          <li
            key={r.email}
            className="flex items-center gap-2 rounded-md border border-line/60 bg-surface-2/60 px-2 py-1.5"
          >
            {/* Two lines, not one: at rail width a single line truncates the
                address, and the address is the part that decides who actually
                gets the mail. The name can be missing; the address never is. */}
            <span className="flex min-w-0 flex-1 flex-col">
              {r.name && <span className="truncate text-micro text-ink">{r.name}</span>}
              <span className={`truncate text-micro ${r.name ? "text-muted" : "text-ink"}`}>{r.email}</span>
            </span>
            <span className="shrink-0 text-micro text-muted/70">
              {r.known ? r.sources.map(sourceLabel).join(" · ") : "not in contacts"}
            </span>
            <button
              type="button"
              onClick={() => setDropped((d) => [...d, r.email])}
              disabled={busy}
              aria-label={`Remove ${r.name ?? r.email}`}
              className="fast tap -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted hover:text-signal disabled:opacity-40 md:-my-1.5 md:h-8 md:w-8"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      {unresolved.length > 0 && (
        <div className="mt-2 rounded-md border border-dashed border-line px-2 py-1.5 text-micro text-muted">
          Still unplaced:{" "}
          {unresolved.map((u) => `"${u.query}"`).join(", ")} — answer above and I'll add them. Sending now goes to the{" "}
          {recipients.length} listed.
        </div>
      )}

      {error && <div className="mt-2 text-micro text-signal">{error}</div>}

      {/* The consent sentence, shared with the composer so both doors say the
          same thing, then the two outcomes as separate buttons. */}
      <div className="mt-3 border-t border-line/60 pt-2.5">
        <div className="text-micro text-muted">
          {recipients.length
            ? inviteConsentPrompt({ mode: draft.mode, count: recipients.length, addMeet: draft.addMeet })
            : "Nobody left on this invite."}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run(true)}
            disabled={busy || !recipients.length}
            className="fast tap inline-flex flex-1 items-center justify-center rounded-[var(--radius)] bg-accent px-3 py-2.5 text-caption font-semibold text-white shadow-[var(--shadow-1)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Sending…" : recipients.length > 1 ? `Send to ${recipients.length}` : "Send invite"}
          </button>
          <button
            type="button"
            onClick={() => run(false)}
            disabled={busy || !recipients.length}
            title={QUIET_HINT}
            className="fast tap inline-flex flex-1 items-center justify-center rounded-[var(--radius)] border border-line px-3 py-2.5 text-caption font-medium text-ink hover:bg-surface-2 disabled:opacity-40"
          >
            Add without emailing
          </button>
        </div>
      </div>
    </div>
  );
}
