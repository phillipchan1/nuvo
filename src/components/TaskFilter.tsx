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
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`fast tap-bloom inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-2.5 text-label font-medium ${
        on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-line-strong hover:text-ink"
      }`}
    >
      {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="section-label mb-1.5 !p-0">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
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
    <div className="space-y-3.5">
      {savedViews.length > 0 && (
        <Group label="Saved">
          {savedViews.map((v) => (
            <span key={v.id} className="group inline-flex items-center">
              <Chip on={false} onClick={() => onApplyView(v)}>
                {v.name}
              </Chip>
              <button
                type="button"
                onClick={() => onDeleteView(v.id)}
                aria-label={`Delete the “${v.name}” view`}
                title={`Delete the “${v.name}” view`}
                className="fast -ml-1 flex h-8 w-6 items-center justify-center rounded text-muted opacity-0 hover:text-signal focus:opacity-100 group-hover:opacity-100"
              >
                <Icon name="close" size={11} />
              </button>
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
            {p === "none" ? "No priority" : p}
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

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => onChange({})}
          disabled={empty}
          className="fast tap-bloom rounded-full border border-line px-2.5 py-1 text-label font-medium text-muted disabled:opacity-40 enabled:hover:border-line-strong enabled:hover:text-ink"
        >
          Clear
        </button>
        {naming ? (
          <span className="flex items-center gap-1.5">
            <input
              ref={nameRef}
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
              className="min-h-[32px] w-40 rounded-full border border-line bg-surface px-2.5 text-label text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={save}
              className="fast tap-bloom rounded-full bg-accent px-2.5 py-1 text-label font-medium text-on-accent"
            >
              Save
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            disabled={empty || savedViews.length >= MAX_SAVED_VIEWS}
            title={savedViews.length >= MAX_SAVED_VIEWS ? `${MAX_SAVED_VIEWS} saved views is the cap` : undefined}
            className="fast tap-bloom rounded-full border border-line px-2.5 py-1 text-label font-medium text-muted disabled:opacity-40 enabled:hover:border-line-strong enabled:hover:text-ink"
          >
            Save this view
          </button>
        )}
        <span className="mono ml-auto truncate text-meta text-muted">{describeQuery(query, {
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
    <button
      ref={btnRef}
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-label={count ? `Filters — ${count} active` : "Filter tasks"}
      title="Filter tasks  ( / )"
      className={`fast tap-bloom inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-full border px-2 text-label font-medium ${
        count ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-line-strong hover:text-ink"
      } ${className}`}
    >
      <Icon name="filter" size={12} />
      {count > 0 && <span className="mono leading-none">{count}</span>}
    </button>
  );

  const body = <FilterBody {...props} />;

  return (
    <>
      {pill}
      {open &&
        (isMobile ? (
          <Sheet onClose={() => setOpen(false)} title="Filter">
            {body}
          </Sheet>
        ) : (
          pos && (
            <div
              ref={popRef}
              className="glass-card fixed z-[60] w-[330px] max-h-[70vh] overflow-y-auto rounded-xl p-3"
              style={{ left: pos.left, top: pos.top, boxShadow: "var(--shadow-lift)" }}
            >
              {body}
            </div>
          )
        ))}
    </>
  );
}
