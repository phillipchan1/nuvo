import { useMemo, useRef, useState } from "react";
import { useEffect } from "react";
import { parseCapture } from "../lib/nlp";
import type { Label } from "../lib/types";
import type { NewTaskInput } from "../hooks/useTasks";
import { Keycap, Modal } from "./ui";

export interface Command {
  id: string;
  title: string;
  run: () => void;
}

export default function CommandBar({
  labels,
  commands,
  onCreate,
  onClose,
}: {
  labels: Label[];
  commands: Command[];
  onCreate: (input: NewTaskInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const parsed = useMemo(() => (text.trim() ? parseCapture(text) : null), [text]);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.title.toLowerCase().includes(q));
  }, [text, commands]);

  // Row 0 = capture (when text present); command rows follow.
  const rows = (parsed ? 1 : 0) + matches.length;

  const submit = async () => {
    const captureActive = parsed && highlight === 0;
    if (captureActive) {
      const labelIds = parsed.labels
        .map((n) => labels.find((l) => l.name.toLowerCase() === n.toLowerCase())?.id)
        .filter((id): id is string => Boolean(id));
      await onCreate({
        title: parsed.title || text.trim(),
        do_date: parsed.doDate,
        start_time: parsed.startTime?.toISOString() ?? null,
        duration_minutes: parsed.durationMinutes,
        priority: parsed.priority,
        labelIds,
      });
      onClose();
    } else {
      const cmd = matches[highlight - (parsed ? 1 : 0)];
      if (cmd) {
        onClose();
        cmd.run();
      }
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(rows - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  const chipColor = (kind: string) =>
    kind === "label" ? "var(--accent)" : kind === "priority" ? "var(--signal)" : "var(--muted)";

  return (
    <Modal onClose={onClose} width="max-w-xl">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKey}
          placeholder='Capture or command… "review PR tomorrow 2pm 45m #work !high"'
          className="w-full bg-transparent py-3 text-[14px] outline-none placeholder:text-muted/60"
        />
        <Keycap>esc</Keycap>
      </div>

      {parsed && (
        <button
          onClick={() => void submit()}
          onMouseEnter={() => setHighlight(0)}
          className={`flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-left ${
            highlight === 0 ? "bg-accent-soft" : ""
          }`}
        >
          <span className="text-[11px] font-semibold text-accent">＋</span>
          <span className="min-w-0 flex-1 truncate text-[13px]">{parsed.title || text.trim()}</span>
          {parsed.chips.map((c, i) => (
            <span
              key={i}
              className="mono shrink-0 border px-1 py-px text-[10px]"
              style={{ borderColor: chipColor(c.kind), color: chipColor(c.kind) }}
            >
              {c.text}
            </span>
          ))}
        </button>
      )}

      <div className="max-h-72 overflow-y-auto py-1">
        {matches.map((c, i) => {
          const idx = i + (parsed ? 1 : 0);
          return (
            <button
              key={c.id}
              onClick={() => {
                onClose();
                c.run();
              }}
              onMouseEnter={() => setHighlight(idx)}
              className={`flex w-full items-center px-3 py-2 text-left text-[13px] ${
                highlight === idx ? "bg-accent-soft" : ""
              }`}
            >
              {c.title}
            </button>
          );
        })}
        {matches.length === 0 && !parsed && (
          <div className="px-3 py-3 text-[12px] text-muted">Type to capture a task or run a command.</div>
        )}
      </div>
    </Modal>
  );
}
