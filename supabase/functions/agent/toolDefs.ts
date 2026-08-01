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
          intention: { type: "string", description: "Standing vow — what faithfulness here means" },
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
        "Create a repeating upkeep task series (e.g. every 5 months, weekly). Use when the user names a cadence — NOT create_task.",
      parameters: {
        type: "object",
        properties: {
          capture: { type: "string", description: "Natural language with repeat phrase" },
          title: { type: "string" },
          freq: { type: "string", enum: ["daily", "weekly", "monthly"] },
          interval: { type: "integer", description: "Every N units (default 1)" },
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
        "Hold ONE block of time that owns several tasks. Use this when the user names a single window and more than one piece of work for it (\"9am slot where I'll update the docs, deploy Dayspring and fix the subdomains\", \"block 2–4 for the Meridian work\") — NOT one scheduled task per item. YOU write the title: 2–4 words naming the through-line of the work, in the user's own vocabulary, sentence case (\"Ship & fix\", \"Dayspring push\"). Never \"Work block\", never the items joined by commas, never the user's sentence echoed back. One thing at a stated time is schedule_task instead.",
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
      description: "Update task fields (title, notes, priority, deadline).",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
          title: { type: "string" },
          notes: { type: "string" },
          priority: { type: "string", enum: ["none", "low", "medium", "high"] },
          deadline: { type: "string", description: "YYYY-MM-DD or null to clear" },
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
        "Create a NEW calendar event (Google or Apple/iCloud). Only for first-time adds — NOT for 'put it on X calendar' when the event already exists (use move_event). Pass calendar_name ONLY when the user named a calendar or account; otherwise omit it and the event goes to their default. NEVER infer a calendar from what the event is about or who it's with. Always tell the user which calendar you used.",
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
              "The token from this tool's own previous result. Omit on the first call — that call only PROPOSES and changes nothing. Confirm on a later message, after the user has actually answered.",
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
              "The token from this tool's own previous result. Omit on the first call — that call only PROPOSES and changes nothing. Confirm on a later message, after the user has actually answered.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_tasks",
      description: "Search tasks by title when you need to find an id.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
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
  // NOTE: `point_at` is intentionally NOT here — it's built per-request from the
  // targets the client sends (see buildPointAtTool), so its vocabulary is always
  // current. The handler appends it to this list.
  ...VERTICAL_TOOL_DEFINITIONS,
];

export const TOOL_DEFINITIONS = hardenToolDefs(RAW_TOOL_DEFINITIONS);
