/**
 * The QA world — what exists in the QA account after `npm run qa:seed`.
 *
 * Every scenario in qa/scenarios/ that names a seeded record writes it «like
 * this», and tests/qa-catalog.test.ts fails if a «name» is not one of the
 * titles below. So: rename something here → the catalog test tells you which
 * scenarios now point at nothing. qa/WORLD.md is the bot-facing description of
 * this same world; keep the two in step.
 *
 * Dates are relative to TODAY in America/Los_Angeles, so a seed on any day
 * gives a fresh, lived-in current week. Pure data + date math — no I/O.
 */

export const QA_TZ = "America/Los_Angeles";

// ── dates ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD for `now` in the QA zone. */
export function todayIn(tz = QA_TZ, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Date arithmetic on YYYY-MM-DD strings, in UTC so DST never shifts a day. */
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week holding `ymd` (the seed sets week_start = Monday). */
export function mondayOf(ymd) {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 = Sun
  return addDays(ymd, -((dow + 6) % 7));
}

/** The UTC instant of a wall-clock time on a date in `tz`, as ISO. */
export function at(ymd, hhmm, tz = QA_TZ) {
  const [h, m] = hhmm.split(":").map(Number);
  // Guess the instant as if UTC, then correct by the zone's offset at that instant.
  const guess = Date.UTC(...ymd.split("-").map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))), h, m);
  const offset = (inst) => {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(inst));
    const g = (t) => Number(p.find((x) => x.type === t).value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - inst;
  };
  let inst = guess - offset(guess);
  inst = guess - offset(inst); // second pass settles DST edges
  return new Date(inst).toISOString();
}

// ── the world ────────────────────────────────────────────────────────────

/**
 * Build the fixture for a given "today". Returns rows keyed by table, in
 * insert order, with client-generated ids so rows can point at each other.
 * `uuid` is injected so the caller decides (crypto.randomUUID in the script,
 * a counter in tests).
 */
export function buildWorld({ today = todayIn(), uuid = () => crypto.randomUUID() } = {}) {
  const mon = mondayOf(today);
  const fri = addDays(mon, 4);
  const id = new Proxy({}, { get: (cache, k) => (cache[k] ??= uuid()) });

  const domains = [
    { id: id.work, name: "Studio", color: "#4F6BD8", icon: "building", sort_order: 1, weekly_target_hours: 25, intention: "Ship work clients feel" },
    { id: id.family, name: "Family", color: "#D0567F", icon: "heart-handshake", sort_order: 2, weekly_target_hours: 8, intention: "Be home when home" },
    { id: id.health, name: "Health", color: "#2F9E6E", icon: "heart-pulse", sort_order: 3, weekly_target_hours: 5, intention: "Move every day" },
    { id: id.side, name: "Side project", color: "#C27D2E", icon: "sparkles", sort_order: 4, weekly_target_hours: 4, intention: "Small, steady" },
  ];

  const initiatives = [
    { id: id.launch, domain_id: id.work, name: "Q4 relaunch", outcome: "New site + pricing live before Thanksgiving", status: "in_progress", start_date: addDays(mon, -21), target_date: addDays(mon, 40), sort_order: 1 },
    { id: id.home, domain_id: id.family, name: "Home reset", outcome: "Garage usable as a workshop", status: "in_progress", start_date: addDays(mon, -7), target_date: addDays(mon, 30), sort_order: 2 },
  ];

  const projects = [
    // On the week — the kernel reads "on the week" as start/target spanning Mon→Fri.
    { id: id.site, name: "Marketing site v2", domain_id: id.work, initiative_id: id.launch, status: "in_progress", outcome: "Homepage + 3 case studies live", start_date: mon, target_date: fri, sort_order: 1 },
    { id: id.migrate, name: "Billing migration", domain_id: id.work, initiative_id: id.launch, status: "in_progress", outcome: "All customers on the new plans", start_date: mon, target_date: fri, sort_order: 2 },
    { id: id.garage, name: "Garage clean-out", domain_id: id.family, initiative_id: id.home, status: "in_progress", outcome: "Car fits, bench clear", start_date: mon, target_date: fri, sort_order: 3 },
    { id: id.talk, name: "Meetup talk", domain_id: id.side, initiative_id: null, status: "in_progress", outcome: "Slides done, rehearsed twice", start_date: mon, target_date: fri, sort_order: 4 },
    // Off the week — something to bring in.
    { id: id.pricing, name: "Pricing page experiment", domain_id: id.work, initiative_id: id.launch, status: "backlog", outcome: "Annual toggle A/B", start_date: null, target_date: null, sort_order: 5 },
    { id: id.photos, name: "Family photo book", domain_id: id.family, initiative_id: null, status: "backlog", outcome: "2025 book ordered", start_date: null, target_date: null, sort_order: 6 },
    // Parked — waiting, for Park/Resume.
    { id: id.shed, name: "Shed roof repair", domain_id: id.family, initiative_id: id.home, status: "waiting", outcome: "No leaks before the rains", start_date: null, target_date: null, sort_order: 8 },
    // Shipped last week — for the Shipped face.
    { id: id.newsletter, name: "Newsletter relaunch", domain_id: id.side, initiative_id: null, status: "complete", outcome: "First issue sent", start_date: addDays(mon, -7), target_date: addDays(mon, -3), shipped_at: at(addDays(mon, -3), "16:00"), sort_order: 7 },
  ];

  const key_results = [
    { id: id.krSignups, initiative_id: id.launch, name: "Annual plan signups", baseline_value: 0, current_value: 12, target_value: 40, unit: "signups", sort_order: 1 },
  ];

  const record_comments = [
    { project_id: id.site, body: "Client wants the Fernwood study first." },
  ];

  const sprints = [{ id: id.sprint, week_start: mon, goal: "Site live, billing cut over" }];

  const labels = [
    { id: id.calls, name: "calls", color: "#4F6BD8" },
    { id: id.errand, name: "errand", color: "#C27D2E" },
  ];

  const slots = [
    // A project sitting that holds two tasks (Wednesday afternoon).
    { id: id.siteSitting, title: "", do_date: addDays(mon, 2), start_time: at(addDays(mon, 2), "13:00"), duration_minutes: 120, project_id: id.site, domain_id: id.work },
    // A named domain block, empty (Friday morning).
    { id: id.deep, title: "Deep work", do_date: fri, start_time: at(fri, "09:00"), duration_minutes: 120, project_id: null, domain_id: id.work },
  ];

  const T = (o) => ({ priority: "none", ...o });
  const tasks = [];
  const push = (...rows) => tasks.push(...rows.map(T));

  // Inbox — no date, no project.
  push(
    { title: "Reply to Dana about the venue", status: "inbox", duration_minutes: 15, sort_order: 1 },
    { title: "Renew passport", status: "inbox", duration_minutes: 45, sort_order: 2, priority: "high" },
    { title: "Look into standing desk", status: "inbox", duration_minutes: 30, sort_order: 3 },
    { title: "Schedule dentist", status: "inbox", duration_minutes: 15, sort_order: 4 },
    { title: "Read: Shape Up ch. 3", status: "inbox", duration_minutes: 30, sort_order: 5, priority: "low" },
    { title: "Return the router", status: "inbox", duration_minutes: 20, sort_order: 6 },
  );

  // Today — timed blocks, anytime work, one already done.
  push(
    { id: id.fernwood, title: "Write case study: Fernwood", status: "planned", do_date: today, start_time: at(today, "09:00"), duration_minutes: 90, domain_id: id.work, project_id: id.site, sprint_id: id.sprint, priority: "high" },
    { title: "Review billing cutover plan", status: "planned", do_date: today, start_time: at(today, "11:30"), duration_minutes: 45, domain_id: id.work, project_id: id.migrate, sprint_id: id.sprint },
    { title: "Run", status: "planned", do_date: today, start_time: at(today, "07:15"), duration_minutes: 40, domain_id: id.health },
    { title: "Pick up kids", status: "planned", do_date: today, start_time: at(today, "15:15"), duration_minutes: 30, domain_id: id.family },
    { title: "Invoice October retainer", status: "done", do_date: today, start_time: at(today, "08:30"), duration_minutes: 15, domain_id: id.work, completed_at: new Date(Date.now() - 2 * 3600e3).toISOString() },
    { id: id.plumber, title: "Call the plumber", status: "planned", do_date: today, duration_minutes: 15, domain_id: id.family, notes: "Number is 555-0142. Ask about the water heater too." },
    { id: id.ink, title: "Order printer ink", status: "planned", do_date: today, duration_minutes: 10 },
  );

  // Earlier this week — done habit blocks, and one left behind (overdue).
  for (let d = mon; d < today && d <= fri; d = addDays(d, 1)) {
    push({ title: "Inbox zero", status: "done", do_date: d, start_time: at(d, "08:00"), duration_minutes: 20, domain_id: id.work, completed_at: at(d, "08:20") });
  }
  if (mon < today) {
    push({ title: "Draft migration email to customers", status: "planned", do_date: mon, start_time: at(mon, "14:00"), duration_minutes: 60, domain_id: id.work, project_id: id.migrate, sprint_id: id.sprint });
  }

  // Later this week — placed project work and personal blocks.
  push(
    { title: "Homepage hero copy", status: "planned", do_date: addDays(today, 1), start_time: at(addDays(today, 1), "10:00"), duration_minutes: 60, domain_id: id.work, project_id: id.site, sprint_id: id.sprint },
    { title: "Rehearse talk (run 1)", status: "planned", do_date: addDays(today, 1), start_time: at(addDays(today, 1), "19:30"), duration_minutes: 45, domain_id: id.side, project_id: id.talk, sprint_id: id.sprint },
    { title: "Haul boxes to donation", status: "planned", do_date: addDays(today, 2), start_time: at(addDays(today, 2), "10:00"), duration_minutes: 90, domain_id: id.family, project_id: id.garage, sprint_id: id.sprint },
  );

  // Inside the Wednesday sitting.
  push(
    { title: "Case study photos", status: "planned", do_date: addDays(mon, 2), duration_minutes: 45, domain_id: id.work, project_id: id.site, sprint_id: id.sprint, slot_id: id.siteSitting },
    { title: "Nav + footer pass", status: "planned", do_date: addDays(mon, 2), duration_minutes: 30, domain_id: id.work, project_id: id.site, sprint_id: id.sprint, slot_id: id.siteSitting },
  );

  // Loose — on the week (sprint) but no time yet: the crown's amber count.
  push(
    { title: "Case study: Northpine", status: "backlog", duration_minutes: 90, domain_id: id.work, project_id: id.site, sprint_id: id.sprint, sort_order: 1 },
    { title: "Redirect map for old URLs", status: "backlog", duration_minutes: 30, domain_id: id.work, project_id: id.site, sprint_id: id.sprint, sort_order: 2 },
    { title: "Map old plans to new plans", status: "backlog", duration_minutes: 60, domain_id: id.work, project_id: id.migrate, sprint_id: id.sprint, sort_order: 3 },
    { title: "Test proration on staging", status: "backlog", duration_minutes: 45, domain_id: id.work, project_id: id.migrate, sprint_id: id.sprint, sort_order: 4 },
    { title: "Sell the old tablesaw", status: "backlog", duration_minutes: 30, domain_id: id.family, project_id: id.garage, sprint_id: id.sprint, sort_order: 5 },
    { title: "Outline talk", status: "backlog", duration_minutes: 60, domain_id: id.side, project_id: id.talk, sprint_id: id.sprint, sort_order: 6 },
    { title: "Build demo repo", status: "backlog", duration_minutes: 90, domain_id: id.side, project_id: id.talk, sprint_id: id.sprint, sort_order: 7 },
  );

  // Backlog of projects NOT on the week.
  push(
    { title: "Design annual toggle", status: "backlog", duration_minutes: 60, domain_id: id.work, project_id: id.pricing, sort_order: 1 },
    { title: "Set up experiment flag", status: "backlog", duration_minutes: 30, domain_id: id.work, project_id: id.pricing, sort_order: 2 },
    { title: "Pick 40 photos", status: "backlog", duration_minutes: 60, domain_id: id.family, project_id: id.photos, sort_order: 3 },
  );

  // The shipped project's work, all done.
  push(
    { title: "Write issue one", status: "done", do_date: addDays(mon, -5), duration_minutes: 60, domain_id: id.side, project_id: id.newsletter, completed_at: at(addDays(mon, -5), "11:00") },
    { title: "Send issue one", status: "done", do_date: addDays(mon, -3), duration_minutes: 15, domain_id: id.side, project_id: id.newsletter, completed_at: at(addDays(mon, -3), "15:30") },
  );

  // Trashed yesterday — for the trash read / restore. (purge-trash hard-deletes
  // after 30 days, so it is always recent.)
  push({ title: "Old gym membership form", status: "trashed", duration_minutes: 15, trashed_at: new Date(Date.now() - 24 * 3600e3).toISOString() });

  // A weekday recurring task, materialised for this week.
  const recurrences = [
    { id: id.shutdown, kind: "task", freq: "weekly", interval: 1, byweekday: [1, 2, 3, 4, 5], anchor_date: mon, title: "Shutdown review", duration_minutes: 15, time_of_day_minutes: 17 * 60, domain_id: id.work, active: true, last_materialized: fri },
  ];
  for (let i = 0; i < 5; i++) {
    const d = addDays(mon, i);
    const past = d < today;
    push({
      title: "Shutdown review", status: past ? "done" : "planned", do_date: d, start_time: at(d, "17:00"), duration_minutes: 15,
      domain_id: id.work, recurrence_id: id.shutdown, recurrence_date: d, completed_at: past ? at(d, "17:15") : null,
    });
  }

  for (const t of tasks) t.id ??= uuid();

  const byTitle = (title) => tasks.find((t) => t.title === title).id;
  const task_labels = [
    { task_id: byTitle("Call the plumber"), label_id: id.calls },
    { task_id: byTitle("Reply to Dana about the venue"), label_id: id.calls },
    { task_id: byTitle("Return the router"), label_id: id.errand },
    { task_id: byTitle("Order printer ink"), label_id: id.errand },
  ];

  const settings = {
    week_start: 1,
    day_start_hour: 7,
    day_end_hour: 21,
    work_start_minutes: 540,
    work_end_minutes: 1050,
    time_zone: QA_TZ,
    last_rollover_date: today,
    default_task_duration_minutes: 30,
    theme: "light",
  };

  return {
    today, mon, fri,
    // Insert order: parents before children.
    tables: { domains, initiatives, key_results, projects, record_comments, sprints, labels, slots, recurrences, tasks, task_labels },
    settings,
  };
}

/** Every title a scenario may quote as «seeded». */
export function seededNames(world = buildWorld({ today: "2026-11-18", uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })() })) {
  const t = world.tables;
  return new Set([
    ...t.domains.map((r) => r.name),
    ...t.initiatives.map((r) => r.name),
    ...t.projects.map((r) => r.name),
    ...t.key_results.map((r) => r.name),
    ...t.labels.map((r) => r.name),
    ...t.slots.map((r) => r.title).filter(Boolean),
    ...t.tasks.map((r) => r.title),
    ...t.sprints.map((r) => r.goal),
  ]);
}
