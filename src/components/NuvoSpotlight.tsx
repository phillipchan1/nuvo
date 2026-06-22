import { useEffect, useMemo, useRef, useState } from "react";
import { parseCapture } from "../lib/nlp";
import type { Label } from "../lib/types";
import type { NewTaskInput } from "../hooks/useTasks";
import type { AgentHandle } from "../hooks/useAgent";
import { ASSISTANT_NAME } from "../lib/assistant";
import AgentMessageBubble from "./AgentMessageBubble";
import AgentSuggestionChips from "./AgentSuggestionChips";
import { Keycap, Modal } from "./ui";

export interface Command {
  id: string;
  title: string;
  run: () => void;
}

type Mode = "capture" | "ask";

export interface SpotlightProps {
  labels: Label[];
  commands: Command[];
  onCreate: (input: NewTaskInput) => Promise<unknown>;
  agent: AgentHandle;
  onClose: () => void;
  /**
   * Run a command and close the palette in one non-racing step. Preferred over
   * `onClose(); cmd.run()` because closing via `history.back()` fires an async
   * popstate that would revert the command's own navigation (e.g. a flow set by
   * the command gets clobbered → "command does nothing"). Optional so the
   * standalone macOS window can still fall back to onClose + run.
   */
  onRunCommand?: (cmd: Command) => void;
}

// What Nuvo can answer in Ask mode — phrased as the things you'd actually
// reach for at a hotkey: "tell me about my day", "am I free on X".
const ASK_STARTERS = [
  "What does my day look like?",
  "Am I free Thursday afternoon?",
  "What should I prep for next?",
  "Move my afternoon to tomorrow",
];

// In-app entry (⌘K): the panel inside the responsive Modal scrim. The global
// macOS hotkey renders the same NuvoSpotlightPanel standalone in a floating
// window instead (see SpotlightWindow.tsx) — one component, two shells.
export default function NuvoSpotlight(props: SpotlightProps) {
  return (
    <Modal onClose={props.onClose} width="max-w-xl">
      <NuvoSpotlightPanel {...props} />
    </Modal>
  );
}

// The morphing capture + ask panel. Capture parses free text into a task or
// runs a command; Ask hands the same text to the Nuvo agent. Space on an empty
// capture field flips to Ask; Backspace on an empty Ask field flips back.
// Renders bare (no scrim / no card chrome) so a Modal or a window can wrap it.
export function NuvoSpotlightPanel({ labels, commands, onCreate, agent, onClose, onRunCommand }: SpotlightProps) {
  const runCmd = (cmd: Command) => {
    if (onRunCommand) onRunCommand(cmd);
    else {
      onClose();
      cmd.run();
    }
  };
  const [mode, setMode] = useState<Mode>("capture");
  const [captureText, setCaptureText] = useState("");
  const [askText, setAskText] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, loading, error, sendMessage } = agent;

  useEffect(() => inputRef.current?.focus(), [mode]);
  useEffect(() => {
    if (mode === "ask") bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, mode]);

  // ── Capture mode ──────────────────────────────────────────────────────────
  const parsed = useMemo(
    () => (captureText.trim() ? parseCapture(captureText) : null),
    [captureText],
  );

  const matches = useMemo(() => {
    const q = captureText.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.title.toLowerCase().includes(q));
  }, [captureText, commands]);

  const rows = (parsed ? 1 : 0) + matches.length;

  const runCapture = async () => {
    const captureRow = parsed && highlight === 0;
    if (captureRow) {
      const labelIds = parsed.labels
        .map((n) => labels.find((l) => l.name.toLowerCase() === n.toLowerCase())?.id)
        .filter((id): id is string => Boolean(id));
      await onCreate({
        title: parsed.title || captureText.trim(),
        do_date: parsed.doDate,
        start_time: parsed.startTime?.toISOString() ?? null,
        duration_minutes: parsed.durationMinutes,
        priority: parsed.priority,
        labelIds,
      });
      onClose();
    } else {
      const cmd = matches[highlight - (parsed ? 1 : 0)];
      if (cmd) runCmd(cmd);
    }
  };

  // ── Ask mode ──────────────────────────────────────────────────────────────
  const sendAsk = (text?: string) => {
    const msg = (text ?? askText).trim();
    if (!msg || loading) return;
    setAskText("");
    void sendMessage(msg);
  };

  const last = messages[messages.length - 1];
  const activeSuggestions =
    !loading && last?.role === "assistant" && last.suggestions?.length ? last.suggestions : null;

  // ── Shared input handling ───────────────────────────────────────────────
  const text = mode === "capture" ? captureText : askText;
  const setText = (v: string) => (mode === "capture" ? setCaptureText(v) : setAskText(v));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    // Space on an empty capture field → Ask; Backspace on an empty Ask field → Capture.
    if (e.key === " " && mode === "capture" && captureText === "") {
      e.preventDefault();
      setMode("ask");
      return;
    }
    if (e.key === "Backspace" && mode === "ask" && askText === "") {
      e.preventDefault();
      setMode("capture");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "capture") void runCapture();
      else sendAsk();
      return;
    }
    if (mode === "capture") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(rows - 1, h + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
      }
    }
  };

  const chipColor = (kind: string) =>
    kind === "label" ? "var(--accent)" : kind === "priority" ? "var(--signal)" : "var(--muted)";

  const isAsk = mode === "ask";

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line/50 px-4">
        <span className={`shrink-0 text-body leading-none ${isAsk ? "text-accent" : "text-accent/70"}`}>
          {isAsk ? "✦" : "＋"}
        </span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKey}
          placeholder={
            isAsk
              ? `Ask ${ASSISTANT_NAME} — "what does my day look like?"`
              : 'Capture or command… "review PR tomorrow 2pm 45m #work !high"'
          }
          className="w-full bg-transparent py-4 text-head outline-none placeholder:text-muted/50"
        />
        <Keycap>esc</Keycap>
      </div>

      {/* Mode toggle — tappable on touch, plus the Space / Backspace accelerators */}
      <div className="flex items-center gap-1 border-b border-line/50 bg-[color-mix(in_srgb,var(--bg)_18%,transparent)] px-2 py-1.5">
        <ModeTab active={!isAsk} onClick={() => setMode("capture")} icon="⚡" label="Capture" />
        <ModeTab active={isAsk} onClick={() => setMode("ask")} icon="✦" label={`Ask ${ASSISTANT_NAME}`} />
        <span className="mono ml-auto pr-1.5 text-meta text-muted/50">
          {isAsk ? "⌫ capture" : "space to ask"}
        </span>
      </div>

      {isAsk ? (
        <div className="flex max-h-[60vh] min-h-[8rem] flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {messages.length === 0 && !loading ? (
              <div className="flex flex-col gap-2.5 py-1">
                <p className="text-caption text-muted">
                  Ask about your day, your week, or what's free — or tell {ASSISTANT_NAME} to move things around.
                </p>
                <AgentSuggestionChips
                  suggestions={ASK_STARTERS.map((s) => ({ label: s, message: s }))}
                  onPick={(m) => sendAsk(m)}
                  onOther={() => inputRef.current?.focus()}
                />
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((m) => (
                  <AgentMessageBubble key={m.id} message={m} compact />
                ))}
                {loading && (
                  <div className="agent-bubble agent-bubble-assistant w-fit">
                    <span className="mono shimmer text-label">Thinking…</span>
                  </div>
                )}
                {activeSuggestions && (
                  <AgentSuggestionChips
                    suggestions={activeSuggestions}
                    onPick={(m) => sendAsk(m)}
                    onOther={() => inputRef.current?.focus()}
                    disabled={loading}
                  />
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
          {error && (
            <div className="shrink-0 border-t border-line/50 bg-signal-soft/80 px-4 py-2 text-label text-signal">
              {error}
            </div>
          )}
        </div>
      ) : (
        <>
          {parsed && (
            <button
              onClick={() => void runCapture()}
              onMouseEnter={() => setHighlight(0)}
              className={`fast flex w-full items-center gap-2 border-b border-line/50 px-4 py-2.5 text-left ${
                highlight === 0
                  ? "bg-[color-mix(in_srgb,var(--accent)_7%,var(--surface)_60%)]"
                  : "hover:bg-[color-mix(in_srgb,var(--surface)_35%,transparent)]"
              }`}
            >
              <span className="shrink-0 text-caption text-accent">＋</span>
              <span className="min-w-0 flex-1 truncate text-body">{parsed.title || captureText.trim()}</span>
              {parsed.chips.map((c, i) => (
                <span
                  key={i}
                  className="mono shrink-0 rounded border px-1.5 py-px text-meta"
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
                  onClick={() => runCmd(c)}
                  onMouseEnter={() => setHighlight(idx)}
                  className={`fast flex w-full items-center px-4 py-2.5 text-left text-body transition-colors ${
                    highlight === idx ? "bg-accent-soft text-ink" : "text-ink/75 hover:bg-accent-soft/50"
                  }`}
                >
                  {c.title}
                </button>
              );
            })}
            {matches.length === 0 && !parsed && (
              <div className="px-4 py-3 text-caption text-muted/70">
                Type to capture a task{commands.length ? ", run a command," : ""} or press space to ask {ASSISTANT_NAME}.
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`tap fast flex items-center gap-1.5 rounded-md px-2.5 py-1 text-label font-medium transition-all ${
        active
          ? "bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface)_65%)] text-accent"
          : "text-muted/70 hover:text-ink"
      }`}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );
}
