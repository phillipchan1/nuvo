// The phone's hand-off (D-250): the same act as the desktop menu's "Hand to …",
// inside the task sheet. One tap opens one optional line; the agent's replies
// (done · back, with its note) read here, because the phone has no menu to
// carry them.

import { useState } from "react";
import type { Task } from "../../lib/types";
import { agentName, useHandoffActs, useHandoffAgents, useTaskHandoffs, type HandoffAgent } from "../../hooks/useHandoff";
import { isHandedOff } from "../../../supabase/functions/_shared/handoff";
import { Button, Input } from "../kit";
import { ActionRow, RowList, SheetSection } from "./sheetKit";

const OUTCOME_WORD: Record<string, string> = { done: "Done", back: "Handed back", recalled: "Taken back", open: "With" };

export function MobileHandoff({ task, onDone }: { task: Task; onDone?: () => void }) {
  const { data: agents = [] } = useHandoffAgents();
  const acts = useHandoffActs();
  const { data: history = [] } = useTaskHandoffs(task.id, Boolean(task.handed_to) || agents.length > 0);
  const [picking, setPicking] = useState<HandoffAgent | null>(null);
  const [note, setNote] = useState("");

  const out = isHandedOff(task);
  const done = task.status === "done";
  const replies = history.filter((h) => h.outcome !== "open" && h.agent_note);
  if (task.parent_task_id || (!agents.length && !replies.length && !task.handed_to)) return null;

  const who = (id: string) => agentName(agents, id) ?? "an agent";

  return (
    <SheetSection label="Hand-off">
      {replies.slice(0, 2).map((h) => (
        <p key={h.id} className="text-body pb-2" data-selectable="">
          <span className="text-muted">
            {OUTCOME_WORD[h.outcome]} · {who(h.connection_id)}:{" "}
          </span>
          {h.agent_note}
        </p>
      ))}
      {picking ? (
        <form
          className="flex flex-col gap-2 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            void acts.hand(task, picking, note);
            setPicking(null);
            onDone?.();
          }}
        >
          <Input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`A line for ${picking.name}`}
            aria-label={`Note for ${picking.name}`}
            enterKeyHint="send"
          />
          <div className="flex gap-2">
            <Button kind="primary" className="tap flex-1" type="submit">
              Hand to {picking.name}
            </Button>
            <Button kind="secondary" className="tap" type="button" onClick={() => setPicking(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <RowList>
          {out ? (
            <ActionRow
              icon="user"
              label={`With ${who(task.handed_to!)} · Take back`}
              onClick={() => void acts.recall(task, agents.find((a) => a.id === task.handed_to) ?? null)}
            />
          ) : (
            !done &&
            agents.map((a) => (
              <ActionRow
                key={a.id}
                icon="user"
                label={`Hand to ${a.name}…`}
                onClick={() => {
                  setNote("");
                  setPicking(a);
                }}
              />
            ))
          )}
        </RowList>
      )}
    </SheetSection>
  );
}
