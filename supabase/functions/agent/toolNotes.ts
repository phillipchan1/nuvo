// The instructions a tool RESULT carries — the ones that only make sense in the
// moment the result lands, and would be noise on every other turn.
//
// They live here, alone and importable, for one reason: the conformance battery
// scripts tool results, so a scenario that types its own `note` is grading the
// chat against a weaker instruction than the deployed tool actually sends. That
// is the same drift the kernel and prompt.ts already exist to prevent, one
// layer down. tools.ts sends these; tests/agent/scenarios.ts imports the same
// constants. Neither can quietly get ahead of the other.
//
// Zero imports, zero Deno globals.

/** A `propose_invite` result whose `unresolved` list is non-empty.
 *
 *  The failure this exists for: the tool came back with `Matt Hansen` and
 *  `Matt Reyes` in hand, and the chat replied "Which Matt?" — throwing away
 *  both the names and the taps. The prompt already said to offer the
 *  candidates; prose in a 400-line system message lost to a result object that
 *  said nothing. Saying it AT the result is what made it stick. */
export const UNRESOLVED_RECIPIENTS_NOTE =
  "Some names did not resolve. Do NOT ask a bare question like \"Which Matt?\" — you already have the answer to it. " +
  "Name each candidate in the reply (first and last name where there is one, no email addresses in the prose), and end " +
  "the message with a <suggestions> block containing ONE suggestion per candidate, so the user taps instead of typing. " +
  "Everyone who DID resolve stays staged — one unknown name does not restart the invite.\n" +
  // The loop this closes, 2026-08-02: a contact known only from a past meeting
  // has no display name, so "ryan weeks" fuzzy-matched ryancweeks@gmail.com and
  // came back unresolved. The chat asked, the user tapped "Use Ryan Weeks", the
  // agent re-called with that same name — which runs the identical failing
  // match — and asked again. The question was unanswerable in the terms it was
  // asked; only pasting the address ever worked.
  "CRITICAL — each suggestion's \"message\" must contain the candidate's EXACT email address, because a name that just " +
  "failed to resolve will fail again on the retry. \"Use Matt Reyes\" is a dead end; \"Use mreyes@acme.example\" resolves. " +
  "The address belongs in the tappable message (it is a tool argument, not prose); the sentence above it stays human.\n" +
  "A query with exactly ONE candidate is not a choice — it is a confirmation. Say who you have and that it is the only " +
  "match, rather than asking \"which one\", and offer the single tap that confirms them by address.";

/** The standing half of a `propose_invite` result: nothing has happened yet. */
export const INVITE_STAGED_NOTE =
  "Nothing has been created or sent — the event does not exist yet. A confirmation card is now in the chat with " +
  "Send invite / Add without emailing, and the event is created when they tap. Tell them it's there in one line, " +
  "naming who and when.";

/** The `mode: "add_guests"` variant — the event already exists. */
export const INVITE_GUESTS_STAGED_NOTE =
  "Nothing has been sent. A confirmation card is now in the chat with Send invite / Add without emailing. " +
  "Tell them it's there in one line.";

/** Compose a staged-invite note. Keeping the two halves separate means the
 *  unresolved instruction is byte-identical wherever it appears. */
export function inviteNote(base: string, unresolvedCount: number): string {
  return unresolvedCount > 0 ? `${base} ${UNRESOLVED_RECIPIENTS_NOTE}` : base;
}
