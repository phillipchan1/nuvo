// The floor shell: the altitude router plus a context-aware top bar. The
// Project and Initiative rungs mirror each other — both open on On Deck (the
// demand timeline), with Groom and Table as sibling views, and drill into a
// single record's detail.

import { useEffect } from "react";
import { useVertical } from "../hooks/useVertical";
import { domainById, initiativeById } from "../lib/vertical";
import type { Focus, Rung } from "./AppShell";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { Keycap } from "./ui";
import DomainFloor from "./floors/DomainFloor";
import InitiativeFloor from "./floors/InitiativeFloor";
import InitiativesFloor from "./floors/InitiativesFloor";
import InitiativeOnDeckFloor from "./floors/InitiativeOnDeckFloor";
import PortfolioFloor from "./floors/PortfolioFloor";
import OnDeckFloor from "./floors/OnDeckFloor";
import GroomFloor from "./floors/GroomFloor";
import ProjectReadinessStrip from "./floors/ProjectReadinessStrip";
import NowFloor from "./floors/NowFloor";

// The two faces of the project altitude: "ondeck" answers WHEN (time-box projects
// across weeks, with the needs-a-week inbox); "groom" answers WHAT (shape each
// project's outcome + steps on the wall). "all" is the filing-cabinet Collection
// (table/board). A single project opens in the Record modal.
export type ProjectView = "ondeck" | "groom" | "all";
// The initiative rung mirrors the project one: "ondeck" (bets grouped by quarter,
// the front door), "groom" (the readiness/quick-grooming surface), "all" (the
// Collection table), and "detail" (one bet's full page). A single bet opens in the
// Record modal; the full page is one "open full page ↗" away.
export type DetailView = "ondeck" | "groom" | "all" | "detail";

export default function FloorPane({
  rung,
  focus,
  focusDomain,
  goRung,
  projectView,
  setProjectView,
  initiativeView,
  setInitiativeView,
}: {
  rung: Rung;
  focus: Focus;
  focusDomain: (id: string) => void;
  goRung: (r: Rung) => void;
  projectView: ProjectView;
  setProjectView: (v: ProjectView) => void;
  initiativeView: DetailView;
  setInitiativeView: (v: DetailView) => void;
}) {
  const { data } = useVertical();
  const { openRecord, toggleAgent, nav } = useAppNavigation();
  const { agentOpen } = nav;
  const domain = domainById(data, focus.domainId);
  const accent = domain?.color ?? "var(--accent)";

  // Clicking a project / initiative anywhere opens its Record modal (the
  // beautiful, fully-editable command center). The full-page floor stays one
  // "Open full page ↗" away from inside the modal.
  const openProjectRecord = (id: string) => openRecord("project", id);
  const openInitiativeRecord = (id: string) => openRecord("initiative", id);

  // Direct navigation back to the portfolio list — does not rely on history.back()
  // so it works regardless of how the user arrived at the detail view (e.g. via
  // "full page ↗" from a Record modal, which would otherwise pop back to the modal).
  const backToProjects = () => setProjectView("ondeck");
  const backToInitiatives = () => setInitiativeView("ondeck");

  // Show a back arrow in the top bar when a detail is open AND there's no
  // natural breadcrumb (i.e. the user can't see which list to click back to).
  const showBackBtn = rung === "initiative" && initiativeView === "detail";
  const onBackBtn = backToInitiatives;

  const viewKey = rung === "project" ? projectView : rung === "initiative" ? initiativeView : "";

  // Plain 1 · 2 · 3 switch the project faces (On Deck · Groom · Table) — like the
  // Schedule view's number keys. Scoped to the project rung, and never while
  // typing (composer / brief / step edits). ⌘1–5 stays the global rung nav.
  useEffect(() => {
    if (rung !== "project") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      const map: Record<string, ProjectView> = { "1": "ondeck", "2": "groom", "3": "all" };
      const v = map[e.key];
      if (v) { e.preventDefault(); setProjectView(v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rung, setProjectView]);

  return (
    // Transparent: the floor overlay (AppShell) already paints .atmosphere, the
    // one continuous warm-paper canvas. Painting an opaque bg here covered it and
    // made each floor read as a flat panel instead of the same paper as Schedule.
    <div className="flex h-full flex-col">
      <div
        data-tauri-drag-region
        className="app-topbar flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-5"
      >
        {/* Back arrow — always reachable, replaces the need to find the breadcrumb */}
        {showBackBtn && (
          <button
            onClick={onBackBtn}
            title="Back (⌘[)"
            className="fast mono mr-1 flex items-center gap-0.5 text-body text-muted hover:text-ink"
          >
            ‹
          </button>
        )}

        {rung === "now" && <span className="mono text-label font-medium text-ink">Today</span>}
        {rung === "domain" && <span className="mono text-label font-medium text-ink">Domains</span>}
        {rung === "project" && (
          <RungTabs
            tabs={[
              { id: "ondeck", label: "On Deck", on: backToProjects },
              { id: "groom", label: "Groom", on: () => setProjectView("groom") },
              { id: "all", label: "Table", on: () => setProjectView("all") },
            ]}
            active={projectView}
            detailName={null}
            accent={accent}
            big
          />
        )}
        {rung === "initiative" && (
          <RungTabs
            tabs={[
              { id: "ondeck", label: "On Deck", on: backToInitiatives },
              { id: "groom", label: "Grooming", on: () => setInitiativeView("groom") },
              { id: "all", label: "All initiatives", on: () => setInitiativeView("all") },
            ]}
            active={initiativeView}
            detailName={initiativeView === "detail" ? initiativeById(data, focus.initiativeId)?.name ?? "Initiative" : null}
            accent={accent}
          />
        )}
        <div className="flex-1" />
        <button
          onClick={toggleAgent}
          className={`fast flex items-center gap-1 rounded-md px-2 py-1 text-label ${agentOpen ? "text-accent" : "text-muted hover:text-ink"}`}
          title="Nuvo agent"
        >
          <Keycap>⌘J</Keycap>
        </button>
        <button onClick={() => goRung("day")} className="mono text-label text-muted hover:text-ink">Schedule ↓</button>
      </div>

      <div key={`${rung}-${viewKey}`} className="floor-enter min-h-0 flex-1 overflow-y-auto px-8 py-7">
        {rung === "now" && <NowFloor onOpenDay={() => goRung("day")} />}

        {rung === "project" && (
          <ProjectReadinessStrip onGroom={projectView === "groom" ? undefined : () => setProjectView("groom")} />
        )}
        {rung === "project" && projectView === "ondeck" && <OnDeckFloor onGroom={() => setProjectView("groom")} />}
        {rung === "project" && projectView === "groom" && <GroomFloor />}
        {rung === "project" && projectView === "all" && <PortfolioFloor onOpen={openProjectRecord} />}

        {rung === "initiative" && initiativeView === "ondeck" && <InitiativeOnDeckFloor />}
        {rung === "initiative" && initiativeView === "groom" && (
          <InitiativesFloor onOpen={openInitiativeRecord} pin="standing" />
        )}
        {rung === "initiative" && initiativeView === "all" && (
          <InitiativesFloor onOpen={openInitiativeRecord} pin="board" />
        )}
        {rung === "initiative" && initiativeView === "detail" && (
          <InitiativeFloor
            focus={focus}
            onUp={() => goRung("domain")}
            onBack={backToInitiatives}
            onOpenProject={openProjectRecord}
          />
        )}

        {rung === "domain" && (
          <DomainFloor focus={focus} onSwitchDomain={focusDomain} onOpenInitiative={openInitiativeRecord} onOpenProject={openProjectRecord} />
        )}
      </div>
    </div>
  );
}

function RungTabs({
  tabs,
  active,
  detailName,
  accent,
  big = false,
}: {
  tabs: { id: string; label: string; on: () => void }[];
  active: string;
  detailName: string | null;
  accent: string;
  /** the project rung's primary destinations — larger, segmented, higher-contrast. */
  big?: boolean;
}) {
  if (big) {
    return (
      <span className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
        {tabs.map((t, i) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              onClick={t.on}
              className="fast flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-body font-medium tracking-tight"
              style={
                on
                  ? { background: "var(--surface)", color: accent, boxShadow: "0 1px 2px rgba(0,0,0,.07)" }
                  : { color: "var(--muted)" }
              }
              title={`${t.label}  ·  ${i + 1}`}
            >
              <span className="mono text-micro font-normal tabular-nums" style={{ opacity: on ? 0.55 : 0.4 }}>{i + 1}</span>
              {t.label}
            </button>
          );
        })}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-3">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={t.on}
          className="fast mono text-label hover:text-ink"
          style={{ color: active === t.id ? accent : "var(--muted)", fontWeight: active === t.id ? 600 : 400 }}
        >
          {t.label}
        </button>
      ))}
      {detailName && (
        <>
          <span className="text-muted">›</span>
          <span className="mono max-w-[220px] truncate text-label font-medium" style={{ color: accent }}>{detailName}</span>
        </>
      )}
    </span>
  );
}
