// Throwaway: compute the "Capacity" read against live data. Friday 2026-06-19.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { error: authErr } = await sb.auth.signInWithPassword({
  email: env.VITE_DEV_EMAIL, password: env.VITE_DEV_PASSWORD,
});
if (authErr) { console.error("auth failed:", authErr.message); process.exit(1); }

const IN_FLIGHT = new Set(["in_progress", "active"]);
const OPEN_PROJECT = new Set(["backlog", "in_progress", "active", "planned", "waiting", "blocked"]);

// --- settings ---
const { data: settingsRows } = await sb.from("user_settings").select("*").limit(1);
const s = settingsRows?.[0] ?? {};
const workStart = s.work_start_minutes ?? 480;
const workEnd = s.work_end_minutes ?? 990;
const hidden = new Set(s.hidden_calendar_ids ?? []);
const dayMins = workEnd - workStart;

// --- projects ---
const { data: projects } = await sb.from("projects").select("id,name,status,outcome,target_date,initiative_id");
const inFlight = (projects ?? []).filter((p) => IN_FLIGHT.has(p.status));
const openProjects = (projects ?? []).filter((p) => OPEN_PROJECT.has(p.status));

// --- tasks for in-flight projects ---
const inFlightIds = inFlight.map((p) => p.id);
let demandRows = [];
if (inFlightIds.length) {
  const { data } = await sb.from("tasks")
    .select("id,title,project_id,status,duration_minutes,start_time,do_date")
    .in("project_id", inFlightIds);
  demandRows = data ?? [];
}

// --- supply: this work-week (Mon-Fri) ---
// Week: Mon 2026-06-15 .. Fri 2026-06-19 (week_start default Monday)
const weekStart = new Date("2026-06-15T00:00:00");
const days = [0, 1, 2, 3, 4].map((d) => {
  const dt = new Date(weekStart); dt.setDate(dt.getDate() + d); return dt;
});
const winFor = (day) => {
  const a = new Date(day); a.setHours(0, workStart, 0, 0);
  const b = new Date(day); b.setHours(0, workEnd, 0, 0);
  return [a, b];
};
const isoWeekStart = days[0].toISOString();
const isoWeekEnd = new Date(days[4].getTime() + 24 * 3600 * 1000).toISOString();

const { data: events } = await sb.from("external_events")
  .select("calendar_id,title,start_at,end_at,all_day,busy")
  .lt("start_at", isoWeekEnd).gt("end_at", isoWeekStart);
const { data: sched } = await sb.from("tasks")
  .select("title,start_time,duration_minutes,status")
  .not("start_time", "is", null).in("status", ["planned", "done"])
  .gte("start_time", isoWeekStart).lt("start_time", isoWeekEnd);

const busyBlocks = [
  ...(events ?? []).filter((e) => !e.all_day && e.busy !== false && !hidden.has(e.calendar_id))
    .map((e) => ({ start: new Date(e.start_at), end: new Date(e.end_at) })),
  ...(sched ?? []).map((t) => ({
    start: new Date(t.start_time),
    end: new Date(new Date(t.start_time).getTime() + (t.duration_minutes ?? 30) * 60000),
  })),
];

const overlapMins = (aS, aE, bS, bE) =>
  Math.max(0, Math.min(aE, bE) - Math.max(aS, bS)) / 60000;

let workMins = 0, busyMins = 0;
for (const day of days) {
  const [wS, wE] = winFor(day);
  workMins += dayMins;
  for (const b of busyBlocks) busyMins += overlapMins(wS.getTime(), wE.getTime(), b.start.getTime(), b.end.getTime());
}
const openMins = Math.max(0, workMins - busyMins);

// --- demand proxy: open task durations on in-flight projects ---
const openTasks = demandRows.filter((t) => t.status !== "done" && t.status !== "trashed");
const demandMins = openTasks.reduce((sum, t) => sum + (t.duration_minutes ?? 0), 0);
const nullDur = openTasks.filter((t) => t.duration_minutes == null).length;

const h = (m) => `${(m / 60).toFixed(1)}h`;

console.log("\n========== CAPACITY PROBE — Fri 2026-06-19 ==========\n");
console.log(`Work window: ${Math.floor(workStart/60)}:${String(workStart%60).padStart(2,"0")}–${Math.floor(workEnd/60)}:${String(workEnd%60).padStart(2,"0")}  (${h(dayMins)}/day, Mon–Fri)\n`);

console.log(`PROJECTS: ${projects?.length ?? 0} total · ${openProjects.length} open · ${inFlight.length} in flight`);
console.log(`In-flight projects:`);
for (const p of inFlight) {
  const ts = demandRows.filter((t) => t.project_id === p.id);
  const openT = ts.filter((t) => t.status !== "done" && t.status !== "trashed");
  const mins = openT.reduce((s, t) => s + (t.duration_minutes ?? 0), 0);
  console.log(`  • ${p.name}`);
  console.log(`      outcome: ${p.outcome ? '"'+p.outcome.slice(0,50)+'"' : "(none)"} · target: ${p.target_date ?? "—"}`);
  console.log(`      tasks: ${ts.length} (${openT.length} open) · estimated demand: ${h(mins)} (${openT.filter(t=>t.duration_minutes==null).length} have no estimate)`);
}

console.log(`\n--- SUPPLY (this Mon–Fri) ---`);
console.log(`  total work window: ${h(workMins)}`);
console.log(`  committed (busy):  ${h(busyMins)}`);
console.log(`  OPEN:              ${h(openMins)}`);

console.log(`\n--- DEMAND (task-duration proxy) ---`);
console.log(`  open tasks on in-flight projects: ${openTasks.length}`);
console.log(`  with NO estimate:                 ${nullDur}`);
console.log(`  estimated focus demand:           ${h(demandMins)}`);

console.log(`\n--- THE READ ---`);
const ratio = openMins > 0 ? demandMins / openMins : (demandMins > 0 ? Infinity : 0);
let band = "Comfortable";
if (ratio > 1.0) band = "Overcommitted";
else if (ratio > 0.7) band = "Tight";
console.log(`  task-based:  demand ${h(demandMins)} vs open ${h(openMins)}  →  ${band}  (ratio ${ratio.toFixed(2)})`);
console.log(`  WIP backstop: ${inFlight.length} in flight  (3+ parallel = Tight, 5+ = Overcommitted by WIP rule)`);
console.log("\n=====================================================\n");
