import { admin } from "../_shared/admin.ts";

async function countRows(table: string, col: string, id: string): Promise<number> {
  const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq(col, id);
  return count ?? 0;
}

// ── resolving a name to exactly one row ──────────────────────────────────────
//
// A name lookup that finds several rows is not a failure — it's a question, and
// the model can only ask it well if the tool hands back what the choices ARE.
// The old error was the count alone ("Multiple projects match (2)"), which left
// the chat repeating "I need the exact one" at a user who had already said it.
// See tests/agent-vertical.test.ts for the conversation that produced this.

/** Prefer a whole-name hit over a merely-contains hit. Without this, creating
 *  "Dayspring Support v2 Rollout" retroactively makes "Dayspring Support"
 *  ambiguous — an ambiguity no user would recognize as one. */
function preferExact<T extends { name: string }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const exact = rows.filter((r) => r.name.trim().toLowerCase() === q);
  return exact.length ? exact : rows;
}

/** The one thing the model is missing when a lookup is ambiguous: which rows,
 *  and what tells them apart. Ids are safe to include — the reply sanitizer
 *  scrubs them before the user sees anything. */
function ambiguous(
  kind: "project" | "initiative",
  query: string,
  candidates: Record<string, unknown>[],
  advice: string,
): Error {
  return new Error(
    `Multiple ${kind}s match "${query}" (${candidates.length}). ${advice}\n` +
      `Candidates: ${JSON.stringify(candidates)}`,
  );
}

/** Resolve ids to names so a candidate list reads like the thing the user is
 *  choosing between, not like a row dump. */
async function namesById(table: string, userId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (!wanted.length) return new Map();
  const { data } = await admin.from(table).select("id, name").eq("user_id", userId).in("id", wanted);
  return new Map((data ?? []).map((r: { id: string; name: string }) => [r.id, r.name]));
}

async function describeProjects(userId: string, rows: ProjectRow[]): Promise<Record<string, unknown>[]> {
  const [inits, doms] = await Promise.all([
    namesById("initiatives", userId, rows.map((r) => r.initiative_id)),
    namesById("domains", userId, rows.map((r) => r.domain_id)),
  ]);
  return rows.map((r) => ({
    project_id: r.id,
    name: r.name,
    initiative: r.initiative_id ? (inits.get(r.initiative_id) ?? null) : null,
    domain: r.domain_id ? (doms.get(r.domain_id) ?? null) : null,
    status: r.status ?? null,
  }));
}

async function describeInitiatives(userId: string, rows: InitiativeRow[]): Promise<Record<string, unknown>[]> {
  const doms = await namesById("domains", userId, rows.map((r) => r.domain_id));
  return rows.map((r) => ({
    initiative_id: r.id,
    name: r.name,
    domain: r.domain_id ? (doms.get(r.domain_id) ?? null) : null,
    status: r.status ?? null,
  }));
}

/** What a create should do when the thing already exists: hand back the one
 *  that's there. The database has no unique constraint on these names, so this
 *  guard is the only thing between "add a project" and a twin — and a twin is
 *  what makes every later lookup ambiguous. */
async function existingByName(
  table: "projects" | "initiatives",
  userId: string,
  title: string,
  scope: { domain_id?: string | null; initiative_id?: string | null },
): Promise<Record<string, unknown> | null> {
  let q = admin.from(table).select("*").eq("user_id", userId).ilike("name", title.trim());
  if (scope.domain_id) q = q.eq("domain_id", scope.domain_id);
  if (table === "projects" && scope.initiative_id) q = q.eq("initiative_id", scope.initiative_id);
  const { data } = await q.limit(2);
  return data?.length ? data[0] : null;
}

type ProjectRow = {
  id: string;
  name: string;
  domain_id: string | null;
  initiative_id: string | null;
  status?: string | null;
};

type InitiativeRow = {
  id: string;
  name: string;
  domain_id: string | null;
  status?: string | null;
};

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
  /** The tool asking. Only the delete path may be told about delete_all_matching
   *  — advice to bulk-delete has no business coming back from an update. */
  op: "read" | "update" | "delete" = "update",
): Promise<InitiativeRow> {
  const matches = await resolveInitiativesList(userId, args);
  if (matches.length === 0) throw new Error("Initiative not found");
  if (matches.length === 1) return matches[0];
  throw ambiguous(
    "initiative",
    args.initiative_name ?? "",
    await describeInitiatives(userId, matches),
    op === "delete"
      ? "Ask which one, then call delete_initiative with its initiative_id — or initiative_ids / delete_all_matching once the user has confirmed they mean all of them."
      : "Show the user these options and let them pick, then call again with that initiative_id. Do not act on more than one unless the user names each.",
  );
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
): Promise<InitiativeRow[]> {
  if (args.initiative_ids?.length) {
    const { data, error } = await admin
      .from("initiatives")
      .select("id, name, domain_id, status")
      .eq("user_id", userId)
      .in("id", args.initiative_ids);
    if (error || !data?.length) throw new Error("Initiatives not found");
    return data;
  }
  if (args.initiative_id) {
    const { data, error } = await admin
      .from("initiatives")
      .select("id, name, domain_id, status")
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
      .select("id, name, domain_id, status")
      .eq("user_id", userId)
      .ilike("name", `%${args.initiative_name.trim()}%`);
    if (domainId) q = q.eq("domain_id", domainId);
    const { data } = await q.limit(20);
    if (!data?.length) throw new Error(`No initiative matching "${args.initiative_name}"`);
    return preferExact(data, args.initiative_name);
  }
  throw new Error("Provide initiative_id, initiative_ids, or initiative_name");
}

async function resolveProject(
  userId: string,
  args: ProjectLookup,
  op: "read" | "update" | "delete" = "update",
): Promise<ProjectRow> {
  const matches = await resolveProjectsList(userId, args);
  if (matches.length === 0) throw new Error("Project not found");
  if (matches.length === 1) return matches[0];
  throw ambiguous(
    "project",
    args.project_name ?? "",
    await describeProjects(userId, matches),
    op === "delete"
      ? "Ask which one, then call delete_project with its project_id — or project_ids / delete_all_matching once the user has confirmed they mean all of them."
      : "Show the user these options — the initiative each one sits under is usually what tells them apart — and call again with that project_id, or with in_initiative_name. Do not act on more than one unless the user names each.",
  );
}

interface ProjectLookup {
  project_id?: string;
  project_ids?: string[];
  project_name?: string;
  domain_id?: string;
  domain_name?: string;
  /** Narrow the lookup to projects under this initiative. Deliberately NOT
   *  `initiative_name`, which on update_project is the field that RE-PARENTS a
   *  project — one name for both would make "the one under X" quietly move it
   *  to X. */
  in_initiative_id?: string;
  in_initiative_name?: string;
}

async function resolveProjectsList(userId: string, args: ProjectLookup): Promise<ProjectRow[]> {
  if (args.project_ids?.length) {
    const { data, error } = await admin
      .from("projects")
      .select("id, name, domain_id, initiative_id, status")
      .eq("user_id", userId)
      .in("id", args.project_ids);
    if (error || !data?.length) throw new Error("Projects not found");
    return data;
  }
  if (args.project_id) {
    const { data, error } = await admin
      .from("projects")
      .select("id, name, domain_id, initiative_id, status")
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
    // The user's own disambiguator, made spendable: "the support project tied
    // to Get Dayspring into the Public" narrows before the count is taken,
    // rather than being an answer with nowhere to go.
    let initiativeId = args.in_initiative_id;
    if (!initiativeId && args.in_initiative_name) {
      initiativeId = (await resolveInitiative(userId, { initiative_name: args.in_initiative_name }, "read")).id;
    }
    let q = admin
      .from("projects")
      .select("id, name, domain_id, initiative_id, status")
      .eq("user_id", userId)
      .ilike("name", `%${args.project_name.trim()}%`);
    if (domainId) q = q.eq("domain_id", domainId);
    if (initiativeId) q = q.eq("initiative_id", initiativeId);
    const { data } = await q.limit(20);
    if (!data?.length) throw new Error(`No project matching "${args.project_name}"`);
    return preferExact(data, args.project_name);
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
      if (!args.allow_duplicate) {
        const twin = await existingByName("initiatives", userId, title, { domain_id: domainId });
        if (twin) {
          return {
            result: JSON.stringify({ ...twin, existing: true }),
            action: { tool: name, summary: `Initiative "${twin.name}" already exists — used that one` },
          };
        }
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
          status: (args.status as string) ?? "in_progress",
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
        targets = [await resolveInitiative(userId, listArgs, "delete")];
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
        const init = await resolveInitiative(userId, { initiative_name: args.initiative_name as string }, "read");
        initiativeId = init.id;
        if (!domainId && init.domain_id) domainId = init.domain_id;
      }
      if (!domainId) throw new Error("domain_id or domain_name is required");
      // No unique constraint stands behind this table, so a blind insert is how
      // one project silently becomes two — and two identically-named projects
      // are what made every later "update the Dayspring support project"
      // unanswerable. Hand back the one that exists; the model can update it.
      if (!args.allow_duplicate) {
        const twin = await existingByName("projects", userId, title, { domain_id: domainId });
        if (twin) {
          return {
            result: JSON.stringify({ ...twin, existing: true }),
            action: { tool: name, summary: `Project "${twin.name}" already exists — used that one` },
          };
        }
      }
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
      const proj = await resolveProject(userId, args as ProjectLookup, "update");
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
      if (args.initiative_name) patch.initiative_id = (await resolveInitiative(userId, { initiative_name: args.initiative_name as string }, "read")).id;
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
        targets = [await resolveProject(userId, listArgs, "delete")];
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
