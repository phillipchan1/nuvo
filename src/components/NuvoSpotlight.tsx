import { useEffect, useMemo, useRef, useState } from "react";
import { parseCapture } from "../lib/nlp";
import type { Label } from "../lib/types";
import type { NewTaskInput } from "../hooks/useTasks";
import type { AgentHandle } from "../hooks/useAgent";
import { ASSISTANT_NAME } from "../lib/assistant";
import AgentMessageBubble from "./AgentMessageBubble";
import AgentSuggestionChips from "./AgentSuggestionChips";
import { Keycap, Modal } from "./ui";

const NAME = "Phil";

// Time-of-day greeting, in the same editorial register as Today's masthead.
function greetingFor(d: Date) {
  const h = d.getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${NAME}.`;
}

// What pressing Enter will actually do — its destination — so the capture
// preview reads "Add to Inbox" / "Add to Tomorrow" instead of just echoing
// back the text you typed (which the input already shows).
function destinationLabel(doDate: string | null): string {
  if (!doDate) return "Add to Inbox";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${doDate}T00:00:00`);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Add to Today";
  if (diff === 1) return "Add to Tomorrow";
  if (diff >= 2 && diff <= 6) return `Add to ${d.toLocaleDateString([], { weekday: "long" })}`;
  return `Schedule ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export interface Command {
  id: string;
  title: string;
  run: () => void;
}

/** A found record — structurally a Command (so it runs through the same close
 *  path) plus the metadata to render it grouped under its kind. */
export interface SearchHit extends Command {
  kind: "task" | "project" | "initiative" | "domain";
  subtitle?: string;
}

type Mode = "capture" | "ask";

const HIT_SECTIONS: { kind: SearchHit["kind"]; label: string; cap: number }[] = [
  { kind: "task", label: "Tasks", cap: 6 },
  { kind: "project", label: "Projects", cap: 6 },
  { kind: "initiative", label: "Initiatives", cap: 6 },
  { kind: "domain", label: "Domains", cap: 4 },
];

const HIT_GLYPH: Record<SearchHit["kind"], string> = {
  task: "✓",
  project: "◆",
  initiative: "▲",
  domain: "❖",
};

export interface SpotlightProps {
  labels: Label[];
  commands: Command[];
  /** The searchable vertical — tasks/projects/initiatives/domains. Filtered here
   *  by the typed query. Optional so the standalone macOS window can omit it. */
  searchHits?: SearchHit[];
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
export function NuvoSpotlightPanel({ labels, commands, searchHits, onCreate, agent, onClose, onRunCommand }: SpotlightProps) {
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
  // The window's farewell beat: the captured title held for a moment so the
  // summon completes with a "got it" instead of vanishing mid-keystroke.
  const [captured, setCaptured] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // A static "now" per mount — the global window remounts on every ⌥Space
  // (key={showKey}), so this re-reads the time on each summon.
  const now = useMemo(() => new Date(), []);

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

  const query = captureText.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!query) return commands;
    return commands.filter((c) => c.title.toLowerCase().includes(query));
  }, [query, commands]);

  // Found records, grouped by kind and capped per section. Only when searching —
  // an empty field shows the command palette, not the whole vertical.
  const hitGroups = useMemo(() => {
    if (!query || !searchHits?.length) return [] as { label: string; hits: SearchHit[] }[];
    const match = (h: SearchHit) =>
      h.title.toLowerCase().includes(query) || h.subtitle?.toLowerCase().includes(query);
    return HIT_SECTIONS.map(({ kind, label, cap }) => ({
      label,
      hits: searchHits.filter((h) => h.kind === kind && match(h)).slice(0, cap),
    })).filter((g) => g.hits.length > 0);
  }, [query, searchHits]);

  // One flat, ordered list of everything selectable (capture row, then command
  // matches, then found records) — the single source of truth for ↑/↓ + Enter.
  const selectable = useMemo(() => {
    const items: ({ type: "capture" } | { type: "command"; cmd: Command } | { type: "entity"; hit: SearchHit })[] = [];
    if (parsed) items.push({ type: "capture" });
    for (const c of matches) items.push({ type: "command", cmd: c });
    for (const g of hitGroups) for (const h of g.hits) items.push({ type: "entity", hit: h });
    return items;
  }, [parsed, matches, hitGroups]);

  const rows = selectable.length;

  const runCapture = () => {
    const sel = selectable[highlight];
    if (!sel) return;
    if (sel.type === "capture") {
      const title = parsed!.title || captureText.trim();
      const labelIds = parsed!.labels
        .map((n) => labels.find((l) => l.name.toLowerCase() === n.toLowerCase())?.id)
        .filter((id): id is string => Boolean(id));
      // Fire-and-forget: the create mutation updates the cache optimistically
      // (onMutate) and the global mutationCache toasts on failure — so we never
      // block the UI on the network round-trip. The "Captured" beat / close is
      // instant, not "instant after the insert resolves."
      void onCreate({
        title,
        do_date: parsed!.doDate,
        start_time: parsed!.startTime?.toISOString() ?? null,
        duration_minutes: parsed!.durationMinutes,
        priority: parsed!.priority,
        labelIds,
      }).catch(() => {});
      // Linger on a "Captured" beat, then dismiss — same in ⌘K and ⌥Space.
      setCaptured(title);
      window.setTimeout(onClose, 900);
    } else if (sel.type === "command") {
      runCmd(sel.cmd);
    } else {
      runCmd(sel.hit);
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

  // The window's farewell — a held "Captured" moment so the summon completes
  // with a quiet acknowledgment instead of vanishing mid-keystroke.
  if (captured) {
    return (
      <div className="moment flex flex-col items-center gap-1.5 px-6 py-14 text-center">
        <span className="text-lead leading-none text-accent">✓</span>
        <h2 className="masthead text-lead text-ink">Captured</h2>
        <p className="line-clamp-2 max-w-sm text-body text-muted">{captured}</p>
      </div>
    );
  }

  return (
    <>
      {/* The window opens like a pocket Today: a date eyebrow over a Fraunces
          greeting. The in-app ⌘K palette skips this — it's already in the app. */}
      <div className="px-4 pb-3 pt-5">
        <div className="section-label text-muted/55">
          {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <h1 className="masthead mt-1 text-lead text-ink">{greetingFor(now)}</h1>
      </div>

      <div className="flex items-center gap-3 border-b border-line/50 px-4">
        <span
          className={`shrink-0 text-lead leading-none ${isAsk ? "text-accent" : "text-accent/70"}`}
        >
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
              : "Capture anything on your mind…"
          }
          className="nuvo-capture-input w-full bg-transparent py-4 text-lead outline-none placeholder:text-muted/45"
        />
        <Keycap>esc</Keycap>
      </div>

      {/* Mode — dissolved into one quiet ghost toggle (no filled band). The
          leading mark + placeholder already say which mode you're in; this
          offers the other, with the keyboard accelerator alongside. */}
      <div className="flex items-center gap-2 border-b border-line/40 px-4 py-1.5">
        <button
          onClick={() => setMode(isAsk ? "capture" : "ask")}
          className="tap fast flex items-center gap-1.5 text-meta text-muted/70 transition-colors hover:text-accent"
        >
          <span aria-hidden>{isAsk ? "＋" : "✦"}</span>
          {isAsk ? "Capture a task" : `Ask ${ASSISTANT_NAME}`}
        </button>
        <span className="mono ml-auto text-micro text-muted/45">
          {isAsk ? "⌫ to capture" : "space to ask"}
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
              <span className="shrink-0 text-body">{destinationLabel(parsed.doDate)}</span>
              <span className="min-w-0 flex-1 truncate text-caption text-muted">
                {parsed.title || captureText.trim()}
              </span>
              {parsed.chips
                .filter((c) => c.kind !== "date")
                .map((c, i) => (
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
              const idx = (parsed ? 1 : 0) + i;
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

            {/* Found records — grouped under their kind. Flat indices continue
                past the capture row + command matches so ↑/↓ flow straight through. */}
            {(() => {
              let n = (parsed ? 1 : 0) + matches.length;
              return hitGroups.map((g) => (
                <div key={g.label}>
                  <div className="section-label px-4 pb-1 pt-2.5 text-meta text-muted/60">{g.label}</div>
                  {g.hits.map((h) => {
                    const idx = n++;
                    return (
                      <button
                        key={h.id}
                        onClick={() => runCmd(h)}
                        onMouseEnter={() => setHighlight(idx)}
                        className={`fast flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors ${
                          highlight === idx ? "bg-accent-soft text-ink" : "text-ink/75 hover:bg-accent-soft/50"
                        }`}
                      >
                        <span className="shrink-0 text-caption text-muted/60">{HIT_GLYPH[h.kind]}</span>
                        <span className="min-w-0 flex-1 truncate text-body">{h.title}</span>
                        {h.subtitle && (
                          <span className="mono shrink-0 truncate text-meta text-muted/60">{h.subtitle}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ));
            })()}

            {rows === 0 && (
              <div className="px-4 py-3 text-caption text-muted/70">
                Type to capture a task, search, run a command, or press space to ask {ASSISTANT_NAME}.
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
