// The router's report card — what happened to the filings it made.
//
// Nothing here is a new store. Every automatic or proposed filing already lives
// on the task as `suggestion`, and the client stamps the person's verdict onto it
// (`outcome`: accepted / undone / corrected / rejected). This reads those rows
// back into the kernel's `RouteEvent`s so `enrichDomain` can be told what the
// router got wrong *for this domain* — and nothing else changes.
//
// One outcome is inferred rather than recorded: an automatic filing that was
// triaged out of the Inbox with its domain intact and never undone was, in
// effect, confirmed. Nobody clicks "yes" on a thing that was right.

import { admin } from "../_shared/admin.ts";
import { readRouting, type RouteEvent, type RouteOutcome, type RoutingReadout } from "../_shared/domainRouting.ts";

type Row = {
  title: string;
  domain_id: string | null;
  status: string;
  suggestion: { domainId?: string | null; targetId?: string | null; level?: string; auto?: boolean; outcome?: RouteOutcome; dismissed?: boolean } | null;
};

export async function loadRoutingEvents(userId: string): Promise<RouteEvent[]> {
  const { data } = await admin
    .from("tasks")
    .select("title, domain_id, status, suggestion")
    .eq("user_id", userId)
    .not("suggestion", "is", null)
    .order("suggested_at", { ascending: false })
    .limit(500);
  const events: RouteEvent[] = [];
  for (const r of (data ?? []) as Row[]) {
    const s = r.suggestion;
    // Only DOMAIN-level routing is the router's to answer for here; a project
    // pick is judged by the Groom wall, not this report.
    const suggestedId = s?.level === "domain" ? s.targetId ?? s.domainId : null;
    if (!s || !suggestedId) continue;
    let outcome = s.outcome;
    if (!outcome && s.auto && r.status !== "inbox" && r.domain_id === suggestedId) outcome = "confirmed";
    if (!outcome) continue; // still pending — not evidence yet
    events.push({ title: r.title, suggestedId, finalId: r.domain_id, outcome });
  }
  return events;
}

export async function routingReadout(userId: string): Promise<RoutingReadout> {
  return readRouting(await loadRoutingEvents(userId));
}
