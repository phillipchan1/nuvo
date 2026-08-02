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
  "Name each candidate in the reply (first and last name, no email addresses in the prose), and end the message with a " +
  "<suggestions> block containing ONE suggestion per candidate, so the user taps instead of typing. Everyone who DID " +
  "resolve stays staged — one unknown name does not restart the invite.";

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
