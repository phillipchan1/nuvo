// Standalone access-isolation check against PGlite.
// Run: node --experimental-strip-types worker/src/access.check.ts
// Proves: user A cannot read, edit, or delete user B's planner rows.
// Mutating those SQL filters must make this fail.

import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import {
  applyPatch,
  bootstrapUser,
  claimReminder,
  contacts,
  deleteOwned,
  deleteTaskLabel,
  getOwned,
  insertOwned,
  insertProject,
  insertTask,
  insertTaskLabel,
  listDayScheduledTasks,
  listDaySlots,
  listOwned,
  listTaskLabels,
  makeStore,
  PLANNER_TABLES,
  rotateInboundToken,
  updateDomainName,
  updateOwned,
  updateProjectName,
  updateSettingsTheme,
  updateTaskTitle,
  upsertOwned,
  appleUserIdTakenByOther,
  deleteOwnedCalendarAccount,
  getOwnedActivitySource,
  getOwnedAppleIdentity,
  getOwnedCalendarAccount,
  getOwnedExternalEvent,
  insertActivityBinding,
  insertActivitySource,
  insertActivityUnit,
  insertCalendarAccount,
  insertConnection,
  insertExternalEvent,
  insertInboundEmail,
  insertPushSubscription,
  resyncOwnedPushSubscriptions,
  listOwnedActivityBindings,
  listOwnedActivitySources,
  listOwnedActivityUnits,
  listOwnedCalendarAccounts,
  listOwnedConnections,
  listOwnedExternalEvents,
  listOwnedInboundEmails,
  listOwnedPushSubscriptions,
  listOwnedSyncLog,
  upsertAppleIdentity,
  type PlannerTable,
} from "./store.ts";

const fails: string[] = [];
let checks = 0;

function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const TASK_A = "aaaaaaaa-2222-4000-8000-000000000001";
const TASK_B = "bbbbbbbb-2222-4000-8000-000000000001";
const DOMAIN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const DOMAIN_B = "bbbbbbbb-0000-4000-8000-000000000001";
const PROJECT_A = "aaaaaaaa-1111-4000-8000-000000000001";
const PROJECT_B = "bbbbbbbb-1111-4000-8000-000000000001";
const LABEL_A = "aaaaaaaa-3333-4000-8000-000000000001";
const LABEL_B = "bbbbbbbb-3333-4000-8000-000000000001";
const REMINDER_B = "bbbbbbbb-4444-4000-8000-000000000001";

const B_ROW: Record<PlannerTable, string> = {
  tasks: TASK_B,
  domains: DOMAIN_B,
  projects: PROJECT_B,
  initiatives: "bbbbbbbb-7777-4000-8000-000000000001",
  key_results: "bbbbbbbb-8888-4000-8000-000000000001",
  slots: "bbbbbbbb-9999-4000-8000-000000000001",
  labels: LABEL_B,
  recurrences: "bbbbbbbb-aaaa-4000-8000-000000000001",
  record_comments: "bbbbbbbb-bbbb-4000-8000-000000000001",
  week_reviews: "bbbbbbbb-cccc-4000-8000-000000000001",
  sprints: "bbbbbbbb-6666-4000-8000-000000000001",
  reminders: REMINDER_B,
  event_domain_routing: "bbbbbbbb-dddd-4000-8000-000000000001",
  user_settings: B,
};

const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);
const storeA = makeStore(sql, A);
const storeB = makeStore(sql, B);

async function count(table: string, where: string, params: unknown[]): Promise<number> {
  const result = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return Number(result.rows[0]?.n ?? 0);
}

async function scalar<T>(text: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await db.query<Record<string, T>>(text, params);
  const row = result.rows[0];
  if (!row) return undefined;
  return Object.values(row)[0];
}

const tasksA = await listOwned(storeA, "tasks");
const tasksB = await listOwned(storeB, "tasks");
ok(tasksA.length === 1 && tasksA[0]?.id === TASK_A, "listOwned tasks: A sees only own");
ok(!tasksA.some((t) => t.id === TASK_B), "listOwned tasks: A cannot list B");
ok(tasksB.length === 1 && tasksB[0]?.id === TASK_B, "listOwned tasks: B sees only own");

const DAY_START = "2026-10-25T00:00:00.000Z";
const DAY_END = "2026-10-28T00:00:00.000Z";
const SLOT_A = "aaaaaaaa-9999-4000-8000-000000000001";
const dayTasksA = await listDayScheduledTasks(storeA, DAY_START, DAY_END);
ok(dayTasksA.length === 1 && dayTasksA[0]?.id === TASK_A, "listDayScheduledTasks: A sees only own in-window task");
ok(!dayTasksA.some((t) => t.id === TASK_B), "listDayScheduledTasks: A cannot see B");
const dayTasksB = await listDayScheduledTasks(storeB, DAY_START, DAY_END);
ok(dayTasksB.length === 1 && dayTasksB[0]?.id === TASK_B, "listDayScheduledTasks: B sees only own in-window task");
ok(!dayTasksB.some((t) => t.id === TASK_A), "listDayScheduledTasks: B cannot see A");
const daySlotsA = await listDaySlots(storeA, DAY_START, DAY_END);
ok(daySlotsA.length === 1 && daySlotsA[0]?.id === SLOT_A, "listDaySlots: A sees only own");
ok(!daySlotsA.some((s) => s.id === B_ROW.slots), "listDaySlots: A cannot see B");

ok((await getOwned(storeA, "tasks", TASK_A))?.id === TASK_A, "getOwned: A can read own task");
ok((await getOwned(storeA, "tasks", TASK_B)) === null, "getOwned: A asking for B task is null");
ok((await getOwned(storeB, "tasks", TASK_A)) === null, "getOwned: B asking for A task is null");

const domainsA = await listOwned(storeA, "domains");
ok(domainsA.every((d) => d.name !== "B Work"), "listOwned domains: A cannot see B Work");
ok((await getOwned(storeA, "domains", DOMAIN_B)) === null, "getOwned: A cannot read B domain");
ok((await getOwned(storeA, "projects", PROJECT_B)) === null, "getOwned: A cannot read B project");

const settingsA = await getOwned(storeA, "user_settings", A);
const settingsB = await getOwned(storeB, "user_settings", B);
ok(settingsA?.theme === "light", "settings: A theme is light");
ok(settingsB?.theme === "dark", "settings: B theme is dark");
ok((await getOwned(storeA, "user_settings", B)) === null, "getOwned settings: A cannot read B by id");
ok((await getOwned(storeA, "user_settings", A))?.theme === "light", "getOwned settings: A can read own");

const labelsA = await listTaskLabels(storeA, TASK_A);
const labelsCross = await listTaskLabels(storeA, TASK_B);
ok(labelsA.length === 1 && labelsA[0]?.label_id === LABEL_A, "listTaskLabels: A own labels");
ok(labelsCross.length === 0, "listTaskLabels: A cannot list B labels");

ok(!(await insertTaskLabel(storeA, TASK_B, LABEL_A)), "insertTaskLabel: A cannot tag B task");
ok(!(await insertTaskLabel(storeA, TASK_A, LABEL_B)), "insertTaskLabel: A cannot use B label");
ok((await deleteTaskLabel(storeA, TASK_B, LABEL_B)) === 0, "deleteTaskLabel: A cannot unlink B");
ok((await count("task_labels", "task_id = $1", [TASK_B])) === 1, "deleteTaskLabel: B link still present");

const planted = await insertTask(storeA, { title: "A planted on B?" });
ok(planted?.user_id === A, "insertTask: new row belongs to A, not B");
ok((await count("tasks", "user_id = $1", [B])) === 1, "insertTask: B task count unchanged");

const stolenTitle = await updateTaskTitle(storeA, TASK_B, "hacked by A");
ok(stolenTitle === null, "updateTaskTitle: A cannot rename B task");
ok((await scalar<string>("SELECT title FROM tasks WHERE id = $1", [TASK_B])) === "B only task", "updateTaskTitle: B title unchanged");

ok((await updateDomainName(storeA, DOMAIN_B, "stolen")) === null, "updateDomainName: A cannot rename B domain");
ok((await scalar<string>("SELECT name FROM domains WHERE id = $1", [DOMAIN_B])) === "B Work", "updateDomainName: B name unchanged");

ok((await updateProjectName(storeA, PROJECT_B, "stolen")) === null, "updateProjectName: A cannot rename B project");
ok((await scalar<string>("SELECT name FROM projects WHERE id = $1", [PROJECT_B])) === "B Project", "updateProjectName: B name unchanged");

const bTheme = await scalar<string>("SELECT theme FROM user_settings WHERE user_id = $1", [B]);
await updateSettingsTheme(storeA, "system");
ok((await scalar<string>("SELECT theme FROM user_settings WHERE user_id = $1", [A])) === "system", "updateSettings: A theme updated");
ok((await scalar<string>("SELECT theme FROM user_settings WHERE user_id = $1", [B])) === bTheme, "updateSettings: B theme untouched");

const sneak = await applyPatch(storeA, "tasks", { id: TASK_B }, { title: "patched by A" });
ok(sneak.matched === 0, "applyPatch: A cannot patch B task");
ok((await scalar<string>("SELECT title FROM tasks WHERE id = $1", [TASK_B])) === "B only task", "applyPatch: B title still B");

const sneakSettings = await applyPatch(storeA, "user_settings", { id: B }, { theme: "light" });
ok(sneakSettings.matched === 0, "applyPatch: A cannot patch B settings by id");
ok((await scalar<string>("SELECT theme FROM user_settings WHERE user_id = $1", [B])) === "dark", "applyPatch settings: B theme still dark");

const ownPatch = await applyPatch(storeA, "tasks", { id: TASK_A }, { title: "A retitled" });
ok(ownPatch.matched === 1, "applyPatch: A can patch own task");
ok((await scalar<string>("SELECT title FROM tasks WHERE id = $1", [TASK_A])) === "A retitled", "applyPatch: A title updated");

ok((await deleteOwned(storeA, "tasks", TASK_B)) === 0, "deleteOwned: A cannot delete B task");
ok((await count("tasks", "id = $1", [TASK_B])) === 1, "deleteOwned: B task still present");
ok((await deleteOwned(storeA, "domains", DOMAIN_B)) === 0, "deleteOwned: A cannot delete B domain");
ok((await deleteOwned(storeA, "projects", PROJECT_B)) === 0, "deleteOwned: A cannot delete B project");

ok(!(await claimReminder(storeA, REMINDER_B, "2026-10-26T09:00:00Z")), "claimReminder: A cannot claim B reminder");
ok((await count("reminder_deliveries", "user_id = $1", [B])) === 0, "claimReminder: no B delivery written by A");

const bookA = await contacts(storeA, "friend");
ok(bookA.every((c) => c.email !== "friend-b@example.test"), "contacts: A cannot see B contacts");
ok(bookA.some((c) => c.email === "friend-a@example.test"), "contacts: A sees own contacts");

const tokenA = await rotateInboundToken(storeA);
ok(typeof tokenA === "string" && tokenA.length > 8, "rotateInboundToken: A can rotate own");
ok(
  (await scalar<string>("SELECT inbound_token FROM user_settings WHERE user_id = $1", [B])) == null,
  "rotateInboundToken: B token untouched",
);

const forgedInsert = await insertOwned(storeA, "tasks", {
  id: "cccccccc-0000-4000-8000-000000000099",
  title: "forged",
  user_id: B,
});
ok(forgedInsert?.user_id === A, "insertOwned: client user_id is ignored; row is A's");
ok((await count("tasks", "user_id = $1 AND title = $2", [B, "forged"])) === 0, "insertOwned: no forged B row");

const stealDomain = await insertProject(storeA, { name: "planted on B domain", domain_id: DOMAIN_B });
ok(stealDomain === null, "insertProject: A cannot attach B domain_id");
ok((await count("projects", "user_id = $1 AND domain_id = $2", [A, DOMAIN_B])) === 0, "insertProject: no A row on B domain");
ok((await count("projects", "user_id = $1", [B])) === 1, "insertProject: B project count unchanged");

const ownProject = await insertProject(storeA, { name: "A on A domain", domain_id: DOMAIN_A });
ok(ownProject?.user_id === A && ownProject.domain_id === DOMAIN_A, "insertProject: A can attach own domain");

ok(
  (await insertOwned(storeA, "tasks", { title: "on B project", project_id: PROJECT_B })) === null,
  "insertOwned tasks: A cannot attach B project_id",
);
ok(
  (await insertOwned(storeA, "initiatives", { name: "steal", domain_id: DOMAIN_B })) === null,
  "insertOwned initiatives: A cannot attach B domain_id",
);
ok(
  (await insertOwned(storeA, "key_results", { name: "steal", initiative_id: B_ROW.initiatives })) === null,
  "insertOwned key_results: A cannot attach B initiative_id",
);
ok(
  (await insertOwned(storeA, "slots", {
    title: "steal",
    do_date: "2026-10-26",
    start_time: "2026-10-26T10:00:00Z",
    duration_minutes: 30,
    project_id: PROJECT_B,
  })) === null,
  "insertOwned slots: A cannot attach B project_id",
);
ok(
  (await insertOwned(storeA, "record_comments", { body: "steal", project_id: PROJECT_B })) === null,
  "insertOwned comments: A cannot attach B project_id",
);
ok(
  (await insertOwned(storeA, "event_domain_routing", { event_key: "evt-steal", domain_id: DOMAIN_B })) === null,
  "insertOwned routing: A cannot attach B domain_id",
);
ok(
  (await insertOwned(storeA, "reminders", { target_kind: "slot", target_id: SLOT_A })) != null,
  "insertOwned reminder: A can target own slot",
);
ok(
  (await insertOwned(storeA, "reminders", { target_kind: "slot", target_id: TASK_A })) === null,
  "insertOwned reminder: slot kind rejects a task id",
);
ok(
  (await insertOwned(storeA, "reminders", { target_kind: "task", target_id: SLOT_A })) === null,
  "insertOwned reminder: task kind rejects a slot id",
);
ok(
  (await insertOwned(storeA, "reminders", { target_kind: "slot", target_id: B_ROW.slots })) === null,
  "insertOwned reminder: A cannot target B slot",
);
ok(
  (await insertOwned(storeA, "reminders", { target_kind: "event", target_id: TASK_A })) === null,
  "insertOwned reminder: event kind rejects target_id",
);
ok(
  (await upsertOwned(storeA, "event_domain_routing", { event_key: "evt-a", domain_id: DOMAIN_B })) === null,
  "upsertOwned routing: A cannot rehome evt-a onto B domain",
);
ok(
  (await scalar<string>("SELECT domain_id::text FROM event_domain_routing WHERE event_key = $1", ["evt-a"])) === DOMAIN_A,
  "upsertOwned routing: A's evt-a domain unchanged",
);

const aDomainBefore = await scalar<string>("SELECT domain_id::text FROM projects WHERE id = $1", [PROJECT_A]);
ok(
  (await updateOwned(storeA, "projects", PROJECT_A, { domain_id: DOMAIN_B })) === null,
  "updateOwned project: A cannot set domain_id to B",
);
ok(
  (await scalar<string>("SELECT domain_id::text FROM projects WHERE id = $1", [PROJECT_A])) === aDomainBefore,
  "updateOwned project: A domain_id unchanged",
);
ok(
  (await updateOwned(storeA, "projects", PROJECT_A, { domain_id: DOMAIN_A }))?.id === PROJECT_A,
  "updateOwned project: A can set own domain_id",
);
ok(
  (await updateOwned(storeA, "tasks", TASK_B, { project_id: PROJECT_A })) === null,
  "updateOwned task: A cannot rehome B onto A's project",
);
ok(
  (await scalar<string>("SELECT project_id::text FROM tasks WHERE id = $1", [TASK_B])) === PROJECT_B,
  "updateOwned task: B project_id unchanged",
);
ok(
  (await updateOwned(storeA, "initiatives", B_ROW.initiatives, { name: "stolen" })) === null,
  "updateOwned initiative: A cannot rename B",
);
ok(
  (await scalar<string>("SELECT name FROM initiatives WHERE id = $1", [B_ROW.initiatives])) === "B Initiative",
  "updateOwned initiative: B name unchanged",
);
ok(
  (await updateOwned(storeA, "key_results", B_ROW.key_results, { name: "stolen" })) === null,
  "updateOwned key_result: A cannot rename B",
);
ok(
  (await scalar<string>("SELECT name FROM key_results WHERE id = $1", [B_ROW.key_results])) === "B KR",
  "updateOwned key_result: B name unchanged",
);
ok(
  (await updateOwned(storeA, "slots", B_ROW.slots, { title: "stolen" })) === null,
  "updateOwned slot: A cannot rename B",
);
ok(
  (await scalar<string>("SELECT title FROM slots WHERE id = $1", [B_ROW.slots])) === "B slot",
  "updateOwned slot: B title unchanged",
);
ok(
  (await updateOwned(storeA, "record_comments", B_ROW.record_comments, { body: "stolen" })) === null,
  "updateOwned comment: A cannot edit B",
);
ok(
  (await scalar<string>("SELECT body FROM record_comments WHERE id = $1", [B_ROW.record_comments])) === "B note",
  "updateOwned comment: B body unchanged",
);
ok(
  (await updateOwned(storeA, "reminders", B_ROW.reminders, { anchor: "end" })) === null,
  "updateOwned reminder: A cannot edit B",
);
ok(
  (await scalar<string>("SELECT anchor FROM reminders WHERE id = $1", [B_ROW.reminders])) === "start",
  "updateOwned reminder: B anchor unchanged",
);
ok(
  (await updateOwned(storeA, "labels", B_ROW.labels, { name: "stolen" })) === null,
  "updateOwned label: A cannot rename B",
);
ok(
  (await scalar<string>("SELECT name FROM labels WHERE id = $1", [B_ROW.labels])) === "B tag",
  "updateOwned label: B name unchanged",
);
ok(
  (await updateOwned(storeA, "recurrences", B_ROW.recurrences, { rrule: "FREQ=YEARLY" })) === null,
  "updateOwned recurrence: A cannot edit B",
);
ok(
  (await scalar<string>("SELECT rrule FROM recurrences WHERE id = $1", [B_ROW.recurrences])) === "FREQ=DAILY",
  "updateOwned recurrence: B rrule unchanged",
);
ok(
  (await updateOwned(storeA, "week_reviews", B_ROW.week_reviews, { report: { stolen: true } })) === null,
  "updateOwned week_review: A cannot edit B",
);
ok(
  (await updateOwned(storeA, "sprints", B_ROW.sprints, { week_start: "1999-01-01" })) === null,
  "updateOwned sprint: A cannot edit B",
);
ok(
  (await scalar<string>("SELECT week_start::text FROM sprints WHERE id = $1", [B_ROW.sprints])) === "2026-10-26",
  "updateOwned sprint: B week_start unchanged",
);

for (let i = 0; i < 8; i++) {
  ok(
    (await updateOwned(storeA, "domains", DOMAIN_B, { name: `stolen-${i}` })) === null,
    `updateOwned domain run ${i + 1}/8: A PATCH B is null`,
  );
  ok(
    (await scalar<string>("SELECT name FROM domains WHERE id = $1", [DOMAIN_B])) === "B Work",
    `updateOwned domain run ${i + 1}/8: B name unchanged`,
  );
}
ok(
  (await updateOwned(storeA, "domains", DOMAIN_B, { color: "#000000" })) === null,
  "updateOwned domain: unrecognized patch is not a 200 via getOwned",
);
ok((await updateDomainName(storeA, DOMAIN_B, "stolen")) === null, "updateDomainName: A cannot rename B (rows affected)");

ok((await getOwned(storeA, "sprints", "bbbbbbbb-6666-4000-8000-000000000001")) === null, "getOwned sprints: A cannot read B week");

for (const table of PLANNER_TABLES) {
  const bid = B_ROW[table];
  const listed = await listOwned(storeA, table);
  if (table === "user_settings") {
    ok(listed.every((row) => row.user_id === A), `listOwned ${table}: A only own settings`);
  } else {
    ok(!listed.some((row) => row.id === bid), `listOwned ${table}: A cannot list B ${table}`);
    ok((await getOwned(storeA, table, bid)) === null, `getOwned ${table}: A cannot read B`);
  }
}

const bSettingsBefore = await scalar<string>("SELECT theme FROM user_settings WHERE user_id = $1", [B]);
const aSettingsBefore = await scalar<string>("SELECT theme FROM user_settings WHERE user_id = $1", [A]);
ok((await deleteOwned(storeA, "user_settings", B)) === 0, "deleteOwned settings: A cannot delete B");
ok(
  (await scalar<string>("SELECT theme FROM user_settings WHERE user_id = $1", [B])) === bSettingsBefore,
  "deleteOwned settings: B settings still present",
);
ok(
  (await scalar<string>("SELECT theme FROM user_settings WHERE user_id = $1", [A])) === aSettingsBefore,
  "deleteOwned settings: A settings untouched when targeting B",
);

for (const table of PLANNER_TABLES) {
  if (table === "user_settings") continue;
  const bid = B_ROW[table];
  ok((await deleteOwned(storeA, table, bid)) === 0, `deleteOwned ${table}: A cannot delete B`);
  ok((await count(table, table === "user_settings" ? "user_id = $1" : "id = $1", [bid])) === 1, `deleteOwned ${table}: B row still present`);
}

const storeC = makeStore(sql, C);
await bootstrapUser(storeC, "c@example.test");
ok((await count("domains", "user_id = $1", [C])) === 4, "bootstrap: empty C still seeds despite B domains");
ok((await count("domains", "user_id = $1 AND name = $2", [C, "B Work"])) === 0, "bootstrap: C did not inherit B Work");
ok((await count("domains", "user_id = $1", [B])) === 1, "bootstrap: B domain count unchanged");

const SEED = "44444444-4444-4444-4444-444444444444";
const AUTH_NEW = "55555555-5555-5555-5555-555555555555";
const AUTH_UNVER = "88888888-8888-8888-8888-888888888888";
const SEED_DOMAIN = "44444444-0000-4000-8000-000000000001";
await db.exec(`
  INSERT INTO users (id, email) VALUES ('${SEED}', 'seed@example.test');
  INSERT INTO domains (id, user_id, name, color) VALUES
    ('${SEED_DOMAIN}', '${SEED}', 'Seed Work', '#2563EB');
`);

const unverified = await bootstrapUser(makeStore(sql, AUTH_UNVER), "seed@example.test", { emailVerified: false });
ok(unverified.userId !== SEED, "bootstrap: unverified sign-up does not adopt the seeded email");
ok((await getOwned(unverified, "domains", SEED_DOMAIN)) === null, "bootstrap: unverified session cannot read seed data");
ok((await count("domains", "user_id = $1 AND name = $2", [SEED, "Seed Work"])) === 1, "bootstrap: seed domain still on the seed row");
ok((await scalar<string>("SELECT auth_id::text FROM users WHERE id = $1", [SEED])) == null, "bootstrap: unverified does not write auth_id on the seed row");

const adopted = await bootstrapUser(makeStore(sql, AUTH_NEW), "seed@example.test", { emailVerified: true });
ok(adopted.userId === SEED, "bootstrap: verified OTP user adopts the existing email row");
ok((await count("users", "lower(email) = $1", ["seed@example.test"])) === 1, "bootstrap: email stays unique");
ok((await count("users", "id = $1", [AUTH_NEW])) === 0, "bootstrap: does not insert a colliding auth id");
ok((await scalar<string>("SELECT auth_id::text FROM users WHERE id = $1", [SEED])) === AUTH_NEW, "bootstrap: persists BA user id on the users row");
ok((await count("domains", "user_id = $1 AND name = $2", [SEED, "Seed Work"])) === 1, "bootstrap: adopted row keeps its domain");
ok((await getOwned(adopted, "domains", SEED_DOMAIN)) != null, "bootstrap: adopted store can read the row");

const AUTH_SECOND = "99999999-9999-9999-9999-999999999999";
const second = await bootstrapUser(makeStore(sql, AUTH_SECOND), "seed@example.test", { emailVerified: true });
ok(second.userId === AUTH_SECOND, "bootstrap: second verified user gets a new row (no crash)");
ok(second.userId !== SEED, "bootstrap: second verified user does not take over the linked row");
ok((await getOwned(second, "domains", SEED_DOMAIN)) === null, "bootstrap: second verified user cannot read seed data");
ok((await scalar<string>("SELECT email FROM users WHERE id = $1", [SEED])) === "seed@example.test", "bootstrap: linked email unchanged");
ok((await scalar<string>("SELECT email FROM users WHERE id = $1", [AUTH_SECOND])) == null, "bootstrap: second user is inserted without the taken email");
ok((await scalar<string>("SELECT auth_id::text FROM users WHERE id = $1", [SEED])) === AUTH_NEW, "bootstrap: original auth_id unchanged");

const renamed = await bootstrapUser(makeStore(sql, AUTH_NEW), "renamed-seed@example.test", { emailVerified: true });
ok(renamed.userId === SEED, "bootstrap: auth_id link survives an email change");
ok((await scalar<string>("SELECT email FROM users WHERE id = $1", [SEED])) === "renamed-seed@example.test", "bootstrap: linked row takes the new email");
ok((await count("users", "id = $1", [AUTH_NEW])) === 0, "bootstrap: email change does not insert a new empty users row");
ok((await getOwned(renamed, "domains", SEED_DOMAIN)) != null, "bootstrap: renamed session still sees seed data");

const stayC = await bootstrapUser(storeC, "b@example.test");
ok(stayC.userId === C, "bootstrap: existing user cannot take over another email's row");
ok((await getOwned(stayC, "domains", DOMAIN_B)) === null, "bootstrap: C still cannot read B after a takeover attempt");
ok((await scalar<string>("SELECT email FROM users WHERE id = $1", [C])) === "c@example.test", "bootstrap: C email unchanged when target email is taken");
ok((await scalar<string>("SELECT email FROM users WHERE id = $1", [B])) === "b@example.test", "bootstrap: B email unchanged");

const reB = await bootstrapUser(makeStore(sql, "66666666-6666-6666-6666-666666666666"), "b@example.test", { emailVerified: true });
ok(reB.userId === B, "bootstrap: verified re-signup of B's email adopts B");
ok((await getOwned(reB, "domains", DOMAIN_B)) != null, "bootstrap: adopted B session sees B's domain");
ok((await getOwned(reB, "domains", DOMAIN_A)) === null, "bootstrap: adopted B still cannot read A");

const ACCT_A = "aaaaaaaa-eeee-4000-8000-000000000001";
const ACCT_B = "bbbbbbbb-eeee-4000-8000-000000000001";
const EVT_A = "aaaaaaaa-ffff-4000-8000-000000000001";
const EVT_B = "bbbbbbbb-ffff-4000-8000-000000000001";
const PUSH_A = "aaaaaaaa-0101-4000-8000-000000000001";
const PUSH_B = "bbbbbbbb-0101-4000-8000-000000000001";
const SRC_A = "aaaaaaaa-0202-4000-8000-000000000001";
const SRC_B = "bbbbbbbb-0202-4000-8000-000000000001";
const BIND_B = "bbbbbbbb-0303-4000-8000-000000000001";
const UNIT_B = "bbbbbbbb-0404-4000-8000-000000000001";
const CONN_B = "bbbbbbbb-0505-4000-8000-000000000001";

ok(
  (await listOwnedCalendarAccounts(storeA)).every((row) => row.user_id === A),
  "list calendar_accounts: A only own",
);
ok((await getOwnedCalendarAccount(storeA, ACCT_B)) === null, "get calendar_accounts: A cannot read B");
ok((await getOwnedCalendarAccount(storeA, ACCT_A))?.id === ACCT_A, "get calendar_accounts: A can read own");
ok((await deleteOwnedCalendarAccount(storeA, ACCT_B)) === 0, "delete calendar_accounts: A cannot delete B");
ok((await count("calendar_accounts", "id = $1", [ACCT_B])) === 1, "delete calendar_accounts: B row still present");
const plantedAcct = await insertCalendarAccount(storeA, {
  id: "cccccccc-eeee-4000-8000-000000000099",
  provider: "ics",
  email: "planted@example.test",
});
ok(plantedAcct?.user_id === A, "insert calendar_accounts: client cannot set B as owner");

ok((await listOwnedExternalEvents(storeA)).every((row) => row.user_id === A), "list external_events: A only own");
ok((await getOwnedExternalEvent(storeA, EVT_B)) === null, "get external_events: A cannot read B");
ok(
  (await insertExternalEvent(storeA, {
    account_id: ACCT_B,
    title: "steal",
    start_at: "2026-10-26T19:00:00Z",
    end_at: "2026-10-26T20:00:00Z",
  })) === null,
  "insert external_events: A cannot attach B account_id",
);
ok((await count("external_events", "user_id = $1", [B])) === 1, "insert external_events: B count unchanged");
ok((await getOwnedExternalEvent(storeA, EVT_A))?.id === EVT_A, "get external_events: A can read own");

ok(
  (await listOwnedPushSubscriptions(storeA)).every((row) => row.user_id === A),
  "list push_subscriptions: A only own",
);
ok(
  !(await listOwnedPushSubscriptions(storeA)).some((row) => row.id === PUSH_B),
  "list push_subscriptions: A cannot list B",
);
ok(
  (await insertPushSubscription(storeA, {
    endpoint: "https://push.example/a2",
    p256dh: "x",
    auth: "y",
  }))?.user_id === A,
  "insert push_subscriptions: row is A's",
);
ok(
  (await insertPushSubscription(storeA, {
    id: PUSH_B,
    endpoint: "https://push.example/steal",
    p256dh: "x",
    auth: "y",
  })) === null,
  "upsert push_subscriptions: A cannot take B's id",
);
ok((await count("push_subscriptions", "id = $1 AND user_id = $2", [PUSH_B, B])) === 1, "upsert push_subscriptions: B row unchanged");
ok(
  (await insertPushSubscription(storeA, {
    id: PUSH_A,
    endpoint: "https://push.example/a-resync",
    p256dh: "p256-a",
    auth: "auth-a",
    label: "A phone",
  }))?.user_id === A,
  "upsert push_subscriptions: A can refresh own row",
);
const aResync = await resyncOwnedPushSubscriptions(storeA, [
  {
    id: PUSH_A,
    endpoint: "https://push.example/a-keep",
    p256dh: "p256-a",
    auth: "auth-a",
    label: "A phone",
  },
]);
ok(aResync.upserted === 1, "resync push_subscriptions: upserts kept rows");
ok((await count("push_subscriptions", "id = $1 AND user_id = $2", [PUSH_A, A])) === 1, "resync push_subscriptions: A kept row remains");
ok((await count("push_subscriptions", "user_id = $1 AND endpoint = $2", [A, "https://push.example/a2"])) === 0, "resync push_subscriptions: A missing rows deleted");
ok((await count("push_subscriptions", "id = $1 AND user_id = $2", [PUSH_B, B])) === 1, "resync push_subscriptions: B row untouched");
ok((await resyncOwnedPushSubscriptions(storeA, [])).deleted >= 1, "resync empty: deletes A's remaining rows");
ok((await count("push_subscriptions", "user_id = $1", [A])) === 0, "resync empty: A has no push rows");
ok((await count("push_subscriptions", "id = $1 AND user_id = $2", [PUSH_B, B])) === 1, "resync empty: B row still untouched");

ok((await getOwnedActivitySource(storeA, SRC_B)) === null, "get activity_sources: A cannot read B");
ok((await listOwnedActivitySources(storeA)).every((row) => row.user_id === A), "list activity_sources: A only own");
ok(
  (await insertActivityBinding(storeA, {
    source_id: SRC_B,
    project_id: PROJECT_A,
    selector: "steal/b",
  })) === null,
  "insert activity_bindings: A cannot attach B source",
);
ok(
  (await insertActivityBinding(storeA, {
    source_id: SRC_A,
    project_id: PROJECT_B,
    selector: "steal/a",
  })) === null,
  "insert activity_bindings: A cannot attach B project",
);
ok((await count("activity_bindings", "id = $1", [BIND_B])) === 1, "insert activity_bindings: B row still present");
ok(
  !(await listOwnedActivityBindings(storeA)).some((row) => row.id === BIND_B),
  "list activity_bindings: A cannot list B",
);
ok(
  (await insertActivityUnit(storeA, {
    source_id: SRC_B,
    external_id: "PR_STEAL",
    title: "nope",
    occurred_at: "2026-10-26T13:00:00Z",
  })) === null,
  "insert activity_units: A cannot attach B source",
);
ok(!(await listOwnedActivityUnits(storeA)).some((row) => row.id === UNIT_B), "list activity_units: A cannot list B");
ok((await insertActivitySource(storeA, { login: "user-a-2" }))?.user_id === A, "insert activity_sources: row is A's");

ok((await getOwnedAppleIdentity(storeA))?.user_id === A, "get apple_identities: A sees own");
ok((await getOwnedAppleIdentity(storeA))?.apple_user_id === "apple-sub-a", "get apple_identities: A sub");
ok((await getOwnedAppleIdentity(storeB))?.apple_user_id === "apple-sub-b", "get apple_identities: B sub");
const plantedApple = await upsertAppleIdentity(storeA, { apple_user_id: "apple-sub-a-2", email: "take@example.test" });
ok(plantedApple?.user_id === A, "upsert apple_identities: writes A's row only");
ok(
  (await scalar<string>("SELECT apple_user_id FROM apple_identities WHERE user_id = $1", [B])) === "apple-sub-b",
  "upsert apple_identities: B sub unchanged",
);
ok(await appleUserIdTakenByOther(storeA, "apple-sub-b"), "apple identity: B's sub is taken from A's view");
ok(!(await appleUserIdTakenByOther(storeA, "apple-sub-a")), "apple identity: own sub is not taken-by-other");

ok(!(await listOwnedConnections(storeA)).some((row) => row.id === CONN_B), "list connections: A cannot list B");
ok((await insertConnection(storeA, { app: "x", name: "A2", token_hash: "hash-a2" }))?.user_id === A, "insert connections: row is A's");
ok(
  (await listOwnedInboundEmails(storeA)).every((row) => row.user_id === A),
  "list inbound_emails: A only own",
);
ok((await insertInboundEmail(storeA, { email_id: "email-a-2" }))?.user_id === A, "insert inbound_emails: row is A's");
ok((await listOwnedSyncLog(storeA)).every((row) => row.user_id === A), "list sync_log: A only own");

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("access isolation: ok");
