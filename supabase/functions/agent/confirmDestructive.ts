// Cancelling and declining touch other people's calendars, and until now the
// only thing standing between a misread and a cancelled meeting was a sentence
// in the tool description asking the model to confirm first.
//
// This makes it a mechanism. A cancel/decline arrives in two parts:
//
//   1. No confirm_token → nothing is cancelled. The handler returns a proposal
//      plus a token, and the model has to tell the user what it's about to do.
//   2. The token comes back on a LATER turn → the cancel executes.
//
// The turn check is the part that matters. A token minted this turn is refused
// this turn, so the model cannot mint one and spend it in the same breath — the
// only way to reach step 2 is for the turn to end, which means the user saw the
// proposal and replied. That is a real confirmation, not a promised one.
//
// It is a workflow lock, not a security boundary: the user is the one being
// protected, and they already own everything here. So no crypto, no storage —
// the token carries its own scope and is checked structurally.
//
// Zero imports, zero Deno globals.

export const CONFIRMABLE_TOOLS = ["cancel_event", "decline_event", "purge_task"] as const;
export type ConfirmableTool = (typeof CONFIRMABLE_TOOLS)[number];

export function isConfirmable(name: string): name is ConfirmableTool {
  return (CONFIRMABLE_TOOLS as readonly string[]).includes(name);
}

/** What the call is acting on, however the model named it. Every confirmable
 *  tool's target vocabulary is read here, so a token minted for one thing can
 *  never be spent on another. */
export function targetKeyFor(args: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const id = str(args.event_id) || str(args.task_id);
  const title = (str(args.event_title) || str(args.task_title)).toLowerCase();
  return id || title;
}

/** Opaque-ish, but deliberately readable: it shows up in logs and transcripts,
 *  and a token you can read is one you can debug. */
export function mintToken(turnId: string, name: string, target: string): string {
  return `cfm.${turnId}.${name}.${encodeURIComponent(target)}`;
}

export interface ConfirmCheck {
  ok: boolean;
  /** Set when the call must not execute — hand this back to the model. */
  error?: string;
}

/**
 * Decide whether a confirmable call may execute.
 *
 * `turnId` identifies the CURRENT turn. A token minted in this same turn is
 * rejected: the round trip through the user is the whole point.
 */
export function checkConfirmation(
  name: string,
  args: Record<string, unknown>,
  turnId: string,
): ConfirmCheck {
  if (!isConfirmable(name)) return { ok: true };

  const target = targetKeyFor(args);
  const raw = args.confirm_token;
  const token = typeof raw === "string" ? raw.trim() : "";

  const verb = name === "cancel_event" ? "cancel" : "decline";

  if (!token) {
    return {
      ok: false,
      error:
        `Nothing was ${verb === "cancel" ? "cancelled" : "declined"} yet — this needs the user's go-ahead first because it affects other people. ` +
        `Tell them exactly what you're about to ${verb} (name it, with its time), and offer a tappable yes. ` +
        `When they agree, call ${name} again with confirm_token: "${mintToken(turnId, name, target)}".`,
    };
  }

  const expectedPrefix = `cfm.`;
  if (!token.startsWith(expectedPrefix)) {
    return { ok: false, error: `That confirm_token isn't one I issued. Nothing was changed — propose the ${verb} again and use the token from the result.` };
  }

  const parts = token.split(".");
  // cfm . <turnId> . <toolName> . <target>
  const tokenTurn = parts[1] ?? "";
  const tokenTool = parts[2] ?? "";
  const tokenTarget = decodeURIComponent(parts.slice(3).join(".") || "");

  if (tokenTool !== name) {
    return { ok: false, error: `That confirm_token was issued for ${tokenTool || "another action"}, not ${name}. Nothing was changed.` };
  }
  if (tokenTarget !== target) {
    return { ok: false, error: `That confirm_token was issued for a different event. Nothing was changed — propose this one and use its own token.` };
  }
  if (tokenTurn === turnId) {
    return {
      ok: false,
      error:
        `You can't confirm in the same message you proposed in — the user hasn't answered yet. ` +
        `Nothing was changed. Say what you're about to ${verb} and wait for them.`,
    };
  }

  return { ok: true };
}
