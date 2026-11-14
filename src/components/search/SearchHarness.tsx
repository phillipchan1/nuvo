// Standalone verify harness for search (D-210) — the desktop's `/` door and the
// phone's Search sheet over the SAME fixtures, so the shared ranking can be
// driven on both without a real account. Reached at ?search (mounted in
// main.tsx). Not part of any real surface. Opening a result here only reports
// where it would have gone; nothing is written.
//
// The fixtures are a stranger's account, not the builder's (P16): a job, a
// family, a side project and a body — with live, done, shipped and dated work
// so the ranking's liveness and the "when" column both have something to say.

import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button, Kbd } from "../kit";
import { todayISO } from "../../lib/dates";
import { rememberRecent } from "../../lib/search";
import type { Task } from "../../lib/types";
import type { VerticalData } from "../../lib/vertical";
import SearchDoor, { type SearchTarget } from "./SearchDoor";
import MobileSearch from "../mobile/MobileSearch";

function shift(days: number): string {
  const d = new Date(`${todayISO()}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const dom = (id: string, name: string, color: string, icon: string, intention: string) => ({ id, name, color, icon, intention, charter: "" });

const VERTICAL = {
  domains: [
    dom("d-work", "Northwind", "#2563EB", "building", "Ship the platform migration without burning the team out."),
    dom("d-home", "Family", "#D97706", "heart", "Be home in the evenings, actually present."),
    dom("d-side", "Field Notes", "#7C3AED", "pen", "A newsletter that pays for itself."),
    dom("d-body", "Health", "#059669", "leaf", "Strong enough to carry the kids at 60."),
  ],
  initiatives: [
    { id: "i-mig", domainId: "d-work", name: "Platform migration", outcome: "Every service on the new cluster by March", status: "in_progress" },
    { id: "i-grow", domainId: "d-side", name: "Grow to 2,000 readers", outcome: "", status: "in_progress" },
    { id: "i-hire", domainId: "d-work", name: "Hire two senior engineers", outcome: "", status: "complete" },
  ],
  projects: [
    { id: "p-db", domainId: "d-work", initiativeId: "i-mig", name: "Move billing database", outcome: "Billing reads from the new primary", status: "in_progress" },
    { id: "p-deck", domainId: "d-work", initiativeId: "i-mig", name: "Migration plan deck for leadership", outcome: "", status: "backlog" },
    { id: "p-trip", domainId: "d-home", initiativeId: null, name: "Summer trip to Lisbon", outcome: "Flights, flat, and a plan for the kids", status: "in_progress" },
    { id: "p-launch", domainId: "d-side", initiativeId: "i-grow", name: "Launch the referral program", outcome: "", status: "waiting" },
    { id: "p-old", domainId: "d-side", initiativeId: "i-grow", name: "Redesign the newsletter template", outcome: "", status: "complete" },
  ],
  tasks: [],
} as unknown as VerticalData;

const t = (id: string, title: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    title,
    notes: "",
    status: "backlog",
    do_date: null,
    deadline: null,
    start_time: null,
    project_id: null,
    initiative_id: null,
    domain_id: null,
    parent_task_id: null,
    ...over,
  }) as Task;

const TASKS: Task[] = [
  t("t1", "Draft the cutover runbook", { project_id: "p-db", status: "planned", do_date: shift(0) }),
  t("t2", "Review billing schema diff with Priya", { project_id: "p-db", status: "planned", do_date: shift(2) }),
  t("t3", "Book flights to Lisbon", { project_id: "p-trip", status: "planned", do_date: shift(-2) }),
  t("t4", "Find a flat near Alfama", { project_id: "p-trip", notes: "two bedrooms, walking distance to the tram" }),
  t("t5", "Write issue #42 — on saying no", { domain_id: "d-side", status: "planned", do_date: shift(5) }),
  t("t6", "Send referral copy to the designer", { project_id: "p-launch" }),
  t("t7", "Book the dentist", { status: "inbox" }),
  t("t8", "Billing database backup drill", { project_id: "p-db", status: "done" }),
  t("t9", "Plan Sam's birthday", { domain_id: "d-home", status: "planned", do_date: shift(12) }),
  t("t10", "Long run — 14k", { domain_id: "d-body", status: "planned", do_date: shift(1) }),
];

export default function SearchHarness() {
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }), []);
  const [shell, setShell] = useState<"desktop" | "phone">(() => (window.innerWidth < 768 ? "phone" : "desktop"));
  const [open, setOpen] = useState(true);
  const [went, setWent] = useState<string>("");

  const report = (t: SearchTarget) => {
    setWent(t.kind === "event" ? `event ${t.hit.title}` : t.kind === "date" ? `the Schedule, ${t.dateISO}` : `${t.kind} ${t.id}`);
    setOpen(false);
  };

  return (
    <QueryClientProvider client={client}>
      <div className="app-ground flex h-screen flex-col items-center justify-center gap-3 p-4">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" kind={shell === "desktop" ? "primary" : "secondary"} onClick={() => setShell("desktop")}>Desktop</Button>
          <Button size="sm" kind={shell === "phone" ? "primary" : "secondary"} onClick={() => setShell("phone")}>Phone</Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            Search <Kbd keys="/" />
          </Button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              rememberRecent({ kind: "project", id: "p-trip" });
              rememberRecent({ kind: "task", id: "t1" });
            }}
          >
            Seed recents
          </Button>
        </div>
        {went && <p className="text-caption text-muted" data-testid="went">Opened → {went}</p>}
        {open && shell === "desktop" && <SearchDoor vertical={VERTICAL} tasks={TASKS} onOpen={report} onClose={() => setOpen(false)} />}
        {open && shell === "phone" && (
          <MobileSearch
            vertical={VERTICAL}
            tasks={TASKS}
            onOpenItem={(kind, id) => report({ kind, id })}
            onOpenTask={(id) => report({ kind: "task", id })}
            onOpenEvent={(hit) => report({ kind: "event", hit })}
            onOpenDate={(dateISO) => report({ kind: "date", dateISO })}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </QueryClientProvider>
  );
}
