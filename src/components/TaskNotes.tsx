import { useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { renderRecognized } from "../lib/descriptionHtml";
import { pressable } from "../lib/a11y";
import { recognize } from "../lib/recognize";

/** What the surface's own textarea has to be wired to. */
export interface NotesEditorProps {
  /** Goes on the textarea — the field focuses it itself when a tap swaps it in. */
  inputRef: RefObject<HTMLTextAreaElement>;
  onFocus: () => void;
  /** Call from the textarea's blur — it also hands the field back to its read face. */
  onBlur: () => void;
}

/**
 * A task's notes, on either shell. The words stay a plain string; what this adds is
 * that the things in them you can ACT on — a phone number, an email, a link — are
 * tappable once you aren't typing. "Call Frontier Loyalty" with the number in the
 * note used to mean copying the number and switching apps (`lib/recognize.ts` is
 * what counts as one, and why it is conservative).
 *
 * A `<textarea>` can't hold a link, so there are two faces:
 *
 *   · notes that hold something actionable, and aren't being edited → the READ face:
 *     the same words, drawn with links. Tap a link and it acts; tap anywhere else
 *     and the textarea takes its place under your finger, caret at the end, in the
 *     same gesture (so iOS raises the keyboard).
 *   · everything else — empty notes, or notes with nothing to tap — is simply the
 *     textarea, as it always was. No extra tap, nothing to learn, and a fresh
 *     account's empty notes cost nothing (P5, P7).
 *
 * Focus is what holds the editor in place: typing a number into plain notes makes
 * them actionable mid-sentence, and the field must not swap itself out from under
 * the caret — so it goes back to the read face only on blur.
 *
 * Each surface keeps its own textarea and its own look (`renderEditor`,
 * `readClassName`); this owns only which face shows and the handoff between them.
 */
export default function TaskNotes({
  value,
  label = "Notes",
  onBlur,
  readClassName,
  readStyle,
  renderEditor,
}: {
  value: string;
  label?: string;
  /** The surface's commit — runs on every way out of the textarea. */
  onBlur?: () => void;
  /** The read face must wear the editor's box exactly, or the swap is a visible jump. */
  readClassName: string;
  readStyle?: CSSProperties;
  renderEditor: (p: NotesEditorProps) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const parts = useMemo(() => recognize(value), [value]);
  const actionable = parts.some((p) => p.kind !== "text");

  const editor = () =>
    renderEditor({
      inputRef,
      onFocus: () => setEditing(true),
      onBlur: () => {
        setEditing(false);
        onBlur?.();
      },
    });
  if (!actionable || editing) return <>{editor()}</>;

  const startEditing = () => {
    // Mount the textarea NOW, then focus it, all inside the tap — iOS only raises
    // the keyboard for a focus() that happens within the user's gesture.
    flushSync(() => setEditing(true));
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  };

  return (
    <div
      {...pressable(startEditing, { role: "group", label: `${label} — press Enter to edit` })}
      onClick={(e) => {
        // A tap on a number, an email or a link acts; it doesn't open the editor.
        if ((e.target as HTMLElement).closest("a")) return;
        // Nor does the end of a drag-select: someone copying a line keeps their selection.
        if (window.getSelection()?.toString()) return;
        startEditing();
      }}
      className={`${readClassName} cursor-text whitespace-pre-wrap [overflow-wrap:anywhere]`}
      style={readStyle}
    >
      {renderRecognized(parts, "notes")}
    </div>
  );
}
