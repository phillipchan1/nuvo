/**
 * TaskComposer — the one add box.
 *
 * Every list that takes new tasks mounts this: the rail, a project or bet's
 * list, a slot, a domain's parked work, the phone's detail screens. They differ
 * only in where they are (`context`) and how they're drawn (`variant`); what
 * the words mean, what Enter and Escape do, and how fast it feels are the same
 * everywhere. (Before this there were ten boxes and five Escape behaviours.)
 *
 * The field is a plain `<input>` — iOS dictation needs one — with the text it
 * understood highlighted by a mirror layer drawn underneath it.
 *
 *   ↵      add, stay open for the next one
 *   ⌘↵     add and leave
 *   esc    clear; on an empty box, leave
 *   ↑↓ ↵ ⇥ pick a # / @ suggestion
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { fmtDayLabel, fmtDayTime, fmtDuration, todayISO } from "../../lib/dates";
import { literalKey, parseCapture, resolveRoute, type CaptureSpan, type ParsedCapture } from "../../lib/nlp";
import type { CaptureAction, CaptureContext } from "../../lib/captureDraft";
import { useTaskCapture, type CaptureResult } from "../../hooks/useTaskCapture";
import { useTokenMenu } from "./useTokenMenu";
import { Icon } from "../Icon";

export interface TaskComposerHandle {
  focus: () => void;
  clear: () => void;
  /** What's typed and not yet added — a host that commits a draft on its own
   *  button folds this in rather than dropping it. */
  value: () => string;
  /** Words the user asked to keep as text, for `value()`. */
  literal: () => ReadonlySet<string>;
}

export interface TaskComposerProps {
  /** Where this box is. Typed tokens still win over it. */
  context?: CaptureContext;
  /** The context, as the chip that says it ("Launch site", "Today"). */
  contextLabel?: { name: string; color?: string | null } | null;
  placeholder?: string;
  /** `row` sits in a list's left gutter; `pill` is the rail's capture pill;
   *  `field` is the phone capture sheet's bordered box. */
  variant?: "row" | "pill" | "field";
  autoFocus?: boolean;
  /** A shortcut key shown at rest, e.g. "A". */
  shortcut?: string;
  /** A checklist line: no grammar, no chips — the text is the title. */
  plain?: boolean;
  /** Plain mode's submit. */
  onPlainSubmit?: (title: string) => void;
  /** Draft mode: hand the action to the host instead of creating it (a record
   *  that doesn't exist yet collects its tasks first). */
  onDraft?: (action: CaptureAction, text: string) => void;
  /** After a task (or series) was created. */
  onCreated?: (result: CaptureResult) => void;
  /** Escape on an empty box, or ⌘↵ — hand focus back to the list. */
  onLeave?: () => void;
  /** Called with the error when a create fails; the text is restored either way. */
  onError?: (message: string) => void;
  /** Close after one task (⌘K-style). ⌘↵ always does. */
  closeOnSubmit?: boolean;
  /** Blur with text still in the box adds it (phone lists, where there's no Enter habit). */
  submitOnBlur?: boolean;
  className?: string;
  footer?: ReactNode;
  "aria-label"?: string;
  /** The host reads what's being typed (the capture sheet seeds an event from it). */
  onTextChange?: (text: string) => void;
  /** The host needs the element itself (to raise the iOS keyboard, D-115). */
  fieldRef?: MutableRefObject<HTMLInputElement | null>;
  /** Enter does nothing here — the host submits some other way (an event form). */
  enterDisabled?: boolean;
  enterKeyHint?: "enter" | "done" | "next" | "send";
}

type Segment = { text: string; kind: CaptureSpan["kind"] | null };

function segmentsOf(text: string, spans: CaptureSpan[]): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  for (const s of spans) {
    if (s.start > i) out.push({ text: text.slice(i, s.start), kind: null });
    out.push({ text: text.slice(s.start, s.end), kind: s.kind });
    i = s.end;
  }
  if (i < text.length) out.push({ text: text.slice(i), kind: null });
  return out;
}

const PRIORITY_WORD = { high: "High", medium: "Medium", low: "Low", none: "None" } as const;

interface Chip {
  key: string;
  kind: CaptureSpan["kind"];
  label: string;
  value: string;
  /** A chip that will create or can't resolve something says so. */
  note?: string;
  color?: string | null;
}

function chipsOf(
  p: ParsedCapture,
  env: ReturnType<typeof useTaskCapture>["env"],
): Chip[] {
  const out: Chip[] = [];
  const today = todayISO();
  for (const s of p.spans) {
    const key = literalKey(s.kind, s.text);
    switch (s.kind) {
      case "date": {
        if (!p.doDate) break;
        const day = p.doDate === today ? "Today" : fmtDayLabel(p.doDate);
        const clock = p.startTime ? fmtDayTime(p.startTime.toISOString()).split(" ")[1] : null;
        out.push({ key, kind: s.kind, label: "When", value: clock ? `${day} ${clock}` : day });
        break;
      }
      case "duration":
        if (p.durationMinutes) out.push({ key, kind: s.kind, label: "Length", value: fmtDuration(p.durationMinutes) });
        break;
      case "priority":
        out.push({ key, kind: s.kind, label: "Priority", value: PRIORITY_WORD[p.priority] });
        break;
      case "label": {
        const name = s.text.slice(1);
        const known = env.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
        out.push({ key, kind: s.kind, label: "Label", value: `#${known?.name ?? name}`, note: known ? undefined : "new", color: known?.color });
        break;
      }
      case "route": {
        const hit = p.route ? resolveRoute(p.route, env.routeTargets) : null;
        out.push({
          key,
          kind: s.kind,
          label: "Into",
          value: hit?.name ?? s.text,
          note: hit ? undefined : "no match — kept in title",
          color: hit ? env.colorOf(hit) : null,
        });
        break;
      }
      case "note":
        if (p.notes) out.push({ key, kind: s.kind, label: "Note", value: p.notes.length > 24 ? `${p.notes.slice(0, 24)}…` : p.notes });
        break;
      case "repeat": {
        const text = p.chips.find((c) => c.kind === "repeat")?.text;
        if (text && !out.some((c) => c.kind === "repeat")) out.push({ key, kind: s.kind, label: "Repeats", value: text });
        break;
      }
    }
  }
  return out;
}

export const TaskComposer = forwardRef<TaskComposerHandle, TaskComposerProps>(function TaskComposer(
  {
    context,
    contextLabel,
    placeholder = "Add task",
    variant = "row",
    autoFocus,
    shortcut,
    plain,
    onPlainSubmit,
    onDraft,
    onCreated,
    onLeave,
    onError,
    closeOnSubmit,
    submitOnBlur,
    className = "",
    footer,
    "aria-label": ariaLabel,
    onTextChange,
    fieldRef,
    enterDisabled,
    enterKeyHint = "enter",
  },
  ref,
) {
  const stableContext = useMemo(() => context ?? {}, [JSON.stringify(context ?? {})]); // eslint-disable-line react-hooks/exhaustive-deps
  const { capture, preview, env } = useTaskCapture(stableContext);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [literal, setLiteral] = useState<ReadonlySet<string>>(() => new Set());
  const [pasted, setPasted] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  const clear = useCallback(() => {
    setText("");
    setLiteral(new Set());
    setPasted(null);
    setCaret(0);
  }, []);

  useImperativeHandle(
    ref,
    () => ({ focus: () => inputRef.current?.focus(), clear, value: () => text, literal: () => literal }),
    [clear, text, literal],
  );

  const parsed = useMemo(
    () => (!plain && text.trim() ? parseCapture(text, new Date(), { literal }) : null),
    [plain, text, literal],
  );
  const chips = useMemo(() => (parsed ? chipsOf(parsed, env) : []), [parsed, env]);
  const segments = useMemo(() => (parsed ? segmentsOf(text, parsed.spans) : [{ text, kind: null }]), [parsed, text]);
  // The context chip is struck only when something typed replaces it: an
  // @home over a home, a day over a day. @project on the Today tab still lands today.
  const ctxHome = Boolean(stableContext.projectId || stableContext.initiativeId || stableContext.domainId || stableContext.slot);
  const routed = Boolean(parsed?.route && resolveRoute(parsed.route, env.routeTargets));
  const typedDay = Boolean(parsed?.doDate || parsed?.startTime);
  const contextOverridden =
    (ctxHome && routed) ||
    (Boolean(stableContext.slot) && typedDay) ||
    (Boolean(stableContext.doDate) && Boolean(parsed?.doDate) && parsed?.doDate !== stableContext.doDate);

  const menu = useTokenMenu({
    text,
    caret,
    labels: env.labels,
    routeTargets: env.routeTargets,
    colorOf: env.colorOf,
    enabled: !plain && focused,
  });

  // The mirror scrolls with the field, or the highlights drift off their words.
  const syncMirror = () => {
    const el = inputRef.current;
    if (el && mirrorRef.current) mirrorRef.current.scrollLeft = el.scrollLeft;
    if (el) setCaret(el.selectionStart ?? el.value.length);
  };
  useLayoutEffect(syncMirror, [text]);
  const reportText = useRef(onTextChange);
  reportText.current = onTextChange;
  useEffect(() => reportText.current?.(text), [text]);

  const submitText = (value: string, leave: boolean) => {
    const raw = value.trim();
    if (!raw) return;
    const kept = literal;
    clear();
    if (leave || closeOnSubmit) {
      inputRef.current?.blur();
      onLeave?.();
    } else {
      inputRef.current?.focus();
    }
    if (plain) {
      onPlainSubmit?.(raw);
      return;
    }
    if (onDraft) {
      const action = preview(raw, kept);
      if (action) onDraft(action, raw);
      return;
    }
    create(raw, kept);
  };

  // `capture` writes the cache before its first await, and the field is already
  // clear, so a second Enter has nothing to resend. A failure puts the words
  // back rather than losing them.
  const create = (raw: string, kept: ReadonlySet<string>) => {
    void capture(raw, kept)
      .then((r) => {
        if (r) onCreated?.(r);
      })
      .catch((err: unknown) => {
        setText((cur) => (cur === "" ? raw : cur));
        onError?.(err instanceof Error ? err.message : "Couldn't add that task");
      });
  };

  const takeSuggestion = (i: number) => {
    const match = menu.matches[i];
    if (!match) return;
    const next = menu.accept(match);
    setText(next.text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = next.caret;
      setCaret(next.caret);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (pasted) {
      if (e.key === "Enter") {
        e.preventDefault();
        addPasted();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPasted(null);
      }
      return;
    }
    if (menu.open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        menu.move(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        takeSuggestion(menu.index);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        menu.dismiss();
        return;
      }
    }
    if (e.key === "Enter" && enterDisabled) return;
    if (e.key === "Enter") {
      // A drafting host owns ⌘↵ (it commits the whole record, this line included).
      if ((e.metaKey || e.ctrlKey) && onDraft) return;
      e.preventDefault();
      submitText(text, e.metaKey || e.ctrlKey);
      return;
    }
    if (e.key === "Escape") {
      // The field owns Escape first (D-051): leaving a field and leaving the
      // surface around it are two presses.
      e.preventDefault();
      e.stopPropagation();
      if (text) clear();
      else {
        inputRef.current?.blur();
        onLeave?.();
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const lines = e.clipboardData
      .getData("text")
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]?\])\s*/i, "").trim())
      .filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    setPasted(lines);
  };

  const addPasted = () => {
    if (!pasted) return;
    const lines = pasted;
    setPasted(null);
    inputRef.current?.focus();
    for (const line of lines) {
      if (plain) onPlainSubmit?.(line);
      else if (onDraft) {
        const action = preview(line);
        if (action) onDraft(action, line);
      } else create(line, new Set());
    }
  };

  const open = focused || Boolean(text) || Boolean(pasted);
  const pill = variant === "pill";
  const field = variant === "field";

  return (
    <div
      className={`task-composer ${pill ? "task-composer-pill" : field ? "task-composer-field-box" : "task-composer-row"} ${open ? "is-open" : ""} ${className}`}
      data-tauri-drag-region="false"
    >
      <div className="task-composer-line">
        {pill || field ? (
          <Icon name={pill ? "pen" : "plus"} size={15} className="task-composer-glyph text-accent" />
        ) : (
          <span className={`task-composer-glyph ${open ? "text-accent" : "text-muted"}`} aria-hidden>
            <Icon name="plus" size={14} />
          </span>
        )}
        <div className="task-composer-field">
          <div ref={mirrorRef} className="task-composer-mirror" aria-hidden>
            {segments.map((s, i) =>
              s.kind ? (
                <mark key={i} className="task-composer-token">
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </div>
          <input
            ref={(el) => {
              inputRef.current = el;
              if (fieldRef) fieldRef.current = el;
            }}
            value={text}
            autoFocus={autoFocus}
            enterKeyHint={enterKeyHint}
            autoComplete="off"
            spellCheck
            aria-label={ariaLabel ?? placeholder}
            aria-expanded={menu.open}
            aria-autocomplete={plain ? undefined : "list"}
            placeholder={placeholder}
            className="task-composer-input"
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              if (!e.target.value) setLiteral(new Set());
            }}
            onKeyDown={onKeyDown}
            onKeyUp={syncMirror}
            onClick={syncMirror}
            onSelect={syncMirror}
            onScroll={syncMirror}
            onPaste={onPaste}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (submitOnBlur && text.trim()) submitText(text, false);
            }}
          />
          {menu.open && (
            <div className="task-composer-menu" role="listbox" aria-label={menu.trigger === "@" ? "File under" : "Labels"}>
              <div className="px-2 pb-1 pt-0.5 text-meta text-muted">{menu.trigger === "@" ? "File under" : "Label"}</div>
              {menu.matches.map((m, i) => (
                <button
                  key={m.insert}
                  type="button"
                  role="option"
                  aria-selected={i === menu.index}
                  className={`task-composer-option tap-h ${i === menu.index ? "is-active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    takeSuggestion(i);
                  }}
                  onMouseEnter={() => menu.setIndex(i)}
                >
                  <span className="task-composer-swatch" style={{ background: m.color ?? "var(--line-strong)" }} />
                  <span className="min-w-0 flex-1 truncate">{m.label}</span>
                  {m.hint && <span className="text-meta text-muted">{m.hint}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {!open && shortcut && (
          <kbd className="task-composer-kbd mono" aria-hidden>
            {shortcut}
          </kbd>
        )}
      </div>

      {pasted && (
        <div className="task-composer-foot" role="group" aria-label="Paste as tasks">
          <span className="text-caption">Add {pasted.length} tasks?</span>
          <span className="flex items-center gap-1.5">
            <button type="button" className="task-composer-btn is-primary tap-h" onMouseDown={(e) => e.preventDefault()} onClick={addPasted}>
              Add {pasted.length}
            </button>
            <button
              type="button"
              className="task-composer-btn tap-h"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setText(pasted.join(" "));
                setPasted(null);
              }}
            >
              As one
            </button>
          </span>
        </div>
      )}

      {open && !pasted && !plain && (contextLabel || chips.length > 0) && (
        <div className="task-composer-foot">
          <div className="task-composer-chips">
            {contextLabel && (
              <span className={`task-composer-context ${contextOverridden ? "is-overridden" : ""}`}>
                {contextLabel.color && <span className="task-composer-swatch" style={{ background: contextLabel.color }} />}
                {contextLabel.name}
              </span>
            )}
            {chips.map((c) => (
              <span key={c.key} className="task-composer-chip">
                <span className="text-muted">{c.label}</span>
                {c.color && <span className="task-composer-swatch" style={{ background: c.color }} />}
                <span className="truncate">{c.value}</span>
                {c.note && <span className="text-muted">· {c.note}</span>}
                <button
                  type="button"
                  className="task-composer-unparse tap-bloom"
                  aria-label={`Keep “${c.value}” as text`}
                  title="Keep as text"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setLiteral((prev) => new Set(prev).add(c.key))}
                >
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
          </div>
          <span className="task-composer-hints" aria-hidden>
            <kbd className="mono">↵</kbd> add
            <kbd className="mono">esc</kbd> {text ? "clear" : "leave"}
          </span>
        </div>
      )}
      {footer}
    </div>
  );
});

export default TaskComposer;
