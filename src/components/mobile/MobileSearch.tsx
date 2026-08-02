// Global search — the fastest way around the phone. One field, reachable from
// the top bar on every tab, that matches across the whole vertical (projects,
// initiatives, domains) AND tasks. Tap a result to jump straight there: vertical
// items open their Plan detail, tasks open the task sheet. No drill-down, no tab
// hunting. Pure read: it searches the live VerticalData snapshot + task rows.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { domainById, initiativeById, projectById, taskDomainColor, type VerticalData } from "../../lib/vertical";
import type { Task } from "../../lib/types";
import Sheet from "./Sheet";

export type JumpKind = "domain" | "initiative" | "project";

export default function MobileSearch({
  vertical,
  tasks,
  onOpenItem,
  onOpenTask,
  onClose,
}: {
  vertical: VerticalData;
  tasks: Task[];
  onOpenItem: (kind: JumpKind, id: string) => void;
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus after the sheet's rise so iOS reliably raises the keyboard.
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(id);
  }, []);

  const query = q.trim().toLowerCase();

  const results = useMemo(() => {
    if (!query) return null;
    // prefix match beats a mid-string match; take the best field per item.
    const rank = (s: string | null | undefined): number | null => {
      if (!s) return null;
      const i = s.toLowerCase().indexOf(query);
      return i < 0 ? null : i === 0 ? 0 : 1;
    };
    const best = (...fields: (string | null | undefined)[]): number | null => {
      let b: number | null = null;
      for (const f of fields) {
        const r = rank(f);
        if (r != null && (b == null || r < b)) b = r;
      }
      return b;
    };
    const take = <T,>(scored: { item: T; s: number; name: string }[]) =>
      scored.sort((a, b) => a.s - b.s || a.name.localeCompare(b.name)).slice(0, 8).map((x) => x.item);

    const projects = take(
      vertical.projects
        .map((p) => ({ item: p, s: best(p.name, p.outcome), name: p.name }))
        .filter((x): x is { item: typeof x.item; s: number; name: string } => x.s != null),
    );
    const initiatives = take(
      vertical.initiatives
        .map((i) => ({ item: i, s: best(i.name, i.outcome), name: i.name }))
        .filter((x): x is { item: typeof x.item; s: number; name: string } => x.s != null),
    );
    const domains = take(
      vertical.domains
        .map((dm) => ({ item: dm, s: best(dm.name, dm.intention), name: dm.name }))
        .filter((x): x is { item: typeof x.item; s: number; name: string } => x.s != null),
    );
    const taskItems = take(
      tasks
        .filter((t) => t.status !== "trashed")
        .map((t) => ({ item: t, s: best(t.title), name: t.title }))
        .filter((x): x is { item: typeof x.item; s: number; name: string } => x.s != null),
    );
    const total = projects.length + initiatives.length + domains.length + taskItems.length;
    return { projects, initiatives, domains, tasks: taskItems, total };
  }, [query, vertical, tasks]);

  const taskContext = (t: Task): string => {
    if (t.project_id) return projectById(vertical, t.project_id)?.name ?? "Project";
    if (t.initiative_id) return initiativeById(vertical, t.initiative_id)?.name ?? "Initiative";
    if (t.domain_id) return domainById(vertical, t.domain_id)?.name ?? "Domain";
    return t.status === "inbox" ? "Inbox" : "Loose";
  };

  return (
    <Sheet onClose={onClose} tall contentClassName="flex flex-col">
      <div className="shrink-0 px-3 pb-2 pt-1">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3">
          <SearchGlyph />
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects, initiatives, domains, tasks…"
            aria-label="Search"
            className="tap min-w-0 flex-1 appearance-none bg-transparent py-2 outline-none [&::-webkit-search-cancel-button]:hidden"
            autoCapitalize="none"
            autoCorrect="off"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="fast flex h-11 w-11 shrink-0 items-center justify-center text-lead text-muted active:text-ink"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto pb-4">
        {!results ? (
          <Note>Type to jump to anything — a project, an initiative, a domain, or a task.</Note>
        ) : results.total === 0 ? (
          <Note>No matches for “{q.trim()}”.</Note>
        ) : (
          <>
            <Group label="Projects" items={results.projects}>
              {(p) => (
                <ResultRow
                  key={p.id}
                  accent={domainById(vertical, p.domainId)?.color}
                  title={p.name}
                  subtitle={projectContext(vertical, p.domainId, p.initiativeId)}
                  onClick={() => onOpenItem("project", p.id)}
                />
              )}
            </Group>
            <Group label="Initiatives" items={results.initiatives}>
              {(i) => (
                <ResultRow
                  key={i.id}
                  accent={domainById(vertical, i.domainId)?.color}
                  title={i.name}
                  subtitle={domainById(vertical, i.domainId)?.name ?? undefined}
                  onClick={() => onOpenItem("initiative", i.id)}
                />
              )}
            </Group>
            <Group label="Domains" items={results.domains}>
              {(dm) => (
                <ResultRow
                  key={dm.id}
                  accent={dm.color}
                  glyph={dm.icon}
                  title={dm.name}
                  subtitle={dm.intention || undefined}
                  onClick={() => onOpenItem("domain", dm.id)}
                />
              )}
            </Group>
            <Group label="Tasks" items={results.tasks}>
              {(t) => (
                <ResultRow
                  key={t.id}
                  accent={taskDomainColor(vertical, t) ?? undefined}
                  title={t.title}
                  subtitle={taskContext(t)}
                  dim={t.status === "done"}
                  onClick={() => onOpenTask(t.id)}
                />
              )}
            </Group>
          </>
        )}
      </div>
    </Sheet>
  );
}

// Where a project lives, for the flat result row: "Domain · Initiative".
function projectContext(v: VerticalData, domainId: string, initiativeId: string | null): string | undefined {
  const dom = domainById(v, domainId);
  const init = initiativeId ? initiativeById(v, initiativeId) : null;
  const head = dom?.name ?? "";
  if (init) return head ? `${head} · ${init.name}` : init.name;
  return head || undefined;
}

function Group<T>({ label, items, children }: { label: string; items: T[]; children: (item: T) => ReactNode }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 first:mt-1">
      <div className="section-label px-4 pb-1">{label}</div>
      {items.map(children)}
    </div>
  );
}

function ResultRow({
  accent,
  glyph,
  title,
  subtitle,
  dim,
  onClick,
}: {
  accent?: string;
  glyph?: string;
  title: string;
  subtitle?: string;
  dim?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="tap fast flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2"
    >
      {glyph ? (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-body"
          style={{ background: `color-mix(in srgb, ${accent ?? "var(--muted)"} 16%, var(--surface))`, color: accent ?? "var(--muted)" }}
        >
          {glyph}
        </span>
      ) : (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent ?? "var(--line-strong)" }} />
      )}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-head font-medium ${dim ? "text-muted line-through" : ""}`}>{title}</div>
        {subtitle && <div className="truncate text-caption text-muted">{subtitle}</div>}
      </div>
    </button>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="px-6 py-12 text-center text-body text-muted">{children}</div>;
}

function SearchGlyph() {
  return (
    <svg className="shrink-0 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.4-3.4" />
    </svg>
  );
}
