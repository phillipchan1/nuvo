import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useVertical } from "../../hooks/useVertical";
import { useActivityUnits } from "../../hooks/useActivity";
import type { ActivityUnit } from "../../lib/types";

interface ThemeGroup { project: string; theme: string | null; titles: string[] }

/** Reflect's "what you built" — merged PRs for the week, grouped by project (the
 *  app), AI-themed into outcome language. Renders nothing when the week shipped
 *  nothing, so it's invisible until there's something to celebrate. */
export function WhatYouBuilt({ weekStartISO }: { weekStartISO: string }) {
  const { data: vertical } = useVertical();
  const range = useMemo(() => {
    const start = new Date(`${weekStartISO}T00:00:00`);
    return { start: start.toISOString(), end: new Date(start.getTime() + 7 * 86_400_000).toISOString() };
  }, [weekStartISO]);
  const { data: units } = useActivityUnits(range.start, range.end);

  // AI theming — best-effort; falls back to raw titles if it fails or isn't deployed.
  const themed = useQuery({
    queryKey: ["activity_theme", weekStartISO],
    queryFn: async (): Promise<ThemeGroup[]> => {
      const { data, error } = await supabase.functions.invoke("github-activity", {
        body: { action: "theme", weekStartISO },
      });
      if (error) throw error;
      return (data?.groups ?? []) as ThemeGroup[];
    },
    enabled: (units?.length ?? 0) > 0,
    staleTime: 5 * 60_000,
    retry: false,
    meta: { silent: true },
  });

  const groups = useMemo(() => groupByProject(units ?? [], vertical), [units, vertical]);
  if (!groups.length) return null;

  const themeFor = (project: string): string | null =>
    themed.data?.find((g) => g.project === project)?.theme ?? null;

  return (
    <section data-marquee="built">
      <div className="section-label mb-3">What you built</div>
      <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-1 flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.color ?? "var(--muted)" }} />
            <span className="text-body font-medium text-ink">{g.name}</span>
          </div>
          {themeFor(g.name) && <p className="mb-1.5 text-body leading-snug text-muted">{themeFor(g.name)}</p>}
          <ul className="flex flex-col gap-1">
            {g.units.map((u) => (
              <li key={u.id} className="flex items-baseline gap-2 text-label text-muted">
                <span className="mono shrink-0 text-meta">↳</span>
                {u.url ? (
                  <a href={u.url} target="_blank" rel="noreferrer" className="hover:text-ink hover:underline">
                    {u.title}
                  </a>
                ) : (
                  <span>{u.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      </div>
    </section>
  );
}

function groupByProject(
  units: ActivityUnit[],
  vertical: ReturnType<typeof useVertical>["data"],
): Array<{ key: string; name: string; color: string | null; units: ActivityUnit[] }> {
  const projName = new Map(vertical.projects.map((p) => [p.id, p]));
  const domColor = new Map(vertical.domains.map((d) => [d.id, d.color]));
  const groups = new Map<string, { key: string; name: string; color: string | null; units: ActivityUnit[] }>();
  for (const u of units) {
    const proj = u.project_id ? projName.get(u.project_id) : null;
    const key = u.project_id ?? u.selector ?? "_";
    const name = proj?.name ?? (u.selector ? u.selector.split("/").pop()! : "Other");
    const color = proj ? domColor.get(proj.domainId) ?? null : null;
    const g = groups.get(key) ?? { key, name, color, units: [] };
    g.units.push(u);
    groups.set(key, g);
  }
  return [...groups.values()];
}
