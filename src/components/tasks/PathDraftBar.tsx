/**
 * The one strip a draft carries while it's open (Draft the path, D-193): how
 * many steps are drafted, a line to steer the rest, Discard rest and Keep all.
 * It floats (a solid float, `--sh-pop`) at the foot of the list so Keep all is
 * in reach however long the list is — the list itself stays flat.
 *
 * Steering is free text, so dictation works (a plain `<input>`, CLAUDE.md); the
 * three chips are the steers people reach for, not a menu of the only ones.
 */

import { useRef } from "react";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { STEERS } from "../../lib/pathDraft";
import { Icon } from "../Icon";
import { Button, ChipButton, Input, Kbd } from "../kit";
import type { PathDraft } from "./usePathDraft";

export default function PathDraftBar({ draft, keys }: { draft: PathDraft; keys: boolean }) {
  const local = useRef<HTMLInputElement | null>(null);
  if (draft.phase === "idle") return null;

  const reading = draft.phase === "reading" || draft.phase === "streaming";
  const send = (text: string) => {
    if (!text.trim()) return;
    void draft.steer(text);
    if (local.current) local.current.value = "";
  };

  return (
    <div className="path-draft-bar" role="region" aria-label="Drafted steps">
      {draft.phase === "reading" && <div className="path-draft-reading" role="progressbar" aria-label="Drafting" />}
      {reading ? (
        <div className="path-draft-line">
          <span className="path-draft-status">
            {draft.phase === "reading" ? `${ASSISTANT_NAME} is reading the outcome and your steps…` : "Drafting…"}
          </span>
          <Button size="xs" kind="ghost" onClick={draft.discard} shortcut={keys ? "esc" : undefined}>
            Stop
          </Button>
        </div>
      ) : draft.phase === "done" ? (
        <div className="path-draft-line">
          <span className="path-draft-status">
            {draft.kept
              ? `Kept ${draft.kept} step${draft.kept === 1 ? "" : "s"} in the backlog. None went on a week.`
              : "Draft put away. Your list is as it was."}
          </span>
        </div>
      ) : (
        <>
          <div className="path-draft-line">
            <span className="path-draft-status">
              <b className="mono">{draft.remaining}</b> drafted
              {draft.kept ? (
                <>
                  {" · "}
                  <b className="mono">{draft.kept}</b> kept
                </>
              ) : null}
            </span>
            <Input
              ref={(el) => {
                local.current = el;
                draft.steerRef.current = el;
              }}
              size="sm"
              frameClassName="path-draft-steer"
              placeholder="Steer the rest — smaller steps, skip the research…"
              aria-label="Steer the drafted steps"
              icon={<Icon name="sparkles" size={13} />}
              trailing={keys ? <Kbd keys="/" /> : undefined}
              autoComplete="off"
              enterKeyHint="send"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  send(e.currentTarget.value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                }
              }}
            />
            <div className="path-draft-commit">
              <Button size="sm" kind="ghost" onClick={draft.discard} shortcut={keys ? "esc" : undefined}>
                Discard rest
              </Button>
              <Button size="sm" kind="primary" onClick={draft.keepAll} shortcut={keys ? ["⇧", "↵"] : undefined}>
                Keep all
              </Button>
            </div>
          </div>
          <div className="path-draft-chips" role="group" aria-label="Steers">
            {STEERS.map((s) => (
              <ChipButton key={s} onClick={() => send(s)}>
                {s}
              </ChipButton>
            ))}
          </div>
          {draft.message && <p className="path-draft-msg">{draft.message}</p>}
        </>
      )}
    </div>
  );
}
