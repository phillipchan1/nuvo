import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { parseCapture, resolveRoute, routeKey, type RouteTarget } from "../lib/nlp";
import type { Label } from "../lib/types";
import type { NewTaskInput } from "../hooks/useTasks";
import type { AgentHandle } from "../hooks/useAgent";
import { ASSISTANT_NAME } from "../lib/assistant";
import AgentMessageBubble from "./AgentMessageBubble";
import AgentSuggestionChips from "./AgentSuggestionChips";
import { Keycap, Modal } from "./ui";
import { AltitudeIcon, type AltitudeKind } from "./icons";

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

export type Mode = "capture" | "ask";

const HIT_SECTIONS: { kind: SearchHit["kind"]; label: string; cap: number }[] = [
  { kind: "task", label: "Tasks", cap: 6 },
  { kind: "project", label: "Projects", cap: 6 },
  { kind: "initiative", label: "Initiatives", cap: 6 },
  { kind: "domain", label: "Domains", cap: 4 },
];

// A hit's kind is drawn with the shared altitude family (`components/icons.tsx`)
// — the same glyphs as the spine and the phone's bottom bar, so a result looks
// like the thing it opens.

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
  /** Notifies the host when the panel flips capture ↔ ask, so the wrapper can
   *  widen the panel for chat — a different, roomier modality than quick entry. */
  onModeChange?: (mode: Mode) => void;
  /** Notifies the host when the result deck is showing (searching with hits on
   *  desktop), so the wrapper can widen to give the columns room. */
  onLayoutChange?: (wide: boolean) => void;
  /** When set, a small "context pill" is shown above the chat input so the user
   *  knows the agent is pointed at a specific entity. */
  contextLabel?: string;
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
  const [mode, setMode] = useState<Mode>("capture");
  const [wide, setWide] = useState(false);
  const width = mode === "ask" ? "max-w-2xl" : wide ? "max-w-4xl" : "max-w-xl";
  return (
    <Modal onClose={props.onClose} width={width}>
      <NuvoSpotlightPanel {...props} onModeChange={setMode} onLayoutChange={setWide} />
    </Modal>
  );
}

// The morphing capture + ask panel. Capture parses free text into a task or
// runs a command; Ask hands the same text to the Nuvo agent. Space on an empty
// capture field flips to Ask; Backspace on an empty Ask field flips back.
// Renders bare (no scrim / no card chrome) so a Modal or a window can wrap it.
export function NuvoSpotlightPanel({ labels, commands, searchHits, onCreate, agent, onClose, onRunCommand, onModeChange, onLayoutChange, contextLabel }: SpotlightProps) {
  // Whether there's horizontal room for the column deck. Keys off the surface's
  // own width, not the phone breakpoint — the ⌥Space panel is a legitimately
  // narrow (~680px) *desktop* surface that should still get the deck, while a
  // genuinely tiny mount falls back to the single-column accordion.
  const [roomy, setRoomy] = useState(() => typeof window !== "undefined" && window.innerWidth >= 600);
  useEffect(() => {
    const onResize = () => setRoomy(window.innerWidth >= 600);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const switchMode = (m: Mode) => {
    setMode(m);
    onModeChange?.(m);
  };
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
  // Deck cursor: {col,row} over the result columns, or null = the pinned capture
  // footer is the default Enter target. Used only on the desktop deck path.
  const [cell, setCell] = useState<{ col: number; row: number } | null>(null);
  // The window's farewell beat: the captured title held for a moment so the
  // summon completes with a "got it" instead of vanishing mid-keystroke.
  const [captured, setCaptured] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLButtonElement>(null);
  const activeCellRef = useRef<HTMLButtonElement>(null);
  // A static "now" per mount — the global window remounts on every ⌥Space
  // (key={showKey}), so this re-reads the time on each summon.
  const now = useMemo(() => new Date(), []);

  const { messages, loading, error, sendMessage, clear } = agent;

  useEffect(() => inputRef.current?.focus(), [mode]);
  useEffect(() => {
    if (mode === "ask") bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, mode]);

  // Grow the field to fit pasted/typed content instead of scrolling
  // horizontally — capped by `max-h` on the element, which then scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [mode === "capture" ? captureText : askText]);

  // ── Capture mode ──────────────────────────────────────────────────────────
  const parsed = useMemo(
    () => (captureText.trim() ? parseCapture(captureText) : null),
    [captureText],
  );

  // The routable vertical, derived from the search index (ids are "kind:uuid").
  // Lets `@token` file a capture into a project/initiative/domain at create time.
  const routeTargets = useMemo<RouteTarget[]>(
    () =>
      (searchHits ?? [])
        .filter((h): h is SearchHit & { kind: "project" | "initiative" | "domain" } => h.kind !== "task")
        .map((h) => ({ id: h.id.split(":")[1] ?? h.id, kind: h.kind, name: h.title })),
    [searchHits],
  );

  // ── Token autocomplete (#label / @route) ──────────────────────────────────
  // A plain <textarea> (auto-growing, no rich-text) is preserved for iOS
  // dictation — the menu just rewrites its value on select. `caret` tracks the
  // cursor so we read the token being typed.
  const [caret, setCaret] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const activeToken = useMemo(() => {
    if (mode !== "capture") return null;
    const upto = captureText.slice(0, caret);
    // The token under the caret: a #/@ trigger with no whitespace since.
    const m = upto.match(/(^|\s)([#@])([\w-]*)$/);
    if (!m) return null;
    return { trigger: m[2] as "#" | "@", query: m[3], start: caret - m[3].length - 1 };
  }, [captureText, caret, mode]);

  const autoMatches = useMemo<{ insert: string; label: string; hint?: string }[]>(() => {
    if (!activeToken) return [];
    const q = routeKey(activeToken.query);
    if (activeToken.trigger === "#") {
      return labels
        .filter((l) => routeKey(l.name).startsWith(q))
        .slice(0, 6)
        .map((l) => ({ insert: `#${l.name.replace(/\s+/g, "-")}`, label: `#${l.name}` }));
    }
    return routeTargets
      .filter((t) => routeKey(t.name).startsWith(q))
      .slice(0, 6)
      .map((t) => ({ insert: `@${t.name.replace(/\s+/g, "-")}`, label: t.name, hint: t.kind }));
  }, [activeToken, labels, routeTargets]);

  const acceptToken = (insert: string) => {
    if (!activeToken) return;
    const before = captureText.slice(0, activeToken.start);
    const after = captureText.slice(caret);
    const next = `${before}${insert} ${after.replace(/^\s+/, "")}`;
    const pos = before.length + insert.length + 1;
    setCaptureText(next);
    setMenuIndex(0);
    // Restore the caret just past the inserted token + trailing space.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.selectionStart = el.selectionEnd = pos;
        setCaret(pos);
      }
    });
  };

  const menuOpen = autoMatches.length > 0 && !menuDismissed;

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

  // ── Deck (desktop) ─────────────────────────────────────────────────────────
  // The searchable kinds become columns you arrow across (←/→) and within (↑/↓),
  // so the whole result set is visible at once instead of one tall scroll. Each
  // item is a Command (SearchHit extends Command), so the column runs through the
  // same close path. Commands lead as their own column when matched.
  type DeckItem = { run: () => void; title: string; subtitle?: string; kind?: AltitudeKind };
  const columns = useMemo(() => {
    const cols: { key: string; label: string; items: DeckItem[] }[] = [];
    if (query && matches.length) {
      cols.push({ key: "cmd", label: "Commands", items: matches.map((c) => ({ run: () => runCmd(c), title: c.title })) });
    }
    for (const g of hitGroups) {
      cols.push({
        key: g.label,
        label: g.label,
        items: g.hits.map((h) => ({ run: () => runCmd(h), title: h.title, subtitle: h.subtitle, kind: h.kind })),
      });
    }
    return cols;
  }, [query, matches, hitGroups]);

  // Deck while searching with results, when there's room for columns; otherwise
  // the single-column accordion (a tiny mount / no horizontal arrowing on touch).
  const deckActive = roomy && !!query && columns.length > 0;

  useEffect(() => onLayoutChange?.(deckActive), [deckActive, onLayoutChange]);

  // Smart default: if what you typed clearly *names* an existing record, put the
  // cursor on it (Enter finds it); otherwise leave it on the capture footer
  // (Enter adds to Inbox). This is the searching-vs-capturing disambiguation.
  useEffect(() => {
    if (!deckActive) return setCell(null);
    const exact = (t: string) => t.toLowerCase() === query;
    const prefix = (t: string) => query.length >= 3 && t.toLowerCase().startsWith(query);
    for (const test of [exact, prefix]) {
      for (let c = 0; c < columns.length; c++) {
        if (columns[c].key === "cmd") continue; // a command isn't "the thing you searched for"
        const r = columns[c].items.findIndex((it) => test(it.title));
        if (r >= 0) return setCell({ col: c, row: r });
      }
    }
    setCell(null);
  }, [deckActive, columns, query]);

  // Keep the active cell / row in view as the cursor walks (the missing-scroll fix).
  useEffect(() => {
    activeCellRef.current?.scrollIntoView({ block: "nearest" });
  }, [cell]);
  useEffect(() => {
    if (!deckActive) activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlight, deckActive]);

  // Commit the parsed capture as a task — the one place the create mutation
  // fires, shared by the flat list, the deck footer, and ⌘⏎.
  const commitCapture = () => {
    if (!parsed) return;
    {
      // A matched @route files the capture at create time; an unmatched token is
      // left literal in the title for inbox grooming to home (the agreed default).
      const routed = parsed!.route ? resolveRoute(parsed!.route, routeTargets) : null;
      const title = routed
        ? parsed!.title || captureText.trim()
        : (parsed!.route ? `${parsed!.title} @${parsed!.route}`.trim() : parsed!.title) || captureText.trim();
      const labelIds = parsed!.labels
        .map((n) => labels.find((l) => l.name.toLowerCase() === n.toLowerCase())?.id)
        .filter((id): id is string => Boolean(id));
      // Fire-and-forget: the create mutation updates the cache optimistically
      // (onMutate) and the global mutationCache toasts on failure — so we never
      // block the UI on the network round-trip. The "Captured" beat / close is
      // instant, not "instant after the insert resolves."
      void onCreate({
        title,
        notes: parsed!.notes ?? undefined,
        do_date: parsed!.doDate,
        start_time: parsed!.startTime?.toISOString() ?? null,
        duration_minutes: parsed!.durationMinutes,
        priority: parsed!.priority,
        project_id: routed?.kind === "project" ? routed.id : undefined,
        initiative_id: routed?.kind === "initiative" ? routed.id : undefined,
        domain_id: routed?.kind === "domain" ? routed.id : undefined,
        labelIds,
      }).catch(() => {});
      // Linger on a "Captured" beat, then dismiss — same in ⌘K and ⌥Space.
      setCaptured(title);
      window.setTimeout(onClose, 900);
    }
  };

  // The flat-list Enter path (mobile + the empty-query command palette): run
  // whatever the single ↑/↓ cursor is on.
  const runFlat = () => {
    const sel = selectable[highlight];
    if (!sel) return;
    if (sel.type === "capture") commitCapture();
    else if (sel.type === "command") runCmd(sel.cmd);
    else runCmd(sel.hit);
  };

  // The deck Enter path: a highlighted cell opens that record; no cell means the
  // capture footer is the default → add to Inbox.
  const runDeck = () => {
    if (cell) columns[cell.col]?.items[cell.row]?.run();
    else commitCapture();
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
    // The token autocomplete owns the arrows / Enter / Tab / Esc while it's open,
    // so the same keys don't also drive the command list beneath it.
    if (mode === "capture" && menuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuIndex((i) => Math.min(autoMatches.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptToken(autoMatches[menuIndex].insert);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuDismissed(true);
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    // Space on an empty capture field → Ask; Backspace on an empty Ask field → Capture.
    if (e.key === " " && mode === "capture" && captureText === "") {
      e.preventDefault();
      switchMode("ask");
      return;
    }
    if (e.key === "Backspace" && mode === "ask" && askText === "") {
      e.preventDefault();
      switchMode("capture");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (mode !== "capture") return sendAsk();
      // ⌘⏎ / Ctrl⏎ always adds to Inbox, whatever the cursor is on — the escape
      // hatch when the smart default lands on a record but you meant to capture.
      if (e.metaKey || e.ctrlKey) return commitCapture();
      if (deckActive) runDeck();
      else runFlat();
      return;
    }
    if (mode === "capture" && deckActive) {
      // 2D walk over the columns; ←/→ across kinds, ↑/↓ within. ↑ off the top
      // row returns to the capture footer (cell = null).
      const colLen = (c: number) => columns[c]?.items.length ?? 0;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCell((p) => (p ? { col: p.col, row: Math.min(colLen(p.col) - 1, p.row + 1) } : { col: 0, row: 0 }));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCell((p) => (p && p.row > 0 ? { col: p.col, row: p.row - 1 } : null));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setCell((p) => {
          const col = Math.min(columns.length - 1, (p?.col ?? -1) + 1);
          return { col, row: Math.min(p?.row ?? 0, colLen(col) - 1) };
        });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCell((p) => {
          const col = Math.max(0, (p?.col ?? 0) - 1);
          return { col, row: Math.min(p?.row ?? 0, colLen(col) - 1) };
        });
      }
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
    kind === "label" || kind === "route"
      ? "var(--accent)"
      : kind === "priority"
        ? "var(--signal)"
        : "var(--muted)";

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
      {/* Header: a date eyebrow over a Fraunces greeting in capture mode; in ask
          mode the eyebrow names the modality and offers the way back to capture. */}
      <div className="px-4 pb-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <span className="section-label text-muted/55">
            {isAsk
              ? `Ask ${ASSISTANT_NAME}`
              : now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </span>
          {isAsk && (
            <div className="flex items-center gap-3">
              {messages.length > 0 && (
                <button
                  onClick={() => clear()}
                  className="tap fast flex items-center gap-1 text-meta text-muted/70 transition-colors hover:text-accent"
                >
                  <span aria-hidden>↺</span> New chat
                </button>
              )}
              <button
                onClick={() => switchMode("capture")}
                className="tap fast flex items-center gap-1 text-meta text-muted/70 transition-colors hover:text-accent"
              >
                <span aria-hidden>＋</span> Capture a task
              </button>
            </div>
          )}
        </div>
        <h1 className="masthead mt-1 text-lead text-ink">{greetingFor(now)}</h1>
      </div>

      {isAsk && contextLabel && (
        <div className="flex items-center gap-1.5 border-b border-line/30 px-4 py-1.5">
          <span className="text-micro text-muted/50">Context:</span>
          <span className="rounded-full border border-accent/20 bg-accent/8 px-2 py-0.5 text-micro text-accent/70">
            {contextLabel}
          </span>
        </div>
      )}

      <div className="relative flex items-start gap-3 border-b border-line/50 px-4">
        <span
          className={`mt-4 shrink-0 text-lead leading-none ${isAsk ? "text-accent" : "text-accent/70"}`}
        >
          {isAsk ? "✦" : "＋"}
        </span>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHighlight(0);
            setMenuDismissed(false);
            setMenuIndex(0);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={onKey}
          placeholder={
            isAsk
              ? `Ask ${ASSISTANT_NAME} — "what does my day look like?"`
              : "Capture anything — try “tom 9am 30m @”"
          }
          rows={1}
          className="nuvo-capture-input max-h-[40vh] w-full resize-none overflow-y-auto bg-transparent py-4 text-lead outline-none placeholder:text-muted/45"
        />
        <span className="mt-4 shrink-0">
          <Keycap>esc</Keycap>
        </span>

        {/* Token autocomplete — a plain-input-friendly menu that rewrites the
            field on select, so iOS dictation keeps working. */}
        {!isAsk && menuOpen && (
          <div className="absolute left-3 right-3 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line/60 glass-card [box-shadow:var(--shadow-lift)]">
            <div className="section-label px-3 pb-1 pt-2 text-muted/50">
              {activeToken?.trigger === "@" ? "File under" : "Label"}
            </div>
            {autoMatches.map((m, i) => (
              <button
                key={m.insert}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the input
                  acceptToken(m.insert);
                }}
                onMouseEnter={() => setMenuIndex(i)}
                className={`fast flex w-full items-center gap-2 px-3 py-2 text-left text-body ${
                  i === menuIndex ? "bg-accent-soft text-ink" : "text-ink/75 hover:bg-accent-soft/50"
                }`}
              >
                <span className="shrink-0 text-accent">{activeToken?.trigger}</span>
                <span className="min-w-0 flex-1 truncate">{m.label}</span>
                {m.hint && <span className="section-label shrink-0 text-muted/45">{m.hint}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Capture mode offers the quiet entry into chat. Ask mode keeps its switch
          up in the header instead, so the conversation isn't cluttered by an
          entry-looking row beneath the input. */}
      {!isAsk && (
        <div className="flex items-center gap-2 border-b border-line/40 px-4 py-1.5">
          <button
            onClick={() => switchMode("ask")}
            className="tap fast flex items-center gap-1.5 text-meta text-muted/70 transition-colors hover:text-accent"
          >
            <span aria-hidden>✦</span>
            Ask {ASSISTANT_NAME}
          </button>
          <span className="mono ml-auto text-micro text-muted/45">space to ask</span>
        </div>
      )}

      {isAsk ? (
        <div className="flex max-h-[70vh] min-h-[16rem] flex-col">
          <div className="nuvo-chat flex-1 overflow-y-auto px-4 py-3">
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
      ) : deckActive ? (
        /* ── Result deck (desktop) — columns by kind, arrowed omnidirectionally,
              with the capture as a pinned, always-available footer. ─────────── */
        <>
          <div className="flex max-h-80 divide-x divide-line/45">
            {columns.map((col, ci) => (
              <div key={col.key} className="min-w-0 flex-1 basis-0 overflow-y-auto overflow-x-hidden py-1">
                <div className="section-label px-3 pb-1 pt-2 text-meta text-muted/55">{col.label}</div>
                {col.items.map((it, ri) => {
                  const active = cell?.col === ci && cell?.row === ri;
                  return (
                    <button
                      key={ri}
                      ref={active ? activeCellRef : undefined}
                      onClick={() => it.run()}
                      onMouseEnter={() => setCell({ col: ci, row: ri })}
                      className={`fast flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                        active ? "glass-lift bg-accent-soft text-ink" : "text-ink/75 hover:bg-accent-soft/50"
                      }`}
                    >
                      {it.kind && <span className="shrink-0 text-muted/60"><AltitudeIcon kind={it.kind} size={14} /></span>}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-body">{it.title}</div>
                        {it.subtitle && (
                          <div className="truncate text-meta text-muted/55">{it.subtitle}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Pinned capture — lit by default when the cursor isn't on a record,
              so what you typed adds to Inbox; ⌘⏎ forces it from anywhere. */}
          {parsed && (
            <button
              onClick={() => commitCapture()}
              onMouseEnter={() => setCell(null)}
              className={`fast flex w-full items-center gap-2 border-t border-line/50 px-4 py-2.5 text-left ${
                cell === null
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
              <span className="mono ml-1 shrink-0 text-micro text-muted/45">⌘⏎</span>
            </button>
          )}

          <div className="flex items-center gap-3 border-t border-line/40 px-4 py-1.5 text-micro text-muted/45">
            <span className="mono">↑↓ within</span>
            <span className="mono">←→ across</span>
            <span className="mono">⏎ {cell ? "open" : "add to inbox"}</span>
          </div>
        </>
      ) : (
        <>
          {parsed && (
            <button
              ref={highlight === 0 ? activeRowRef : undefined}
              onClick={() => commitCapture()}
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
                  ref={highlight === idx ? activeRowRef : undefined}
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
                        ref={highlight === idx ? activeRowRef : undefined}
                        onClick={() => runCmd(h)}
                        onMouseEnter={() => setHighlight(idx)}
                        className={`fast flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors ${
                          highlight === idx ? "bg-accent-soft text-ink" : "text-ink/75 hover:bg-accent-soft/50"
                        }`}
                      >
                        <span className="shrink-0 text-muted/60"><AltitudeIcon kind={h.kind} size={14} /></span>
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
