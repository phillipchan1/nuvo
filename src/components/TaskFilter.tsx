// Filters and saved views — one control, both shells.
//
// The audit's rank 6: fixed tabs, and no way to ask a question of your own
// list. This is the ask. The rules are all in the kernel
// (`_shared/taskQuery.ts`); everything here is chrome over `TaskQuery`.
//
// Two shells, one body: `FilterBody` holds every control, and only the frame
// differs — an anchored popover on the desktop, a bottom `Sheet` on the phone
// (never a cursor-anchored popover on a touch screen). Adding a facet means
// touching `FilterBody` once.
//
// What a saved view is NOT: a place. It files nothing, holds nothing, and
// creates no object you can schedule or ship — so it is a question you keep,
// not a fifth pool (P10). It lives in `user_settings.saved_views`.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Button, Dot, IconButton, Input } from "./kit";
import Sheet from "./mobile/Sheet";
import { useIsMobile } from "../hooks/useIsMobile";
import { anchoredTop } from "../lib/anchoredTop";
import type { Label, TaskPriority } from "../lib/types";
import type { VerticalData } from "../lib/vertical";
import {
  describeQuery,
  isEmptyQuery,
  MAX_SAVED_VIEWS,
  queryFacetCount,
  type SavedView,
  type TaskQuery,
  type WhenWindow,
} from "../lib/taskFilter";

const WHEN_LABELS: { id: WhenWindow; label: string }[] = [
  { id: "any", label: "Any time" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "this_week", label: "This week" },
  { id: "next_week", label: "Next week" },
  { id: "undated", label: "Undated" },
];

const PRIORITIES: TaskPriority[] = ["high", "medium", "low", "none"];

/** Toggle one value in an ANY-of list, dropping the key when it empties — an
 *  empty array and an absent one must mean the same thing, or `isEmptyQuery`
 *  starts calling a cleared filter "filtered". */
function toggle<T extends string>(list: T[] | undefined, value: T): T[] | undefined {
  const next = (list ?? []).includes(value) ? (list ?? []).filter((v) => v !== value) : [...(list ?? []), value];
  return next.length ? next : undefined;
}

// ── the chips ──────────────────────────────────────────────────────────────

/** A facet value: a kit chip that stays pressed while it filters. */
function Chip({
  on,
  onClick,
  children,
  color,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string | null;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="k-chip tap-bloom">
      {color && <Dot color={color} shape="round" size="sm" />}
      <span>{children}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="k-filter-group" role="group" aria-label={label}>
      <div className="k-filter-label">{label}</div>
      <div className="k-filter-chips">{children}</div>
    </div>
  );
}

// ── the body (identical on both shells) ────────────────────────────────────

export function FilterBody({
  query,
  onChange,
  labels,
  vertical,
  savedViews,
  onSaveView,
  onDeleteView,
  onApplyView,
}: {
  query: TaskQuery;
  onChange: (q: TaskQuery) => void;
  labels: Label[];
  vertical: VerticalData | undefined;
  savedViews: SavedView[];
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
  onApplyView: (v: SavedView) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);

  const domains = vertical?.domains ?? [];
  const empty = isEmptyQuery(query);
  const patch = (p: Partial<TaskQuery>) => onChange({ ...query, ...p });

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSaveView(trimmed);
    setName("");
    setNaming(false);
  };

  return (
    <div className="k-filter">
      {savedViews.length > 0 && (
        <Group label="Saved">
          {savedViews.map((v) => (
            <span key={v.id} className="group inline-flex items-center">
              <Chip on={false} onClick={() => onApplyView(v)}>
                {v.name}
              </Chip>
              {/* Always there under a finger; on a desk it shows on hover or focus. */}
              <IconButton
                size="xs"
                label={`Delete the “${v.name}” view`}
                icon={<Icon name="close" size={12} />}
                onClick={() => onDeleteView(v.id)}
                className="tap md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
              />
            </span>
          ))}
        </Group>
      )}

      <Group label="When">
        {WHEN_LABELS.map((w) => (
          <Chip
            key={w.id}
            on={(query.when ?? "any") === w.id}
            onClick={() => patch({ when: w.id === "any" ? undefined : w.id })}
          >
            {w.label}
          </Chip>
        ))}
      </Group>

      {query.when && query.when !== "any" && query.when !== "undated" && (
        // Only offered once a window is chosen — "which date" is meaningless
        // without one, and an always-visible toggle reads like a setting.
        <Group label="Which date">
          <Chip on={(query.dateField ?? "do_date") === "do_date"} onClick={() => patch({ dateField: undefined })}>
            When I'll do it
          </Chip>
          <Chip on={query.dateField === "deadline"} onClick={() => patch({ dateField: "deadline" })}>
            When it's due
          </Chip>
        </Group>
      )}

      <Group label="Priority">
        {PRIORITIES.map((p) => (
          <Chip key={p} on={(query.priorities ?? []).includes(p)} onClick={() => patch({ priorities: toggle(query.priorities, p) })}>
            {p === "none" ? "No priority" : p[0].toUpperCase() + p.slice(1)}
          </Chip>
        ))}
      </Group>

      {labels.length > 0 && (
        <Group label="Labels">
          {labels.map((l) => (
            <Chip
              key={l.id}
              color={l.color}
              on={(query.labelIds ?? []).includes(l.id)}
              onClick={() => patch({ labelIds: toggle(query.labelIds, l.id) })}
            >
              {l.name}
            </Chip>
          ))}
        </Group>
      )}

      {domains.length > 0 && (
        <Group label="Domain">
          {domains.map((d) => (
            <Chip
              key={d.id}
              color={d.color}
              on={(query.domainIds ?? []).includes(d.id)}
              onClick={() => patch({ domainIds: toggle(query.domainIds, d.id) })}
            >
              {d.name}
            </Chip>
          ))}
        </Group>
      )}

      <Group label="Status">
        <Chip on={(query.status ?? "open") === "open"} onClick={() => patch({ status: undefined })}>
          Open
        </Chip>
        <Chip on={query.status === "done"} onClick={() => patch({ status: "done" })}>
          Completed
        </Chip>
        <Chip on={query.status === "any"} onClick={() => patch({ status: "any" })}>
          Both
        </Chip>
      </Group>

      <div className="k-filter-foot">
        <Button size="xs" kind="ghost" className="tap-h" onClick={() => onChange({})} disabled={empty}>
          Clear
        </Button>
        {naming ? (
          <span className="flex items-center gap-1.5">
            <Input
              ref={nameRef}
              size="sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") {
                  setNaming(false);
                  setName("");
                }
              }}
              placeholder="Name this view"
              aria-label="Name this view"
              frameClassName="w-40"
            />
            <Button size="xs" kind="primary" className="tap-h" onClick={save}>
              Save
            </Button>
          </span>
        ) : (
          <Button
            size="xs"
            className="tap-h"
            onClick={() => setNaming(true)}
            disabled={empty || savedViews.length >= MAX_SAVED_VIEWS}
            title={savedViews.length >= MAX_SAVED_VIEWS ? `${MAX_SAVED_VIEWS} saved views is the cap` : undefined}
          >
            Save view
          </Button>
        )}
        <span className="k-filter-read">{describeQuery(query, {
          label: (id) => labels.find((l) => l.id === id)?.name,
          domain: (id) => domains.find((d) => d.id === id)?.name,
        })}</span>
      </div>
    </div>
  );
}

// ── the control ────────────────────────────────────────────────────────────

/**
 * The filter pill plus its surface. Desktop opens an anchored popover; the
 * phone opens a bottom Sheet — the two frames a touch screen and a cursor
 * actually want, over one body.
 */
export default function TaskFilter(props: {
  query: TaskQuery;
  onChange: (q: TaskQuery) => void;
  labels: Label[];
  vertical: VerticalData | undefined;
  savedViews: SavedView[];
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
  onApplyView: (v: SavedView) => void;
  /** Opened from outside (the `/` shortcut). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const { query, className = "", open: openProp, onOpenChange } = props;
  const isMobile = useIsMobile();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };

  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const count = useMemo(() => queryFacetCount(query), [query]);

  useEffect(() => {
    if (!open || isMobile) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - 340)),
        top: anchoredTop({
          align: "top",
          anchorTop: r.top,
          anchorHeight: r.height,
          height: 420,
          viewportHeight: window.innerHeight,
        }),
      });
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isMobile]);

  const pill = (
    <Button
      ref={btnRef}
      kind="ghost"
      size="xs"
      active={count > 0}
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-label={count ? `Filters — ${count} active` : "Filter tasks"}
      title="Filter tasks (/)"
      icon={<Icon name="filter" size={13} />}
      data-icon={count > 0 ? undefined : ""}
      className={`tap-bloom shrink-0 ${className}`}
    >
      {count > 0 && <span className="tabular-nums">{count}</span>}
    </Button>
  );

  const body = <FilterBody {...props} />;

  return (
    <>
      {pill}
      {open &&
        (isMobile ? (
          <Sheet onClose={() => setOpen(false)} title="Filter">
            <div className="px-4 pb-4">{body}</div>
          </Sheet>
        ) : (
          pos && (
            <div
              ref={popRef}
              role="dialog"
              aria-label="Filter"
              className="k-pop"
              style={{ left: pos.left, top: pos.top, width: 330, maxHeight: "70vh", padding: 12, zIndex: 60 }}
            >
              {body}
            </div>
          )
        ))}
    </>
  );
}
