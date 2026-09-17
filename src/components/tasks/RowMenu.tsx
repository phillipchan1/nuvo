/**
 * RowMenu — the small keyboard menu a task list opens beside a row (`t` for a
 * date, `v` to move). A search field on top, a list below; ↑↓ ↵ drive it, esc
 * closes it and nothing else. Desktop only: on a phone these acts live on the
 * row's sheet, which is the phone's overlay (CLAUDE.md, mobile overlays).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface RowMenuItem {
  id: string;
  label: ReactNode;
  /** Right-aligned quiet text: a kind, a date, a key. */
  hint?: string;
  swatch?: string | null;
  run: () => void;
}

export default function RowMenu({
  anchor,
  title,
  placeholder,
  query,
  onQuery,
  items,
  empty = "Nothing matches",
  onClose,
}: {
  anchor: DOMRect;
  title: string;
  placeholder: string;
  query: string;
  onQuery: (q: string) => void;
  items: RowMenuItem[];
  empty?: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: anchor.bottom + 4, left: anchor.left + 24 });
  const safe = items.length ? Math.min(index, items.length - 1) : 0;

  useEffect(() => setIndex(0), [query]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const below = anchor.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 4) : below;
    setPos({ top, left: Math.max(8, Math.min(anchor.left + 24, window.innerWidth - width - 8)) });
  }, [anchor, items.length]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  const run = (item: RowMenuItem | undefined) => {
    if (!item) return;
    item.run();
    onClose();
  };

  const list = useMemo(() => items, [items]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      data-nested-surface=""
      className="rise elev-3 fixed z-[75] w-[260px] rounded-[10px] border border-line bg-surface p-1"
      style={{ top: pos.top, left: pos.left }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="px-2 pb-1 pt-1.5 text-meta text-muted">{title}</div>
      <input
        autoFocus
        value={query}
        placeholder={placeholder}
        aria-label={title}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => (list.length ? (i + 1) % list.length : 0));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => (list.length ? (i - 1 + list.length) % list.length : 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(list[safe]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="nuvo-inline-input mb-1 w-full rounded-md border border-line bg-surface-2 px-2 py-1 text-caption outline-none"
      />
      <div role="listbox" className="max-h-[280px] overflow-y-auto">
        {list.length === 0 && <div className="px-2 py-2 text-caption text-muted">{empty}</div>}
        {list.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={i === safe}
            onMouseEnter={() => setIndex(i)}
            onClick={() => run(item)}
            className={`task-composer-option ${i === safe ? "is-active" : ""}`}
          >
            {item.swatch !== undefined && (
              <span className="task-composer-swatch" style={{ background: item.swatch ?? "var(--line-strong)" }} />
            )}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.hint && <span className="mono shrink-0 text-meta text-muted">{item.hint}</span>}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
