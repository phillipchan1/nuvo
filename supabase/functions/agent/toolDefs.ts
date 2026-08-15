// The agent's vocabulary — every tool it may call, as pure data.
//
// Split out of tools.ts (the handlers) on purpose: the handlers reach for the
// service-role client and Deno's env, so nothing outside Deno can import them.
// The DEFINITIONS have to be importable from anywhere, because the conformance
// battery (tests/agent/) drives the real agent loop over the real tool list —
// a battery that tested a hand-copied list would pass while the deployed agent
// used a different vocabulary, which is the exact class of drift the planning
// kernel exists to prevent (docs/planning-kernel.md).
//
// Zero imports, zero side effects. Definitions here; behavior in tools.ts and
// verticalTools.ts; the map of what the chat can do at all in
// docs/agent-conformance.md.

/** How a block of time gets named — stated once, so the chat's `create_slot`
 *  and the Schedule's "suggest a name" (see `slotNaming.ts`) can't drift into
 *  two naming voices. */
export const SLOT_NAMING_RUBRIC =
  "2–4 words naming the through-line of the work, in the user's own vocabulary, " +
  'sentence case ("Ship & fix", "Dayspring push"). Never "Work block", never the ' +
  "items joined by commas, never the user's sentence echoed back.";

export interface MarqueeDirective {
  spotlight?: { target: string; ref?: string; label?: string }[];
  caption?: string;
}

export interface MarqueeTargetSpec {
  key: string;
  describe: string;
}

/** Build the `point_at` tool definition from the targets the client sent this
 *  request. The enum + description are derived from live app state, so the
 *  agent's vocabulary is always current — no hardcoded list, no redeploy to add
 *  a target. Falls back to a minimal default when the client sends nothing. */
export function buildPointAtTool(targets: MarqueeTargetSpec[]) {
  const list = targets.length ? targets : [{ key: "priorities", describe: "The week's priorities." }];
  // Built per request, so it is hardened here rather than by hardenToolDefs.
  const bullets = list.map((t) => `- "${t.key}": ${t.describe}`).join("\n");
  return {
    type: "function" as const,
    function: {
      name: "point_at",
      description:
        "Show alongside telling. Drive the user's screen: bring the relevant destination forward (a floor, surface, record, or flow) and, where it's a section, hold a spotlight on it — so your answer lands on something visible. **Default to calling this whenever your answer is ABOUT one of the targets below — a data answer counts, not just an explicit 'show me' / 'open'.** Some targets are a specific item (a project, initiative, domain, task) — for those, pass its id as `ref` (use the ids in your context). After calling, answer normally with a real, self-contained reply (the highlight reinforces your words, it doesn't replace them). Skip it only for pure confirmations, chit-chat, or answers with no on-screen home — and don't re-surface the same target twice in a row.\n\nAvailable targets:\n" +
        bullets,
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: list.map((t) => t.key),
            description: "What to bring forward / spotlight.",
          },
          ref: {
            type: "string",
            description: "For a specific-item target (project/initiative/domain/task), the item's id. Omit for general targets.",
          },
          caption: {
            type: "string",
            description: "Optional ≤6-word tag pinned to the highlight, e.g. 'your week, in lights'.",
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
    },
  };
}

const VERTICAL_TOOL_NAMES = new Set([
  "create_domain",
  "update_domain",
  "delete_domain",
  "create_initiative",
  "update_initiative",
  "delete_initiative",
  "create_project",
  "update_project",
  "delete_project",
  "create_key_result",
  "update_key_result",
  "delete_key_result",
  "list_vertical",
]);

export function isVerticalTool(name: string) {
  return VERTICAL_TOOL_NAMES.has(name);
}

export const VERTICAL_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "list_vertical",
      description: "Search domains, initiatives, or projects by name when you need ids.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["domain", "initiative", "project"] },
          query: { type: "string" },
        },
        required: ["kind", "query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_domain",
      description: "Create a life domain (a top-level area). Use sparingly — most users already have domains.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          intention: { type: "string", description: "The domain's standing mandate — what it asks of you" },
          icon: { type: "string" },
          color: { type: "string" },
          weekly_target_hours: { type: "number" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_domain",
      description: "Update a domain's name, intention, icon, color, or weekly target hours.",
      parameters: {
        type: "object",
        properties: {
          domain_id: { type: "string" },
          domain_name: { type: "string" },
          name: { type: "string" },
          intention: { type: "string" },
          icon: { type: "string" },
          color: { type: "string" },
          weekly_target_hours: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_domain",
      description: "Delete a domain. Fails if it still has initiatives or projects.",
      parameters: {
        type: "object",
        properties: {
          domain_id: { type: "string" },
          domain_name: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_initiative",
      description:
        "Create an initiative (a bet with a finish line) under a domain. Always set a clear outcome. If one with this name already exists in the domain, it is returned instead of a second being made (existing: true) — say so rather than claiming a creation.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          domain_id: { type: "string" },
          domain_name: { type: "string" },
          outcome: { type: "string", description: "What done looks like — one line" },
          description: { type: "string" },
          target_date: { type: "string", description: "YYYY-MM-DD finish line" },
          start_date: { type: "string", description: "YYYY-MM-DD" },
          status: { type: "string", enum: ["backlog", "in_progress", "waiting", "cancelled", "complete"] },
          allow_duplicate: {
            type: "boolean",
            description: "Make a second initiative with this name anyway. Only when the user has said they want another one.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_initiative",
      description: "Update an initiative.",
      parameters: {
        type: "object",
        properties: {
          initiative_id: { type: "string" },
          initiative_name: { type: "string" },
          name: { type: "string" },
          outcome: { type: "string" },
          description: { type: "string" },
          target_date: { type: "string" },
          start_date: { type: "string" },
          status: { type: "string", enum: ["backlog", "in_progress", "waiting", "cancelled", "complete"] },
          domain_id: { type: "string" },
          domain_name: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_initiative",
      description:
        "Delete one or more initiatives and their key results. Projects under them are unlinked, not deleted. For duplicate names, use initiative_ids from context or delete_all_matching after user confirms.",
      parameters: {
        type: "object",
        properties: {
          initiative_id: { type: "string" },
          initiative_ids: { type: "array", items: { type: "string" }, description: "Delete multiple by id from context" },
          initiative_name: { type: "string" },
          domain_id: { type: "string", description: "Narrow name lookup to this domain" },
          domain_name: { type: "string" },
          delete_all_matching: {
            type: "boolean",
            description: "Delete every initiative matching initiative_name (+ domain). Use after user confirms bulk delete.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_project",
      description: "Create a project under a domain (and optionally an initiative). Set a clear outcome. If one with this name already exists in the domain, it is returned instead of a second being made (existing: true) — say so rather than claiming a creation.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          domain_id: { type: "string" },
          domain_name: { type: "string" },
          initiative_id: { type: "string" },
          initiative_name: { type: "string" },
          outcome: { type: "string" },
          description: { type: "string" },
          target_date: { type: "string" },
          start_date: { type: "string" },
          status: { type: "string", enum: ["backlog", "in_progress", "waiting", "cancelled", "complete"] },
          allow_duplicate: {
            type: "boolean",
            description: "Make a second project with this name anyway. Only when the user has said they want another one.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_project",
      description: "Update a project. When project_name matches more than one, the error lists the candidates with their ids — pick one and call again with project_id, or narrow with in_initiative_name.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string" },
          project_name: { type: "string" },
          in_initiative_id: { type: "string", description: "WHICH project: only consider projects under this initiative" },
          in_initiative_name: {
            type: "string",
            description: "WHICH project: only consider projects under the initiative with this name — use when the user says \"the one under X\"",
          },
          name: { type: "string" },
          outcome: { type: "string" },
          description: { type: "string" },
          target_date: { type: "string" },
          start_date: { type: "string" },
          status: { type: "string", enum: ["backlog", "in_progress", "waiting", "cancelled", "complete"] },
          domain_id: { type: "string" },
          domain_name: { type: "string" },
          initiative_id: { type: "string", description: "MOVES the project under this initiative. Set null to unlink." },
          initiative_name: { type: "string", description: "MOVES the project under the initiative with this name. To pick which project, use in_initiative_name." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_project",
      description:
        "Delete one or more projects. For duplicate names, use project_ids from context or delete_all_matching after user confirms.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string" },
          project_ids: { type: "array", items: { type: "string" }, description: "Delete multiple by id from context" },
          project_name: { type: "string" },
          domain_id: { type: "string", description: "Narrow name lookup to this domain" },
          domain_name: { type: "string" },
          in_initiative_id: { type: "string", description: "Narrow name lookup to projects under this initiative" },
          in_initiative_name: { type: "string", description: "Narrow name lookup to projects under the initiative with this name" },
          delete_all_matching: {
            type: "boolean",
            description: "Delete every project matching project_name (+ domain). Use after user confirms bulk delete.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_key_result",
      description: "Add a measurable key result to an initiative.",
      parameters: {
        type: "object",
        properties: {
          initiative_id: { type: "string" },
          initiative_name: { type: "string" },
          name: { type: "string" },
          baseline: { type: "number" },
          target: { type: "number" },
          unit: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_key_result",
      description: "Update a key result's name, baseline, current, target, or unit.",
      parameters: {
        type: "object",
        properties: {
          key_result_id: { type: "string" },
          name: { type: "string" },
          baseline: { type: "number" },
          current: { type: "number" },
          target: { type: "number" },
          unit: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_key_result",
      description: "Delete a key result.",
      parameters: {
        type: "object",
        properties: {
          key_result_id: { type: "string" },
        },
        required: ["key_result_id"],
      },
    },
  },
];

// Every tool's parameters get `additionalProperties: false`, applied here in
// ONE place rather than written into 38 schemas by hand — a new tool is hardened
// the day it is added, with nothing to remember.
//
// This is the portable half of schema strictness. Full `strict: true` also
// demands that EVERY property appear in `required` (optionals become nullable
// unions), which does not fit tools whose whole shape is "identify by id or by
// title, set whichever fields you're changing". The "at least one identifying
// argument" half is enforced in the handler instead — see REQUIRES_TARGET in
// tools.ts, where it holds regardless of what the provider's schema dialect
// supports.
// deno-lint-ignore no-explicit-any
export function hardenToolDefs<T extends { function: { parameters?: any } }>(defs: T[]): T[] {
  return defs.map((d) =>
    d.function.parameters
      ? { ...d, function: { ...d.function, parameters: { ...d.function.parameters, additionalProperties: false } } }
      : d,
  );
}

// Shared by create_calendar_event and propose_invite — a repeating series is the
// same shape whether or not the event has guests. Mirrors RecurrenceRule
// (_shared/recurrence.ts) so a value built here converts straight to a Google
// RRULE via toGoogleRRULE; the calendar UI's repeat picker builds the same shape.
const RECURRENCE_PARAM_SCHEMA = {
  type: "object",
  description:
    "Set when the user wants this to repeat — 'every week', 'weekly', 'every 2 weeks', 'daily standup', 'monthly'. Omit entirely for a one-time event.",
  properties: {
    freq: {
      type: "string",
      enum: ["daily", "weekly", "monthly"],
      description: "How often it repeats.",
    },
    interval: {
      type: "number",
      description: "Repeat every N units, e.g. 2 for 'every 2 weeks'. Default 1.",
    },
    byweekday: {
      type: "array",
      items: { type: "number" },
      description: "Weekly only. Days it repeats on, 0=Sunday..6=Saturday. Defaults to the day of start_local.",
    },
    count: { type: "number", description: "Stop after this many occurrences. Omit for no end." },
    until: { type: "string", description: "Stop after this date, 'YYYY-MM-DD'. Omit for no end." },
  },
  required: ["freq"],
};

const RAW_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "create_task",
      description:
        "Create a new task. Use capture for natural language (e.g. 'call David tomorrow 9am 30m #church !high') or explicit fields.",
      parameters: {
        type: "object",
        properties: {
          capture: { type: "string", description: "Natural language task capture string" },
          title: { type: "string" },
          notes: { type: "string" },
          do_date: { type: "string", description: "YYYY-MM-DD" },
          start_time: { type: "string", description: "America/Los_Angeles local time: 'YYYY-MM-DDTHH:MM' (24h, no offset). Server converts to UTC." },
          duration_minutes: { type: "integer" },
          priority: { type: "string", enum: ["none", "low", "medium", "high"] },
          label_names: { type: "array", items: { type: "string" } },
          project_id: { type: "string", description: "Parent project — task lands in backlog" },
          initiative_id: { type: "string", description: "Parent initiative if no project" },
          domain_id: { type: "string", description: "Parent domain if no project/initiative" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_recurring_task",
      description:
        "Create a repeating upkeep task series (e.g. every 5 months, weekly, every year, the last Friday of the month). Use when the user names a cadence — NOT create_task.",
      parameters: {
        type: "object",
        properties: {
          capture: { type: "string", description: "Natural language with repeat phrase" },
          title: { type: "string" },
          freq: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"] },
          interval: { type: "integer", description: "Every N units (default 1)" },
          bysetpos: {
            type: "integer",
            description:
              "Monthly/yearly only: which occurrence of the weekday — 1, 2, 3, 4, or -1 for LAST. Use this for 'the last Friday of the month', 'every second Tuesday of the month'. Without it the series repeats on the anchor's date.",
          },
          byweekday: {
            type: "integer",
            description: "0=Sun … 6=Sat. Only with bysetpos; defaults to the anchor date's own weekday.",
          },
          anchor_date: { type: "string", description: "First occurrence YYYY-MM-DD; default today" },
          duration_minutes: { type: "integer" },
          priority: { type: "string", enum: ["none", "low", "medium", "high"] },
          project_id: { type: "string" },
          domain_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "plan_task",
      description: "Plan a task for a day without a time block.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string", description: "Search by title if id unknown" },
          do_date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["do_date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "schedule_task",
      description: "Schedule a task as a time block on the calendar.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
          start_time: { type: "string", description: "America/Los_Angeles local time: 'YYYY-MM-DDTHH:MM' (24h, no offset). Server converts to UTC." },
          duration_minutes: { type: "integer" },
        },
        required: ["start_time"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_slot",
      description:
        `Hold ONE block of time that owns several tasks. Use this when the user names a single window and more than one piece of work for it ("9am slot where I'll update the docs, deploy Dayspring and fix the subdomains", "block 2–4 for the Meridian work") — NOT one scheduled task per item. YOU write the title: ${SLOT_NAMING_RUBRIC} One thing at a stated time is schedule_task instead.`,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The block's name — yours to write, 2–4 words, the through-line of what's inside." },
          start_local: { type: "string", description: "The user's LOCAL start time: 'YYYY-MM-DDTHH:MM' (24h, no offset). Server converts to UTC." },
          duration_minutes: { type: "integer", description: "How long the block holds. Use the length the user stated; otherwise size it to the work inside (sum the pieces, 30m each by default, round up to the half hour)." },
          tasks: {
            type: "array",
            description: "The work that goes inside, in order. Clean action phrases — same title hygiene as create_task. Existing tasks go in by id via task_ids instead.",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                duration_minutes: { type: "integer" },
                notes: { type: "string" },
              },
              required: ["title"],
            },
          },
          task_ids: { type: "array", items: { type: "string" }, description: "Ids of tasks that already exist and should move into this block." },
          project_id: { type: "string", description: "Set when one project covers everything inside — the block then carries its color and counts as that project's time." },
          domain_id: { type: "string", description: "Set when one life area covers the block but no single project does (standing time: \"every morning is Trading\")." },
        },
        required: ["title", "start_local"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_to_slot",
      description:
        "Put work inside a block the user already holds (\"add the ATC follow-up to my 9am\"). Moves existing tasks in by id, and/or creates new ones from titles. A task inside a slot loses its own time — the block is the time.",
      parameters: {
        type: "object",
        properties: {
          slot_id: { type: "string", description: "The slot's id from todaySlots." },
          slot_title: { type: "string", description: "The block's name, if you don't have its id." },
          task_ids: { type: "array", items: { type: "string" }, description: "Existing tasks to move into the block." },
          tasks: {
            type: "array",
            description: "New work to create inside the block.",
            items: {
              type: "object",
              properties: { title: { type: "string" }, duration_minutes: { type: "integer" } },
              required: ["title"],
            },
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reschedule_slot",
      description: "Move a block of time, or resize it. The work inside travels with it — never take the tasks out and re-place them individually.",
      parameters: {
        type: "object",
        properties: {
          slot_id: { type: "string" },
          slot_title: { type: "string" },
          start_local: { type: "string", description: "New LOCAL start: 'YYYY-MM-DDTHH:MM'. Omit to only change the length." },
          duration_minutes: { type: "integer" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_slot",
      description: "Release a block of time. The tasks inside are NOT deleted — they fall back onto the day, un-blocked. Say that when you confirm.",
      parameters: {
        type: "object",
        properties: {
          slot_id: { type: "string" },
          slot_title: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "unschedule_task",
      description: "Remove a task from the calendar but keep it planned for its day.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reschedule_task",
      description: "Move a scheduled task to a new start time and/or duration.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
          start_time: { type: "string", description: "America/Los_Angeles local time: 'YYYY-MM-DDTHH:MM' (24h, no offset). Server converts to UTC." },
          duration_minutes: { type: "integer" },
        },
        required: ["start_time"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "complete_task",
      description: "Mark a task as done.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "trash_task",
      description: "Trash a task.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "move_to_inbox",
      description: "Move a task back to inbox, clearing dates and times.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_task",
      description:
        "Update a task's fields. Use plan_task / schedule_task to place it on a day or a time — those carry the placement rules; this is for the task's own attributes.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
          title: { type: "string" },
          notes: { type: "string" },
          priority: { type: "string", enum: ["none", "low", "medium", "high"] },
          deadline: { type: "string", description: "YYYY-MM-DD, or empty string to clear" },
          duration_minutes: { type: "integer", description: "How long it takes." },
          energy: {
            type: "string",
            enum: ["deep", "shallow", "quick", "social"],
            description: "The register the work needs.",
          },
          project_id: {
            type: "string",
            description:
              "File it under a project. Its initiative and domain follow automatically — never set those by hand alongside this. Empty string unfiles it.",
          },
          domain_id: {
            type: "string",
            description: "Only for a task with no project. Empty string clears it.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "move_event",
      description:
        "PREFERRED when the user wants an EXISTING event on a different calendar: 'put it on Family', 'apple family', 'switch to Work', 'move to …'. Pass event_id from the event you just created (or event_title). NEVER recreate with create_calendar_event — that duplicates. Cross-account/provider copies then deletes the original.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "Event id from context / prior create action when known." },
          event_title: { type: "string", description: "Search by title if id unknown." },
          calendar_name: {
            type: "string",
            description:
              "Destination the user named — a calendar from writableCalendars ('Family', 'apple family calendar') or an account ('phil@frontierchurch.com').",
          },
        },
        required: ["calendar_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_calendar_event",
      description:
        "Create a NEW calendar event (Google or Apple/iCloud). Only for first-time adds — NOT for 'put it on X calendar' when the event already exists (use move_event). Pass calendar_name ONLY when the user named a calendar or account; otherwise omit it and the event goes to their default. NEVER infer a calendar from what the event is about or who it's with. Always tell the user which calendar you used. Pass recurrence for a repeating series ('every week', 'daily standup') — it applies in the same call, whether or not there are attendees.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title." },
          start_local: {
            type: "string",
            description:
              "Start in America/Los_Angeles local time — 'YYYY-MM-DDTHH:MM' (24h, no offset). Example: Tuesday Jun 30 at 5pm → '2026-06-30T17:00'. The server handles UTC conversion.",
          },
          end_local: {
            type: "string",
            description: "End in America/Los_Angeles local time — 'YYYY-MM-DDTHH:MM' (24h, no offset).",
          },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Email addresses of attendees to invite (optional; Google only).",
          },
          recurrence: RECURRENCE_PARAM_SCHEMA,
          calendar_name: {
            type: "string",
            description:
              "Only when the user NAMED where it goes. A calendar display name from writableCalendars ('Family', 'Apple Family', 'Work') or an account ('phil@frontierchurch.com', 'my gmail account'). Match loosely — 'apple family' → Family on iCloud. Omit entirely if they didn't say.",
          },
          location: { type: "string", description: "Optional location." },
          add_meet: {
            type: "boolean",
            description:
              "Attach a Google Meet link. OMIT unless the user said something about it — omitted follows their setting, which by default adds one to any event with guests. Pass true for 'add a Meet link' / 'make it a video call' / 'zoom-style call', false for 'no video' / 'in person'. Google only.",
          },
        },
        required: ["title", "start_local", "end_local"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reschedule_event",
      description: "Reschedule a Google calendar event (not a Nuvo task block).",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          event_title: { type: "string" },
          start_at: { type: "string", description: "ISO 8601 timestamp" },
          end_at: { type: "string", description: "ISO 8601 timestamp" },
          title: { type: "string" },
        },
        required: ["start_at", "end_at"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cancel_event",
      description:
        "Remove a Google calendar event from the user's calendar (cancel it). For meetings the user organizes this cancels for everyone; for an invite it drops off their calendar. Confirm with the user before calling. Only set notify=true if the user explicitly wants attendees told.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          event_title: { type: "string", description: "Search by title if id unknown" },
          notify: { type: "boolean", description: "Email attendees that it's cancelled. Default false." },
          confirm_token: {
            type: "string",
            description:
              "The token from this tool's own previous result. Ask the user FIRST, in words, and wait for their answer — do not call this tool to do the asking. Calling without a token is a safety backstop, not the way to raise the question: it changes nothing and only returns a proposal. Send the token on a later message, once they have actually answered.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "decline_event",
      description:
        "Decline a Google calendar event (RSVP declined) without removing it. Confirm with the user before calling. Only set notify=true if the user wants the organizer told.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          event_title: { type: "string", description: "Search by title if id unknown" },
          notify: { type: "boolean", description: "Tell the organizer you declined. Default false." },
          confirm_token: {
            type: "string",
            description:
              "The token from this tool's own previous result. Ask the user FIRST, in words, and wait for their answer — do not call this tool to do the asking. Calling without a token is a safety backstop, not the way to raise the question: it changes nothing and only returns a proposal. Send the token on a later message, once they have actually answered.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_step",
      description:
        "Add a step to a task's checklist — the small ordered list INSIDE one task. Use this when the user breaks a single task into parts ('split that into…', 'the steps are…', 'add a checklist'). A step is not a task: it can never be scheduled, dated, filed under a project, or given a priority of its own. If what they described is really separate work, make tasks instead.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string", description: "Search by title if id unknown." },
          steps: {
            type: "array",
            items: { type: "string" },
            description: "One or more step titles, in order. Send them all in ONE call.",
          },
        },
        required: ["steps"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "complete_step",
      description: "Tick (or untick) one step of a task's checklist.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The PARENT task." },
          task_title: { type: "string" },
          step_title: { type: "string", description: "Which step — matched against that task's steps only." },
          done: { type: "boolean", description: "Default true. Pass false to untick." },
        },
        required: ["step_title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_steps",
      description: "Read a task's checklist — its steps and which are done. Steps are invisible to list_tasks and to your context snapshot, so this is the only way to see them.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remove_step",
      description: "Remove one step from a task's checklist. Steps are not archived — this is immediate, but it only ever removes a checklist line, never a task.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
          step_title: { type: "string" },
        },
        required: ["step_title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "bulk_update_tasks",
      description:
        "Act on SEVERAL tasks at once — 'move all the sermon tasks to next week', 'make those three high priority', 'file the Dayspring ones under the project'. Name the tasks with `task_ids` (from list_tasks). This is the chat's twin of the app's bulk bar: the same acts, the same filing rule. Filing under a project carries its initiative and domain too, so hours never get credited to the wrong place. Say how many you changed, and to what. Never use it to delete — that is trash_task, one at a time, so nobody loses a list by accident.",
      parameters: {
        type: "object",
        properties: {
          task_ids: {
            type: "array",
            items: { type: "string" },
            description: "The tasks to change. Get them from list_tasks; 2–50.",
          },
          do_date: { type: "string", description: "YYYY-MM-DD, or empty string to clear the date." },
          priority: { type: "string", enum: ["high", "medium", "low", "none"] },
          project_id: { type: "string", description: "File all of them here. Empty string unfiles them." },
          label_names: { type: "array", items: { type: "string" }, description: "Labels to ADD (never removes)." },
          status: { type: "string", enum: ["done", "inbox"], description: "Complete them, or send them back to the inbox." },
        },
        required: ["task_ids"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_trashed_tasks",
      description:
        "List tasks in the trash, newest first. Use this for 'I deleted something by mistake', 'what did I delete', 'where did X go' — a trashed task is invisible to list_tasks and to your context, so without this you would wrongly tell them it's gone.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional title filter." },
          limit: { type: "number", description: "Default 20, cap 50." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "restore_task",
      description:
        "Bring a trashed task back. It returns to where the funnel says it belongs (its project's backlog, or the inbox if it has no home) — NOT to a date that has since passed. Find the id with list_trashed_tasks first.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string", description: "Search the TRASH by title if id unknown." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "purge_task",
      description:
        "Delete a trashed task PERMANENTLY. The only act in Nuvo with no undo — nothing brings it back. Only ever for a task already in the trash, only when the user asked for exactly this, and never as tidying you thought of yourself. Ordinary deleting is trash_task.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string", description: "Search the TRASH by title if id unknown." },
          confirm_token: {
            type: "string",
            description:
              "The token from this tool's own previous result. Ask the user FIRST, in words, and wait for their answer — do not call this tool to do the asking. Calling without a token is a safety backstop, not the way to raise the question: it changes nothing and only returns a proposal. Send the token on a later message, once they have actually answered.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_events",
      description:
        "Search the user's calendar by title or location — the only way to answer 'when did I last meet Sam', 'when is my next 1:1', 'have I got anything with Acme this month'. Your context only carries a narrow window around today, so use this for anything outside it rather than saying you can't see it. Returns both the next matches ahead and the most recent behind; say WHEN, not just that it exists.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words from the event's title or location." },
          direction: {
            type: "string",
            enum: ["both", "upcoming", "past"],
            description: "Default 'both'. 'past' for 'when did I last…', 'upcoming' for 'when is my next…'.",
          },
          limit: { type: "number", description: "Max results, default 10, cap 25." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_calendar_load",
      description:
        "How heavy a stretch of calendar is, day by day — the read behind the Year view. Use it for 'when am I quietest', 'is October brutal', 'where could a week of writing actually go', 'how does the rest of the year look'. Your context only carries a narrow window around today, so anything beyond a couple of weeks has to come from here rather than from a guess. Returns each day's band (clear · light · busy · full · over), a summary of the whole span, and — the part that matters most — the longest UNBROKEN run of clear days, because forty scattered free Tuesdays and one real free fortnight look identical in a count and only one of them is somewhere work fits. Answer with the stretch and its dates, not with a number of free days.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "YYYY-MM-DD, inclusive. Defaults to today." },
          end_date: {
            type: "string",
            description: "YYYY-MM-DD, inclusive. Defaults to 90 days after start. Max span 400 days.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_reminder",
      description:
        "Set how long before something Nuvo should speak: a meeting, a block the user scheduled, or a deadline. Name ONE target — task_id/task_title, or event_id/event_title, or slot_id. `lead_minutes` is minutes before; 0 means at the time; pass \"off\" to silence just this one item while leaving the user's defaults alone. Reminders are the app's only unprompted voice and they only ever announce something about to happen — never a planning nudge. If the user is asking for reminders in general rather than for one thing, tell them Settings → Reminders holds the defaults; do not set one per item to fake it.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string", description: "Search by title if id unknown." },
          event_id: { type: "string" },
          event_title: { type: "string", description: "Search by title if id unknown." },
          slot_id: { type: "string" },
          anchor: {
            type: "string",
            enum: ["start", "deadline"],
            description: "Which fact to hang it on. 'deadline' is tasks only; defaults to 'start'.",
          },
          lead_minutes: {
            type: "string",
            description:
              'Minutes before: "0", "5", "10", "15", "30", "60", "120", "1440" — or "off" to silence this one item.',
          },
        },
        required: ["lead_minutes"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "clear_reminder",
      description:
        "Drop a per-item reminder override, so this item goes back to whatever the user's defaults say. Different from silencing it (set_reminder with lead_minutes \"off\") — say which one you did.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
          event_id: { type: "string" },
          event_title: { type: "string" },
          slot_id: { type: "string" },
          anchor: { type: "string", enum: ["start", "deadline"] },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_reminders",
      description:
        "Read the user's reminder defaults and every per-item override they have set. Use it before answering 'will you remind me…' — the answer is usually the defaults, not a row.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "duplicate_event",
      description:
        "Copy an existing event to a new time — 'same again next Tuesday', 'book another one Thursday at 2'. Guests and recurrence do NOT carry: a copy that re-invited everyone would be mail the user didn't ask to send, and a copied series is two series. Say so when it matters.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          event_title: { type: "string", description: "Search by title if id unknown" },
          start_local: { type: "string", description: "YYYY-MM-DDTHH:mm in the user's zone. Omit to copy onto the same time." },
          end_local: { type: "string", description: "YYYY-MM-DDTHH:mm. Omit to keep the original's length." },
          title: { type: "string", description: "A new title. Omit to reuse the original's." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "rsvp_event",
      description:
        "Say YES or MAYBE to an invite — 'accept that meeting', 'I'll be there', 'put me down as tentative'. Saying NO is decline_event, which confirms first because it tells the organizer something they'd rather hear from a person; accepting needs no confirmation. Works on Google and Apple/iCloud invites alike.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          event_title: { type: "string", description: "Search by title if id unknown" },
          response: {
            type: "string",
            enum: ["accepted", "tentative"],
            description: "To decline, call decline_event instead.",
          },
          notify: { type: "boolean", description: "Tell the organizer. Default true — an answer nobody receives isn't an answer." },
        },
        required: ["response"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_tasks",
      description:
        "Find tasks — by title, or by asking a question of the list: \"what's overdue\", \"my high-priority errands this week\", \"anything undated in Work\". Every filter here is the SAME one the app's filter panel uses, so your answer and their screen can't disagree. Windows are relative (this_week means this week whenever you ask). Omit `query` to filter without searching a title. Trashed tasks are never returned — use list_trashed_tasks for those.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words from the title. Omit to filter only." },
          when: {
            type: "string",
            enum: ["overdue", "today", "tomorrow", "this_week", "next_week", "undated"],
            description:
              "Relative window. 'overdue' is the app's overdue: a date that has passed OR a block that ran more than an hour past its end.",
          },
          date_field: {
            type: "string",
            enum: ["do_date", "deadline"],
            description: "Which date `when` asks about. Default do_date — when they'll DO it, not when it's due.",
          },
          priority: {
            type: "array",
            items: { type: "string", enum: ["high", "medium", "low", "none"] },
          },
          label_names: { type: "array", items: { type: "string" }, description: "Any-of." },
          status: {
            type: "string",
            enum: ["open", "done", "any"],
            description: "Default 'open'.",
          },
          limit: { type: "number", description: "Default 20, cap 50." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_priority",
      description: "Set a priority for this week. A priority IS a project committed to the week, so this brings the project onto this week's slate (writes its sprint span, Mon–Fri) — pass project_id whenever one matches. Without a project it only leaves a note on the week and will not show on the week's plan.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The priority's name / outcome statement." },
          win: { type: "string", description: "What winning looks like — the definition of done in one line." },
          initiative_id: { type: "string", description: "The initiative this priority serves (optional)." },
          project_id: { type: "string", description: "The project being committed to this week — use an id from weekSlate / needsASprint / vertical.projects. Strongly preferred: this is what puts the priority on the week." },
        },
        required: ["title", "win"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_priority",
      description: "Edit a weekly priority's title or win condition.",
      parameters: {
        type: "object",
        properties: {
          priority_id: { type: "string", description: "The priority's id from context." },
          priority_title: { type: "string", description: "Search by title if id unknown." },
          title: { type: "string", description: "New title." },
          win: { type: "string", description: "New win condition." },
          initiative_id: { type: "string", description: "Update the linked initiative (pass null to clear)." },
          project_id: { type: "string", description: "Update the linked project (pass null to clear)." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "complete_priority",
      description: "Mark a weekly priority as landed. Works for a priority that has no stored record yet — pass the project's id or name and it records the verdict for this week.",
      parameters: {
        type: "object",
        properties: {
          priority_id: { type: "string", description: "The priority's id from weekSlate.priorityId, when it has one." },
          priority_title: { type: "string", description: "The priority or project name, if no id." },
          project_id: { type: "string", description: "The slate project's id — use this when the priority has no stored id." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_priority",
      description: "Take a priority off this week. Because a priority IS a project committed to the week, this clears that project's week span — the project goes back to \"needs a sprint\" with its work intact. Nothing is deleted.",
      parameters: {
        type: "object",
        properties: {
          priority_id: { type: "string", description: "The priority's id from weekSlate.priorityId, when it has one." },
          priority_title: { type: "string", description: "The priority or project name, if no id." },
          project_id: { type: "string", description: "The slate project's id — use this when the priority has no stored id." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_contact",
      description:
        "Look someone up in the user's address books (Google + Apple contacts, plus people they've actually met on synced calendar events). Read-only — sends nothing. Use it to answer \"what's Matt's email\", and to check who a name means BEFORE staging an invite when the user's wording is loose. An empty query returns the people they meet most.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "A name, part of a name, or an address. Omit or pass \"\" for their most-met contacts.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_invite",
      description:
        "Stage an invite for the user to approve. Use this for ANY event that involves other people — a new meeting with guests, or adding guests to an event that already exists. You CANNOT send invites yourself and create_calendar_event will refuse a guest list: this puts a confirmation card in the chat naming exactly who would be emailed, and the user taps Send invite or Add without emailing. Nothing reaches another human until they do. Pass attendees as the user said them ('Matt', 'the Hansens', 'dave@acme.com') — names are resolved against their contacts. If the result comes back with unresolved names, ASK the user about those (use a <suggestions> block listing the candidates) instead of guessing. Google calendars only. Pass recurrence for a repeating series with guests ('weekly meeting with the team') — the staged card carries the series, and it goes out in the same invite, not a second step.",
      parameters: {
        type: "object",
        properties: {
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Who to invite — names or email addresses, exactly as the user referred to them.",
          },
          title: { type: "string", description: "Event title. Required for a new event." },
          start_local: {
            type: "string",
            description: "Start in the user's local time — 'YYYY-MM-DDTHH:MM' (24h, no offset). New events only.",
          },
          end_local: {
            type: "string",
            description: "End in the user's local time — 'YYYY-MM-DDTHH:MM' (24h, no offset). New events only.",
          },
          recurrence: RECURRENCE_PARAM_SCHEMA,
          event_id: {
            type: "string",
            description: "Add guests to THIS existing event instead of creating one. Omit for a new event.",
          },
          event_title: { type: "string", description: "Find the existing event by title when the id is unknown." },
          calendar_name: {
            type: "string",
            description:
              "Only when the user NAMED where it goes — same rule as create_calendar_event. Omit and it goes to their default.",
          },
          location: { type: "string", description: "Optional location." },
          add_meet: {
            type: "boolean",
            description:
              "Attach a Google Meet link. OMIT unless the user said something about it — omitted follows their setting, which adds one to any event with guests.",
          },
        },
        required: ["attendees"],
      },
    },
  },
  // NOTE: `point_at` is intentionally NOT here — it's built per-request from the
  // targets the client sends (see buildPointAtTool), so its vocabulary is always
  // current. The handler appends it to this list.
  ...VERTICAL_TOOL_DEFINITIONS,
];

export const TOOL_DEFINITIONS = hardenToolDefs(RAW_TOOL_DEFINITIONS);
