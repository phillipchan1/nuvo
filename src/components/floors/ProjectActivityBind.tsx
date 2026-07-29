import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { fuzzyFilter } from "../../lib/fuzzy";
import {
  useActivitySource,
  useActivityBindings,
  useActivityActions,
  useActivityUnits,
} from "../../hooks/useActivity";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const repoName = (fullName: string) => fullName.split("/").pop() ?? fullName;

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}
function agoLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/** Per-project "Track activity from…" row. Desktop-only (Project floor). */
export function ProjectActivityBind({
  projectId,
  projectName,
  compact = false,
}: {
  projectId: string;
  projectName: string;
  /** The record's rail is annotation: no boxes, no dashed ghosts, and the
   *  section already carries the "Activity" label, so the row drops its own. */
  compact?: boolean;
}) {
  const { data: source } = useActivitySource();
  const { data: bindings } = useActivityBindings();
  const { bindRepo, unbind } = useActivityActions();
  const { openOverlay, setSettingsSection } = useAppNavigation();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  // count + recency for this project (wide window — units accrue over time)
  const windowStart = useMemo(() => new Date(Date.now() - 365 * 86_400_000).toISOString(), []);
  const windowEnd = useMemo(() => new Date(Date.now() + 86_400_000).toISOString(), []);
  const { data: units } = useActivityUnits(windowStart, windowEnd);

  const binding = (bindings ?? []).find((b) => b.project_id === projectId) ?? null;
  const mine = (units ?? []).filter((u) => u.project_id === projectId);
  const lastDays = mine.length ? Math.min(...mine.map((u) => daysAgo(u.occurred_at))) : null;

  // repos, with the name-matching one floated to the top
  const repos = useMemo(() => {
    const all = source?.repos ?? [];
    const target = norm(projectName);
    const score = (full: string) => {
      const n = norm(repoName(full));
      if (!n || !target) return 0;
      if (n === target) return 2;
      if (n.includes(target) || target.includes(n)) return 1;
      return 0;
    };
    return [...all].sort((a, b) => {
      const s = score(b.full_name) - score(a.full_name);
      if (s) return s;
      return (b.pushed_at ?? "").localeCompare(a.pushed_at ?? "");
    });
  }, [source?.repos, projectName]);
  const suggested = repos[0] && norm(repoName(repos[0].full_name)) &&
    (norm(repoName(repos[0].full_name)) === norm(projectName) ||
      norm(repoName(repos[0].full_name)).includes(norm(projectName)) ||
      norm(projectName).includes(norm(repoName(repos[0].full_name))))
    ? repos[0]
    : null;

  // fuzzy search across all repos (110+) — the front door of the picker
  const MAX_SHOWN = 50;
  const matches = useMemo(
    () => (query.trim() ? fuzzyFilter(query, repos, (r) => r.full_name, 999) : repos),
    [query, repos],
  );
  const list = matches.slice(0, MAX_SHOWN);
  const more = matches.length - list.length;

  const choose = async (repo: string) => {
    if (!source) return;
    setPicking(false);
    try {
      const res = await bindRepo.mutateAsync({ sourceId: source.id, projectId, repo });
      if (res.count > 0) {
        toast.success(`Found ${res.count} thing${res.count === 1 ? "" : "s"} you've shipped here.`);
      } else {
        toast.success("Tracking — shipped work will show up here.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't track that repo.");
    }
  };

  // ── Bound ──────────────────────────────────────────────────────────────
  if (binding) {
    if (compact) {
      return (
        <div className="group flex items-center gap-2 text-meta text-muted">
          <span className="mono min-w-0 flex-1 truncate text-ink">{repoName(binding.selector)}</span>
          <span className="mono shrink-0 tabular-nums">
            {mine.length}{lastDays != null ? ` · ${agoLabel(lastDays)}` : ""}
          </span>
          <button
            onClick={() => binding && unbind.mutate(binding.id)}
            title="Stop tracking"
            aria-label="Stop tracking"
            className="fast shrink-0 rounded-[var(--radius-sm)] px-1 opacity-0 hover:text-signal group-hover:opacity-100"
          >
            ✕
          </button>
        </div>
      );
    }
    return (
      <div className="mb-6 flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-2.5">
        <span className="section-label shrink-0">Activity</span>
        <span className="mono text-label text-ink">{repoName(binding.selector)}</span>
        <span className="mono text-label text-muted">
          {mine.length} shipped{lastDays != null ? ` · last ${agoLabel(lastDays)}` : ""}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => binding && unbind.mutate(binding.id)}
          className="fast mono text-meta text-muted hover:text-signal"
        >
          stop tracking
        </button>
      </div>
    );
  }

  // ── No source connected — never dead-end ───────────────────────────────
  if (!source) {
    if (compact) {
      return (
        <button
          onClick={() => { openOverlay("settings"); setSettingsSection("integrations"); }}
          className="fast text-meta text-muted opacity-75 hover:text-ink hover:opacity-100"
        >
          ＋ Connect a source
        </button>
      );
    }
    return (
      <div className="mb-6 flex items-center gap-3 rounded-md border border-line border-dashed px-4 py-2.5">
        <span className="section-label shrink-0">Track activity from</span>
        <span className="text-label text-muted">No activity source yet.</span>
        <div className="flex-1" />
        <button
          onClick={() => { openOverlay("settings"); setSettingsSection("integrations"); }}
          className="fast mono text-meta text-accent hover:underline"
        >
          Connect in Settings →
        </button>
      </div>
    );
  }

  // ── Connected, unbound ─────────────────────────────────────────────────
  return (
    <div className={`relative ${compact ? "" : "mb-6"}`}>
      {compact ? (
        <button
          onClick={() => { setQuery(""); setPicking((v) => !v); }}
          disabled={bindRepo.isPending}
          className="fast text-meta text-muted opacity-75 hover:text-ink hover:opacity-100"
        >
          {bindRepo.isPending ? "Linking…" : "＋ Repo"}
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-md border border-line px-4 py-2.5">
          <span className="section-label shrink-0">Track activity from</span>
          <div className="flex-1" />
          <button
            onClick={() => { setQuery(""); setPicking((v) => !v); }}
            className="fast mono text-meta text-accent hover:underline"
            disabled={bindRepo.isPending}
          >
            {bindRepo.isPending ? "Linking…" : "Pick a repo →"}
          </button>
        </div>
      )}

      {picking && (
        <div className="glass-card absolute right-0 z-20 mt-1.5 flex max-h-80 w-96 flex-col rounded-lg border border-line shadow-[var(--shadow-lift)]">
          {/* fuzzy search — 110+ repos, so this is the front door */}
          <div className="border-b border-line p-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${repos.length} repos…`}
              autoFocus
              className="mono w-full rounded-md bg-transparent px-2 py-1.5 text-label outline-none placeholder:text-muted"
              onKeyDown={(e) => {
                if (e.key === "Enter" && list[0]) choose(list[0].full_name);
                if (e.key === "Escape") { e.stopPropagation(); setPicking(false); }
              }}
            />
          </div>
          <div className="overflow-y-auto p-1.5">
            {suggested && !query.trim() && (
              <button
                onClick={() => choose(suggested.full_name)}
                className="fast mb-1 flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left"
                style={{ background: "color-mix(in oklab, var(--slot) 12%, transparent)" }}
              >
                <span className="text-label text-ink">
                  This looks like the <span className="mono">{repoName(suggested.full_name)}</span> repo — track it?
                </span>
                <span className="mono text-meta text-muted">{suggested.full_name}</span>
              </button>
            )}
            {list.map((r) =>
              !query.trim() && r === suggested ? null : (
                <button
                  key={r.full_name}
                  onClick={() => choose(r.full_name)}
                  className="fast flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left hover:bg-surface-2"
                >
                  <span className="mono truncate text-label text-ink">{r.full_name}</span>
                  <span className="mono shrink-0 text-meta text-muted">
                    {r.pushed_at ? `${agoLabel(daysAgo(r.pushed_at))}` : ""}
                  </span>
                </button>
              ),
            )}
            {!repos.length && <div className="px-2.5 py-2 text-label text-muted">This token can't see any repos.</div>}
            {repos.length > 0 && !list.length && (
              <div className="px-2.5 py-2 text-label text-muted">
                No repo matches “{query.trim()}”. A private repo? your token may be public-only — re-scope it in
                Settings → Integrations.
              </div>
            )}
            {more > 0 && (
              <div className="px-2.5 py-1.5 text-meta text-muted">+{more} more — keep typing to narrow.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
