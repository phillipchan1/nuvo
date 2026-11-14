/**
 * Repair recurring occurrences the Worker's rollover wrongly carried to today
 * (worker/src/rolloverRepair.ts has the why).
 *
 * Dry run by default — it only lists what it would change.
 *
 *   NEON_DATABASE_URL=… node --experimental-strip-types scripts/repair-rollover-recurrence.ts
 *   … --apply                      put them back on their own dates
 *   … --apply --trash              send them to the Trash instead (30 days to undo)
 *   … --email you@example.com      one account only
 *   … --today 2026-11-14           the day the rollover last ran (default: today in Los Angeles)
 */
import postgres from "postgres";
import { findWronglyCarried, repairWronglyCarried } from "../worker/src/rolloverRepair.ts";

const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL or NEON_DATABASE_URL is required");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const today =
  value("--today") ??
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const email = value("--email") ?? null;
const apply = flag("--apply");
const mode = flag("--trash") ? "trash" : "restore";

const sql = postgres(url, { max: 1, ssl: url.includes("localhost") ? false : "require" });
try {
  const rows = await findWronglyCarried(sql as never, { today, email });
  if (rows.length === 0) {
    console.log(`Nothing to repair (today=${today}${email ? `, ${email}` : ""}).`);
  } else {
    console.table(
      rows.map((r) => ({ account: r.email, title: r.title, scheduled: r.recurrence_date, now_on: r.do_date, carried: `${r.roll_count}d` })),
    );
    if (!apply) {
      console.log(`${rows.length} occurrence(s) would be ${mode === "trash" ? "trashed" : "put back on their own dates"}. Dry run — pass --apply.`);
    } else {
      const changed = await sql.begin(async (tx) => repairWronglyCarried(tx as never, rows.map((r) => r.id), mode));
      console.log(`${mode === "trash" ? "Trashed" : "Restored"} ${changed} occurrence(s).`);
    }
  }
} finally {
  await sql.end();
}
