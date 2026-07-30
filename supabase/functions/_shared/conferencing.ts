// Video conferencing — one rule for whether a new event gets a Google Meet
// link, and one reader for where that link lives on a Google event.
//
// Google Calendar's "automatically add Google Meet video conferences" setting is
// a property of *their web UI*, not of the account: it is never applied to
// events created through the API. So an event booked from Nuvo never had a Meet
// link — not hidden, not dropped by the read path, simply never requested. Every
// create path (grid composer, agent chat) runs the rule below, so a meeting
// booked by dragging the grid and one booked by asking Nuvo come out identical.
//
// Zero imports, pure — imported by the browser (src/) and by edge functions.

/** How aggressively new events get a Meet link (user_settings.auto_add_meet). */
export type MeetPreference = "guests" | "always" | "never";

/** Guests-only: a meeting with someone gets a room, a solo block doesn't. */
export const DEFAULT_MEET_PREFERENCE: MeetPreference = "guests";

export function normalizeMeetPreference(value: unknown): MeetPreference {
  return value === "always" || value === "never" || value === "guests"
    ? value
    : DEFAULT_MEET_PREFERENCE;
}

/**
 * Whether a NEW event should be created with a Meet link, given the account's
 * preference and how many guests it has. The caller can always override with an
 * explicit choice — this is only what happens when nobody says.
 */
export function shouldAddMeet(preference: unknown, guestCount: number): boolean {
  switch (normalizeMeetPreference(preference)) {
    case "always":
      return true;
    case "never":
      return false;
    case "guests":
      return guestCount > 0;
  }
}

/**
 * The `conferenceData` body that asks Google to mint a Meet link.
 *
 * Two things make this work and both are easy to miss: the request must carry
 * `conferenceDataVersion=1` (without it Google silently ignores the whole
 * field), and `requestId` must be unique per attempt — Google dedupes retries
 * by it, so reusing one returns the *previous* conference instead of a new one.
 */
export function meetCreateRequest(requestId: string) {
  return {
    conferenceData: {
      createRequest: {
        requestId,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };
}

/** The shape we read off a Google event — a subset of the API resource. */
export interface ConferenceCarrier {
  hangoutLink?: string;
  conferenceData?: {
    conferenceSolution?: { name?: string };
    entryPoints?: Array<{ entryPointType?: string; uri?: string; label?: string }>;
  } | null;
}

/**
 * The URL that joins the meeting, or null. `conferenceData` is the modern field;
 * `hangoutLink` is the legacy one Google still sets on older events (and on some
 * events created by other clients), so reading only the first misses meetings
 * that genuinely have a link.
 */
export function joinUrl(raw: ConferenceCarrier | null | undefined): string | null {
  const video = raw?.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === "video" && ep.uri,
  );
  return video?.uri ?? raw?.hangoutLink ?? null;
}

/** "Google Meet", "Zoom Meeting"… — what the join button should say. */
export function conferenceName(raw: ConferenceCarrier | null | undefined): string {
  return raw?.conferenceData?.conferenceSolution?.name ?? "meeting";
}

/** True when the event already has somewhere to meet — don't offer to add one. */
export function hasConference(raw: ConferenceCarrier | null | undefined): boolean {
  return joinUrl(raw) !== null;
}
