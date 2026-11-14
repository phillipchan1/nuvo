// `/` — the desktop's search door (D-210).
//
// Its own door with its own key, as N-19 asked: ⌘K adds, `/` finds, and one
// line never has to guess which you meant. The Command frame (the kit's scrim,
// a 600px card whose line is the head) and kit Rows; the ranking is
// `useSearch` — the same read the phone's Search sheet draws.
//
// Keyboard: ↑↓ move, ↵ opens, Esc clears the line and then leaves (D-051).
// The active row carries its ↵ keycap; there is no hint row (Say it once).

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { Dot, EmptyState, Kbd, Row, SectionHeader } from "../kit";
import DomainSymbol from "../domain/DomainSymbol";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { useSearch } from "../../hooks/useSearch";
import { eventHitSubtitle, type EventHit } from "../../lib/eventSearch";
import type { SearchHit, SearchKind } from "../../lib/search";
import Highlight from "./Highlight";
import type { Task } from "../../lib/types";
import type { VerticalData } from "../../lib/vertical";

export type SearchTarget =
  | { kind: SearchKind; id: string }
  | { kind: "event"; hit: EventHit }
  | { kind: "date"; dateISO: string };

interface Item {
  key: string;
  target: SearchTarget;
  node: (slot: Slot) => ReactNode;
}

export default function SearchDoor({
  vertical,
  tasks,
  onOpen,
  onClose,
}: {
  vertical: VerticalData;
  tasks: readonly Task[];
  onOpen: (target: SearchTarget) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useDialogFocus(panel);
  const listId = useId();

  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const model = useSearch(q, { vertical, tasks });

  const open = (t: SearchTarget) => {
    if (t.kind !== "event" && t.kind !== "date") model.remember({ kind: t.kind, id: t.id });
    onOpen(t);
  };

  // One flat list in reading order — the keyboard walks it, the sections only
  // draw it. The date row leads (if the query IS a day, that's the answer);
  // the calendar trails, because it lands a beat later and must not shove
  // rows out from under the cursor when it does.
  const { groups, items } = useMemo(() => {
    const groups: { label: string; count?: number; items: Item[] }[] = [];
    if (model.date) {
      const d = model.date;
      groups.push({
        label: "Go to",
        items: [
          {
            key: `date:${d.dateISO}`,
            target: { kind: "date", dateISO: d.dateISO },
            node: (slot) => (
              <ResultRow {...slot} leading={<Icon name="calendar" size={14} />} title={d.label} meta="Schedule" />
            ),
          },
        ],
      });
    }
    if (!q.trim()) {
      if (model.recent.length) groups.push({ label: "Recent", items: model.recent.map(hitItem) });
    } else {
      for (const s of model.sections) groups.push({ label: s.label, count: s.hits.length, items: s.hits.map(hitItem) });
      if (model.events.length) {
        groups.push({
          label: "Calendar",
          count: model.events.length,
          items: model.events.map((e) => ({
            key: `event:${e.id}`,
            target: { kind: "event", hit: e },
            node: (slot) => (
              <ResultRow
                {...slot}
                done={e.when === "past"}
                leading={<Icon name="calendar" size={14} />}
                title={e.title || "Untitled event"}
                meta={eventHitSubtitle(e)}
              />
            ),
          })),
        });
      }
    }
    return { groups, items: groups.flatMap((g) => g.items) };
  }, [model, q]);

  // A new query starts at the top: the best answer is always the first row.
  useEffect(() => setActive(0), [q]);
  const at = Math.min(active, Math.max(0, items.length - 1));

  // Keep the active row in view when the keyboard moves it (only then — a
  // hover must never scroll the list under the pointer).
  const keyMoved = useRef(false);
  useEffect(() => {
    if (!keyMoved.current) return;
    keyMoved.current = false;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || (e.ctrlKey && (e.key === "n" || e.key === "p"))) {
      e.preventDefault();
      if (!items.length) return;
      const down = e.key === "ArrowDown" || e.key === "n";
      keyMoved.current = true;
      setActive((i) => (Math.min(i, items.length - 1) + (down ? 1 : items.length - 1)) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[at];
      if (it) open(it.target);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (q) setQ("");
      else onClose();
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const searching = q.trim().length > 0;
  const nothing = searching && items.length === 0 && !model.eventsLoading;
  let n = -1;

  return createPortal(
    <div className="k-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Search" tabIndex={-1} className="k-command k-search">
        <div className="ks-line">
          <Icon name="search" size={16} />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Find a task, project, domain or meeting"
            aria-label="Search"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={items.length ? optionId(at) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {model.eventsLoading && searching && <span className="ks-busy" aria-label="Searching the calendar" />}
          <Kbd keys="esc" />
        </div>

        <div ref={list} id={listId} role="listbox" aria-label="Results" className="ks-body">
          {groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label} className="ks-group">
              <SectionHeader title={g.label} count={g.count} />
              {g.items.map((it) => {
                n += 1;
                const i = n;
                return (
                  <Fragment key={it.key}>
                    {it.node({ id: optionId(i), active: i === at, onHover: () => i !== at && setActive(i), onPick: () => open(it.target) })}
                  </Fragment>
                );
              })}
            </div>
          ))}
          {nothing && <EmptyState>No matches</EmptyState>}
          {searching && model.eventsOffline && <div className="ks-note">Calendar is offline</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const NOUN: Record<SearchKind, string> = { task: "Task", project: "Project", initiative: "Initiative", domain: "Domain" };

function hitItem(h: SearchHit): Item {
  return {
    key: `${h.kind}:${h.id}`,
    target: { kind: h.kind, id: h.id },
    node: (slot) => (
      <ResultRow
        {...slot}
        done={h.done}
        leading={
          h.kind === "domain" ? (
            <span className="ks-glyph" style={{ color: h.color ?? "var(--muted)" }}>
              <DomainSymbol value={h.icon} size={14} />
            </span>
          ) : (
            <Dot color={h.color ?? "var(--faint)"} shape={h.kind === "task" ? "round" : "square"} />
          )
        }
        title={<Highlight text={h.title || "Untitled"} ranges={h.ranges} />}
        context={h.context}
        meta={h.when ?? (h.done ? (h.kind === "task" ? "Done" : "Shipped") : NOUN[h.kind])}
        signal={h.when === "Overdue"}
      />
    ),
  };
}

/** What a row needs from the list: its option id, whether it's the active
 *  one, and the two pointer acts (hover moves the selection, a click opens). */
interface Slot {
  id: string;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

function ResultRow({
  id,
  active,
  onHover,
  onPick,
  done,
  leading,
  title,
  context,
  meta,
  signal,
}: Slot & {
  done?: boolean;
  leading: ReactNode;
  title: ReactNode;
  context?: string;
  meta?: string;
  signal?: boolean;
}) {
  return (
    <Row
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      selected={active}
      done={done}
      density="comfy"
      className="ks-row"
      leading={<span className="ks-lead">{leading}</span>}
      title={
        <>
          <span className="ks-title">{title}</span>
          {context && <span className="ks-ctx">{context}</span>}
        </>
      }
      meta={meta ? <span data-signal={signal || undefined}>{meta}</span> : undefined}
      trailing={<Kbd keys="↵" className="ks-enter" />}
      onMouseMove={onHover}
      // keep the caret in the line — a click must not blur the field
      onMouseDown={(e) => e.preventDefault()}
      onActivate={onPick}
    />
  );
}
