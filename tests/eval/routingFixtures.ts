// A STRANGER's account for the routing eval (P16 — it must hold true outside
// the builder's own life). Maya: a cardiac-ICU charge nurse, mid-way through an
// online MSN, two kids, training for a half marathon, volunteers at a food bank.
// None of these domains, names or exemplars come from a real account.
//
// Every label is "what would Maya herself say", not "what the model said". A
// `null` label means NO CLEAR HOME — an item a reasonable person could not file
// from its words alone. Auto-filing one of those is the expensive error: it
// lands somewhere confidently wrong and nobody is asked.

import type { RouteDomain } from "../../supabase/functions/_shared/domainRouting";

export const STRANGER_DOMAINS: RouteDomain[] = [
  {
    id: "dom-icu",
    name: "Hospital",
    charter: "My job as a charge nurse in the cardiac ICU at St. Agnes — shifts, patients, staffing, unit council, certifications.",
    context: {
      boundary: "Coursework and practicum for my master's are the MSN, not this job.",
      entities: ["St. Agnes", "CVICU", "4 West", "Jordan (coworker)", "Dr. Okafor"],
      exemplars: ["Cover Jordan's Tuesday night", "Restock the crash cart checklist"],
    },
    recent: ["Finish annual competencies module", "Staffing grid for December", "Debrief with Dr. Okafor about the code"],
  },
  {
    id: "dom-msn",
    name: "MSN",
    charter: "Online Master of Science in Nursing Education — courses, discussion posts, capstone, practicum hours.",
    context: {
      entities: ["NURS 640", "Professor Lindqvist", "capstone", "Canvas"],
      exemplars: ["Read chapter 7 for NURS 640", "Capstone outline draft"],
    },
    recent: ["Peer review two discussion posts", "Upload practicum preceptor agreement"],
  },
  {
    id: "dom-family",
    name: "Family",
    charter: "Dev (husband), Leo (8) and Ana (5) — school, activities, birthdays, the kids' appointments.",
    context: {
      entities: ["Dev", "Leo", "Ana", "Lincoln Elementary"],
      exemplars: ["Leo's library books due", "Ana's swim lesson sign-up"],
    },
    recent: ["Pack Leo's lunch for the field trip", "Order Ana's birthday cake"],
  },
  {
    id: "dom-health",
    name: "Health & running",
    charter: "My own body: training for the Portland half marathon, my knee rehab, sleep after night shifts.",
    context: {
      entities: ["Portland half", "physio", "Strava"],
      exemplars: ["Tempo run 5 miles", "Foam roll after long run"],
    },
    recent: ["Buy new running shoes", "Knee exercises from physio"],
  },
  {
    id: "dom-home",
    name: "Home & money",
    charter: "The house and our finances — bills, repairs, the car, insurance, taxes.",
    context: {
      entities: ["State Farm", "mortgage", "credit union"],
      exemplars: ["Pay water bill", "Schedule gutter cleaning"],
    },
    recent: ["Renew car registration", "Compare home insurance quotes"],
  },
  {
    id: "dom-foodbank",
    name: "Food bank",
    charter: "Volunteer shift lead at Eastside Community Food Bank — Saturday distributions, volunteer roster, donation drives.",
    context: {
      entities: ["Eastside Community Food Bank", "Saturday distribution"],
      exemplars: ["Confirm Saturday volunteer roster", "Thank-you note to the grocery donor"],
    },
    recent: ["Print sign-in sheets for distribution"],
  },
];

export interface RoutingCase {
  kind: "capture" | "event";
  text: string;
  /** Calendar name, for events — the client sends it when it has one. */
  calendar?: string;
  /** The domain Maya would file it under, or null = no clear home. */
  expect: string | null;
}

export const ROUTING_CASES: RoutingCase[] = [
  // ── captures with a clear home ──────────────────────────────────────────────
  { kind: "capture", text: "Swap my Saturday night shift with Jordan", expect: "dom-icu" },
  { kind: "capture", text: "Finish the sepsis bundle audit for unit council", expect: "dom-icu" },
  { kind: "capture", text: "Renew ACLS before it lapses in March", expect: "dom-icu" },
  { kind: "capture", text: "Precept the new grad on central line care", expect: "dom-icu" },
  { kind: "capture", text: "Submit week 6 discussion post for NURS 640", expect: "dom-msn" },
  { kind: "capture", text: "Draft the literature review for my capstone", expect: "dom-msn" },
  { kind: "capture", text: "Log this month's practicum hours", expect: "dom-msn" },
  { kind: "capture", text: "Email Professor Lindqvist about my capstone topic", expect: "dom-msn" },
  { kind: "capture", text: "Sign Leo's field trip permission slip", expect: "dom-family" },
  { kind: "capture", text: "Book Ana's 5-year checkup", expect: "dom-family" },
  { kind: "capture", text: "Plan Dev's birthday dinner", expect: "dom-family" },
  { kind: "capture", text: "Buy new soccer cleats for Leo", expect: "dom-family" },
  { kind: "capture", text: "Ice and stretch my knee after the long run", expect: "dom-health" },
  { kind: "capture", text: "Register for the Portland half", expect: "dom-health" },
  { kind: "capture", text: "Book a physio follow-up for my knee", expect: "dom-health" },
  { kind: "capture", text: "Pay the property tax installment", expect: "dom-home" },
  { kind: "capture", text: "Call State Farm about the car claim", expect: "dom-home" },
  { kind: "capture", text: "Fix the leaking kitchen faucet", expect: "dom-home" },
  { kind: "capture", text: "Recruit two more volunteers for Saturday distribution", expect: "dom-foodbank" },
  { kind: "capture", text: "Update the food bank shift schedule", expect: "dom-foodbank" },
  // ── captures with NO clear home (must not auto-file) ───────────────────────
  { kind: "capture", text: "Call Sarah back", expect: null },
  { kind: "capture", text: "Look into that thing from yesterday", expect: null },
  { kind: "capture", text: "Text her about Friday", expect: null },
  { kind: "capture", text: "Reply to the email from Tuesday", expect: null },
  { kind: "capture", text: "Pick up the prescription", expect: null },
  // ── calendar events with a clear home ───────────────────────────────────────
  { kind: "event", text: "Night shift — CVICU", calendar: "Work schedule", expect: "dom-icu" },
  { kind: "event", text: "Unit council meeting", expect: "dom-icu" },
  { kind: "event", text: "Skills fair: CRRT recertification", expect: "dom-icu" },
  { kind: "event", text: "NURS 640 live seminar", expect: "dom-msn" },
  { kind: "event", text: "Capstone advisor check-in", expect: "dom-msn" },
  { kind: "event", text: "Leo soccer practice", expect: "dom-family" },
  { kind: "event", text: "Ana's dance recital", expect: "dom-family" },
  { kind: "event", text: "Parent-teacher conference at Lincoln", expect: "dom-family" },
  { kind: "event", text: "Long run — 10 miles", expect: "dom-health" },
  { kind: "event", text: "Physio — knee", expect: "dom-health" },
  { kind: "event", text: "Mortgage refinance call with the credit union", expect: "dom-home" },
  { kind: "event", text: "Food bank Saturday distribution", expect: "dom-foodbank" },
  { kind: "event", text: "Volunteer orientation at Eastside", expect: "dom-foodbank" },
  // ── events with NO clear home ───────────────────────────────────────────────
  { kind: "event", text: "Lunch with Priya", calendar: "maya.r@gmail.com", expect: null },
  { kind: "event", text: "Busy", expect: null },
];
