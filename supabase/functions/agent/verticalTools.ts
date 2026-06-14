import { admin } from "../_shared/admin.ts";

async function countRows(table: string, col: string, id: string): Promise<number> {
  const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq(col, id);
  return count ?? 0;
}

async function resolveDomain(
  userId: string,
  args: { domain_id?: string; domain_name?: string },
): Promise<{ id: string; name: string }> {
  if (args.domain_id) {
    const { data, error } = await admin
      .from("domains")
      .select("id, name")
      .eq("id", args.domain_id)
      .eq("user_id", userId)
      .single();
    if (error || !data) throw new Error(`Domain not found: ${args.domain_id}`);
    return data;
  }
  if (args.domain_name) {
    const { data } = await admin
      .from("domains")
      .select("id, name")
      .eq("user_id", userId)
      .ilike("name", args.domain_name.trim())
      .limit(5);
    if (!data?.length) throw new Error(`No domain matching "${args.domain_name}"`);
    if (data.length > 1) {
      throw new Error(
        `Multiple domains match "${args.domain_name}": ${data.map((d) => `"${d.name}"`).join(", ")}. Use domain_id from context.`,
      );
    }
    return data[0];
  }
  throw new Error("Provide domain_id or domain_name");
}

async function resolveInitiative(
  userId: string,
  args: { initiative_id?: string; initiative_name?: string; domain_id?: string; domain_name?: string },
): Promise<{ id: string; name: string; domain_id: string | null }> {
  const matches = await resolveInitiativesList(userId, args);
  if (matches.length !== 1) {
    throw new Error(
      matches.length > 1
        ? `Multiple initiatives match (${matches.length}). Use initiative_ids from context or delete_all_matching after user confirms.`
        : "Initiative not found",
    );
  }
  return matches[0];
}

async function resolveInitiativesList(
  userId: string,
  args: {
    initiative_id?: string;
    initiative_ids?: string[];
    initiative_name?: string;
    domain_id?: string;
    domain_name?: string;
  },
): Promise<{ id: string; name: string; domain_id: string | null }[]> {
  if (args.initiative_ids?.length) {
    const { data, error } = await admin
      .from("initiatives")
      .select("id, name, domain_id")
      .eq("user_id", userId)
      .in("id", args.initiative_ids);
    if (error || !data?.length) throw new Error("Initiatives not found");
    return data;
  }
  if (args.initiative_id) {
    const { data, error } = await admin
      .from("initiatives")
      .select("id, name, domain_id")
      .eq("id", args.initiative_id)
      .eq("user_id", userId)
      .single();
    if (error || !data) throw new Error(`Initiative not found: ${args.initiative_id}`);
    return [data];
  }
  if (args.initiative_name) {
    let domainId = args.domain_id;
    if (args.domain_name) {
      domainId = (await resolveDomain(userId, { domain_name: args.domain_name })).id;
    }
    let q = admin
      .from("initiatives")
      .select("id, name, domain_id")
      .eq("user_id", userId)
      .ilike("name", `%${args.initiative_name.trim()}%`);
    if (domainId) q = q.eq("domain_id", domainId);
    const { data } = await q.limit(20);
    if (!data?.length) throw new Error(`No initiative matching "${args.initiative_name}"`);
    return data;
  }
  throw new Error("Provide initiative_id, initiative_ids, or initiative_name");
}

async function resolveProject(
  userId: string,
  args: { project_id?: string; project_name?: string; domain_id?: string; domain_name?: string },
): Promise<{ id: string; name: string; domain_id: string | null; initiative_id: string | null }> {
  const matches = await resolveProjectsList(userId, args);
  if (matches.length !== 1) {
    throw new Error(
      matches.length > 1
        ? `Multiple projects match (${matches.length}). Use project_ids from context or delete_all_matching after user confirms.`
        : "Project not found",
    );
  }
  return matches[0];
}

async function resolveProjectsList(
  userId: string,
  args: {
    project_id?: string;
    project_ids?: string[];
    project_name?: string;
    domain_id?: string;
    domain_name?: string;
  },
): Promise<{ id: string; name: string; domain_id: string | null; initiative_id: string | null }[]> {
  if (args.project_ids?.length) {
    const { data, error } = await admin
      .from("projects")
      .select("id, name, domain_id, initiative_id")
      .eq("user_id", userId)
      .in("id", args.project_ids);
    if (error || !data?.length) throw new Error("Projects not found");
    return data;
  }
  if (args.project_id) {
    const { data, error } = await admin
      .from("projects")
      .select("id, name, domain_id, initiative_id")
      .eq("id", args.project_id)
      .eq("user_id", userId)
      .single();
    if (error || !data) throw new Error(`Project not found: ${args.project_id}`);
    return [data];
  }
  if (args.project_name) {
    let domainId = args.domain_id;
    if (args.domain_name) {
      domainId = (await resolveDomain(userId, { domain_name: args.domain_name })).id;
    }
    let q = admin
      .from("projects")
      .select("id, name, domain_id, initiative_id")
      .eq("user_id", userId)
      .ilike("name", `%${args.project_name.trim()}%`);
    if (domainId) q = q.eq("domain_id", domainId);
    const { data } = await q.limit(20);
    if (!data?.length) throw new Error(`No project matching "${args.project_name}"`);
    return data;
  }
  throw new Error("Provide project_id, project_ids, or project_name");
}

async function nextSort(table: string, userId: string, extra?: Record<string, string>): Promise<number> {
  let q = admin.from(table).select("sort_order").eq("user_id", userId).order("sort_order", { ascending: false }).limit(1);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
  }
  const { data } = await q;
  return ((data?.[0]?.sort_order as number) ?? 0) + 1;
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
        "Create an initiative (a bet with a finish line) under a domain. Always set a clear outcome.",
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
          status: { type: "string", enum: ["active", "paused", "shipped", "dropped"] },
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
          status: { type: "string", enum: ["active", "paused", "shipped", "dropped"] },
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
      description: "Create a project under a domain (and optionally an initiative). Set a clear outcome.",
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
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_project",
      description: "Update a project.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string" },
          project_name: { type: "string" },
          name: { type: "string" },
          outcome: { type: "string" },
          description: { type: "string" },
          target_date: { type: "string" },
          start_date: { type: "string" },
          status: { type: "string", enum: ["backlog", "in_progress", "waiting", "cancelled", "complete"] },
          domain_id: { type: "string" },
          domain_name: { type: "string" },
          initiative_id: { type: "string", description: "Set null to unlink from initiative" },
          initiative_name: { type: "string" },
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

export async function executeVerticalTool(
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: string; action?: { tool: string; summary: string } }> {
  switch (name) {
    case "list_vertical": {
      const kind = args.kind as string;
      const query = (args.query as string).trim();
      if (kind === "domain") {
        const { data } = await admin.from("domains").select("id, name, intention").eq("user_id", userId).ilike("name", `%${query}%`).limit(10);
        return { result: JSON.stringify(data ?? []) };
      }
      if (kind === "initiative") {
        const { data } = await admin.from("initiatives").select("id, name, domain_id, outcome, status").eq("user_id", userId).ilike("name", `%${query}%`).limit(10);
        return { result: JSON.stringify(data ?? []) };
      }
      if (kind === "project") {
        const { data } = await admin.from("projects").select("id, name, domain_id, initiative_id, outcome, status").eq("user_id", userId).ilike("name", `%${query}%`).limit(10);
        return { result: JSON.stringify(data ?? []) };
      }
      throw new Error("kind must be domain, initiative, or project");
    }

    case "create_domain": {
      const title = (args.name as string)?.trim();
      if (!title) throw new Error("name is required");
      const sort = await nextSort("domains", userId);
      const { data, error } = await admin
        .from("domains")
        .insert({
          user_id: userId,
          name: title,
          intention: (args.intention as string) ?? "",
          icon: (args.icon as string) ?? "◇",
          color: (args.color as string) ?? "#6B7280",
          weekly_target_hours: args.weekly_target_hours ?? null,
          sort_order: sort,
        })
        .select("id, name")
        .single();
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify(data),
        action: { tool: name, summary: `Created domain "${data.name}"` },
      };
    }

    case "update_domain": {
      const { id, name: dName } = await resolveDomain(userId, args as { domain_id?: string; domain_name?: string });
      const patch: Record<string, unknown> = {};
      if (args.name) patch.name = args.name;
      if (args.intention !== undefined) patch.intention = args.intention;
      if (args.icon) patch.icon = args.icon;
      if (args.color) patch.color = args.color;
      if (args.weekly_target_hours !== undefined) patch.weekly_target_hours = args.weekly_target_hours;
      if (!Object.keys(patch).length) throw new Error("No fields to update");
      const { error } = await admin.from("domains").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify({ id, patch }),
        action: { tool: name, summary: `Updated domain "${dName}"` },
      };
    }

    case "delete_domain": {
      const { id, name: dName } = await resolveDomain(userId, args as { domain_id?: string; domain_name?: string });
      const [initCount, projCount] = await Promise.all([
        countRows("initiatives", "domain_id", id),
        countRows("projects", "domain_id", id),
      ]);
      if (initCount + projCount > 0) {
        throw new Error(`Domain "${dName}" still has ${initCount} initiative(s) and ${projCount} project(s). Move or delete them first.`);
      }
      const { error } = await admin.from("domains").delete().eq("id", id);
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify({ id, deleted: true }),
        action: { tool: name, summary: `Deleted domain "${dName}"` },
      };
    }

    case "create_initiative": {
      const title = (args.name as string)?.trim();
      if (!title) throw new Error("name is required");
      let domainId = args.domain_id as string | undefined;
      if (!domainId && args.domain_name) {
        domainId = (await resolveDomain(userId, { domain_name: args.domain_name as string })).id;
      }
      if (!domainId) {
        const { data: domains } = await admin.from("domains").select("id, name").eq("user_id", userId).order("sort_order").limit(5);
        if (domains?.length === 1) domainId = domains[0].id;
        else throw new Error(`domain_id or domain_name required. Domains: ${(domains ?? []).map((d) => `"${d.name}" (${d.id})`).join(", ") || "none"}`);
      }
      const sort = await nextSort("initiatives", userId);
      const { data, error } = await admin
        .from("initiatives")
        .insert({
          user_id: userId,
          domain_id: domainId,
          name: title,
          outcome: (args.outcome as string)?.trim() || "",
          description: (args.description as string) ?? "",
          target_date: args.target_date ?? null,
          start_date: args.start_date ?? null,
          status: (args.status as string) ?? "active",
          sort_order: sort,
        })
        .select("id, name, domain_id, outcome")
        .single();
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify(data),
        action: { tool: name, summary: `Created initiative "${data.name}"` },
      };
    }

    case "update_initiative": {
      const init = await resolveInitiative(userId, args as { initiative_id?: string; initiative_name?: string });
      const patch: Record<string, unknown> = {};
      if (args.name) patch.name = args.name;
      if (args.outcome !== undefined) patch.outcome = args.outcome;
      if (args.description !== undefined) patch.description = args.description;
      if (args.target_date !== undefined) patch.target_date = args.target_date || null;
      if (args.start_date !== undefined) patch.start_date = args.start_date || null;
      if (args.status) patch.status = args.status;
      if (args.domain_id) patch.domain_id = args.domain_id;
      if (args.domain_name) patch.domain_id = (await resolveDomain(userId, { domain_name: args.domain_name as string })).id;
      if (!Object.keys(patch).length) throw new Error("No fields to update");
      const { error } = await admin.from("initiatives").update(patch).eq("id", init.id);
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify({ id: init.id, patch }),
        action: { tool: name, summary: `Updated initiative "${init.name}"` },
      };
    }

    case "delete_initiative": {
      const listArgs = args as {
        initiative_id?: string;
        initiative_ids?: string[];
        initiative_name?: string;
        domain_id?: string;
        domain_name?: string;
        delete_all_matching?: boolean;
      };
      let targets: { id: string; name: string }[];
      if (listArgs.initiative_ids?.length) {
        targets = await resolveInitiativesList(userId, listArgs);
      } else if (listArgs.delete_all_matching) {
        targets = await resolveInitiativesList(userId, listArgs);
        if (targets.length === 0) throw new Error("No matching initiatives to delete");
      } else {
        targets = [await resolveInitiative(userId, listArgs)];
      }
      for (const init of targets) {
        await admin.from("projects").update({ initiative_id: null }).eq("initiative_id", init.id);
        await admin.from("key_results").delete().eq("initiative_id", init.id);
        const { error } = await admin.from("initiatives").delete().eq("id", init.id);
        if (error) throw new Error(error.message);
      }
      const summary =
        targets.length === 1
          ? `Deleted initiative "${targets[0].name}"`
          : `Deleted ${targets.length} initiatives`;
      return {
        result: JSON.stringify({ deleted: targets.map((t) => t.id), count: targets.length }),
        action: { tool: name, summary },
      };
    }

    case "create_project": {
      const title = (args.name as string)?.trim();
      if (!title) throw new Error("name is required");
      let domainId = args.domain_id as string | undefined;
      if (!domainId && args.domain_name) {
        domainId = (await resolveDomain(userId, { domain_name: args.domain_name as string })).id;
      }
      let initiativeId = (args.initiative_id as string) ?? null;
      if (!initiativeId && args.initiative_name) {
        const init = await resolveInitiative(userId, { initiative_name: args.initiative_name as string });
        initiativeId = init.id;
        if (!domainId && init.domain_id) domainId = init.domain_id;
      }
      if (!domainId) throw new Error("domain_id or domain_name is required");
      const sort = await nextSort("projects", userId);
      const { data, error } = await admin
        .from("projects")
        .insert({
          user_id: userId,
          domain_id: domainId,
          initiative_id: initiativeId,
          name: title,
          outcome: (args.outcome as string)?.trim() || "",
          description: (args.description as string) ?? "",
          target_date: args.target_date ?? null,
          start_date: args.start_date ?? null,
          status: (args.status as string) ?? "backlog",
          sort_order: sort,
        })
        .select("id, name, domain_id, initiative_id, outcome, status")
        .single();
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify(data),
        action: { tool: name, summary: `Created project "${data.name}"` },
      };
    }

    case "update_project": {
      const proj = await resolveProject(userId, args as { project_id?: string; project_name?: string });
      const patch: Record<string, unknown> = {};
      if (args.name) patch.name = args.name;
      if (args.outcome !== undefined) patch.outcome = args.outcome;
      if (args.description !== undefined) patch.description = args.description;
      if (args.target_date !== undefined) patch.target_date = args.target_date || null;
      if (args.start_date !== undefined) patch.start_date = args.start_date || null;
      if (args.status) patch.status = args.status;
      if (args.domain_id) patch.domain_id = args.domain_id;
      if (args.domain_name) patch.domain_id = (await resolveDomain(userId, { domain_name: args.domain_name as string })).id;
      if (args.initiative_id !== undefined) patch.initiative_id = args.initiative_id || null;
      if (args.initiative_name) patch.initiative_id = (await resolveInitiative(userId, { initiative_name: args.initiative_name as string })).id;
      if (!Object.keys(patch).length) throw new Error("No fields to update");
      const { error } = await admin.from("projects").update(patch).eq("id", proj.id);
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify({ id: proj.id, patch }),
        action: { tool: name, summary: `Updated project "${proj.name}"` },
      };
    }

    case "delete_project": {
      const listArgs = args as {
        project_id?: string;
        project_ids?: string[];
        project_name?: string;
        domain_id?: string;
        domain_name?: string;
        delete_all_matching?: boolean;
      };
      let targets: { id: string; name: string }[];
      if (listArgs.project_ids?.length) {
        targets = await resolveProjectsList(userId, listArgs);
      } else if (listArgs.delete_all_matching) {
        targets = await resolveProjectsList(userId, listArgs);
        if (targets.length === 0) throw new Error("No matching projects to delete");
      } else {
        targets = [await resolveProject(userId, listArgs)];
      }
      for (const proj of targets) {
        const { error } = await admin.from("projects").delete().eq("id", proj.id);
        if (error) throw new Error(error.message);
      }
      const summary =
        targets.length === 1 ? `Deleted project "${targets[0].name}"` : `Deleted ${targets.length} projects`;
      return {
        result: JSON.stringify({ deleted: targets.map((t) => t.id), count: targets.length }),
        action: { tool: name, summary },
      };
    }

    case "create_key_result": {
      const krName = (args.name as string)?.trim();
      if (!krName) throw new Error("name is required");
      const init = await resolveInitiative(userId, args as { initiative_id?: string; initiative_name?: string });
      const sort = await nextSort("key_results", userId, { initiative_id: init.id });
      const { data, error } = await admin
        .from("key_results")
        .insert({
          user_id: userId,
          initiative_id: init.id,
          name: krName,
          baseline_value: args.baseline ?? 0,
          current_value: args.baseline ?? 0,
          target_value: args.target ?? 100,
          unit: (args.unit as string) ?? "%",
          sort_order: sort,
        })
        .select("id, name, initiative_id")
        .single();
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify(data),
        action: { tool: name, summary: `Added key result "${data.name}" to "${init.name}"` },
      };
    }

    case "update_key_result": {
      const krId = args.key_result_id as string;
      if (!krId) throw new Error("key_result_id is required");
      const patch: Record<string, unknown> = {};
      if (args.name) patch.name = args.name;
      if (args.baseline !== undefined) patch.baseline_value = args.baseline;
      if (args.current !== undefined) patch.current_value = args.current;
      if (args.target !== undefined) patch.target_value = args.target;
      if (args.unit) patch.unit = args.unit;
      if (!Object.keys(patch).length) throw new Error("No fields to update");
      const { data, error } = await admin.from("key_results").update(patch).eq("id", krId).eq("user_id", userId).select("name").single();
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify({ id: krId, patch }),
        action: { tool: name, summary: `Updated key result "${data.name}"` },
      };
    }

    case "delete_key_result": {
      const krId = args.key_result_id as string;
      const { data, error } = await admin.from("key_results").delete().eq("id", krId).eq("user_id", userId).select("name").single();
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify({ id: krId, deleted: true }),
        action: { tool: name, summary: `Deleted key result "${data.name}"` },
      };
    }

    default:
      throw new Error(`Unknown vertical tool: ${name}`);
  }
}
