// Global search on the phone — one field, reachable from the top bar on every
// tab. A layout over `useSearch` (D-210): the same ranking, the same date
// reading and the same recents as the desktop's `/` door, at thumb size.
// The field is docked at the bottom, above the keyboard, the way iOS does it
// (Safari, Maps, Mail) — a tall sheet with the field at the top lost it off the
// top of the screen once the keys rose.
// Tap a result to jump straight there: vertical items open their detail,
// tasks open the task sheet, a day or a meeting lands on the Calendar.

import { useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icon";
import type { VerticalData } from "../../lib/vertical";
import type { Task } from "../../lib/types";
import { eventHitSubtitle, type EventHit } from "../../lib/eventSearch";
import type { SearchHit } from "../../lib/search";
import { useSearch } from "../../hooks/useSearch";
import { useRaiseKeyboard } from "../../hooks/useRaiseKeyboard";
import Sheet from "./Sheet";
import { Dot, IconButton, SearchField } from "../kit";
import { PhEmpty, PhSection } from "./touch";
import DomainSymbol from "../domain/DomainSymbol";
import Highlight from "../search/Highlight";

export type JumpKind = "domain" | "initiative" | "project";

export default function MobileSearch({
  vertical,
  tasks,
  onOpenItem,
  onOpenTask,
  onOpenEvent,
  onOpenDate,
  onClose,
}: {
  vertical: VerticalData;
  tasks: Task[];
  onOpenItem: (kind: JumpKind, id: string) => void;
  onOpenTask: (id: string) => void;
  /** Land on a calendar event's day. Optional so the sheet still works in a
   *  host that has no calendar to land on. */
  onOpenEvent?: (hit: EventHit) => void;
  /** Land on a day the query named ("friday"). Optional for the same reason. */
  onOpenDate?: (dateISO: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useRaiseKeyboard(inputRef);

  const model = useSearch(q, { vertical, tasks, withEvents: !!onOpenEvent });
  const { events, eventsLoading, eventsOffline } = model;
  const searching = q.trim().length > 0;
  const localTotal = model.sections.reduce((n, s) => n + s.hits.length, 0);

  const openHit = (h: SearchHit) => {
    model.remember({ kind: h.kind, id: h.id });
    if (h.kind === "task") onOpenTask(h.id);
    else onOpenItem(h.kind, h.id);
  };
  const hitRow = (h: SearchHit) => (
    <ResultRow
      key={`${h.kind}:${h.id}`}
      accent={h.color}
      glyph={h.kind === "domain" ? <DomainSymbol value={h.icon} size={16} /> : undefined}
      title={<Highlight text={h.title || "Untitled"} ranges={h.ranges} />}
      subtitle={[h.context, h.when].filter(Boolean).join(" · ") || undefined}
      dim={h.done && h.kind === "task"}
      past={h.done && h.kind !== "task"}
      onClick={() => openHit(h)}
    />
  );

  return (
    <Sheet onClose={onClose} tall fitViewport contentClassName="flex flex-col">
      <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        {onOpenDate && model.date && (
          <div>
            <PhSection title="Go to" />
            <ResultRow
              glyph={<Icon name="calendar" size={16} />}
              title={model.date.label}
              subtitle="Calendar"
              onClick={() => onOpenDate(model.date!.dateISO)}
            />
          </div>
        )}
        {!searching ? (
          model.recent.length > 0 ? (
            <div>
              <PhSection title="Recent" />
              {model.recent.map(hitRow)}
            </div>
          ) : (
            <PhEmpty icon="search">Find anything</PhEmpty>
          )
        ) : localTotal === 0 && events.length === 0 && !eventsLoading && !model.date ? (
          <PhEmpty>No matches</PhEmpty>
        ) : (
          <>
            {model.sections.map((s) => (
              <div key={s.kind}>
                <PhSection title={s.label} count={s.hits.length} />
                {s.hits.map(hitRow)}
              </div>
            ))}
            {/* Calendar last: it lands a beat after the local groups, so nothing
                already under the thumb moves when it does. */}
            {onOpenEvent && (eventsOffline || eventsLoading || events.length > 0) && (
              <div>
                <PhSection title="Calendar" count={events.length || undefined} />
                {eventsOffline ? (
                  <div className="px-4 py-2 text-caption text-muted">Offline</div>
                ) : events.length === 0 ? (
                  <div className="px-4 py-2 text-caption text-[var(--faint)]">Looking…</div>
                ) : (
                  events.map((e) => (
                    <ResultRow
                      key={e.id}
                      title={e.title || "Untitled event"}
                      subtitle={eventHitSubtitle(e)}
                      past={e.when === "past"}
                      onClick={() => onOpenEvent(e)}
                    />
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
      {/* Docked at the bottom, the iOS way (Safari, Maps, Mail): the field is
          the thing under the thumb and the keyboard rises straight into it, so
          it can never be pushed off the top of a screen-sized sheet. It stops
          the sheet's swipe-to-dismiss — a thumb resting on the field is
          placing a caret, not leaving. */}
      <div
        className="shrink-0 border-t border-[var(--line-1)] px-4 pb-2 pt-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <SearchField
          ref={inputRef}
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search work and your calendar"
          aria-label="Search"
          autoCapitalize="none"
          autoCorrect="off"
          frameClassName="ph-search"
          trailing={
            q ? (
              <IconButton
                label="Clear search"
                size="sm"
                icon={<Icon name="close" size={16} />}
                onClick={() => setQ("")}
                className="tap-icon -mr-1.5 shrink-0"
              />
            ) : undefined
          }
        />
      </div>

    </Sheet>
  );
}

function ResultRow({
  accent,
  glyph,
  title,
  subtitle,
  dim,
  past,
  onClick,
}: {
  accent?: string;
  glyph?: ReactNode;
  title: ReactNode;
  subtitle?: string;
  /** Done — struck through. */
  dim?: boolean;
  /** Behind us — quieter, but NOT struck: a meeting that happened isn't a
   *  meeting that was cancelled. */
  past?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="ph-row row-hover py-1.5">
      <span className="ph-row-lead" style={glyph ? { color: accent ?? "var(--muted)" } : undefined}>
        {glyph ?? <Dot color={accent ?? "var(--faint)"} shape="round" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`ph-row-title block ${dim ? "!text-[var(--faint)] line-through" : past ? "!text-muted" : ""}`}>{title}</span>
        {subtitle && <span className="block truncate text-caption text-muted">{subtitle}</span>}
      </span>
    </button>
  );
}
