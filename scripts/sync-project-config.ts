// =============================================================================
// scripts/sync-project-config.ts
// Reads the human-defined scrum.config.yml and syncs GitHub Projects v2 field
// metadata into project-board.config.json.
//
// SOURCE OF TRUTH:
//   scrum.config.yml        — human-authored project spec (never overwritten)
//   project-board.config.json — GitHub board state (overwritten on every sync)
//
// Usage:
//   GITHUB_TOKEN=ghp_xxx deno run --allow-read --allow-write --allow-net scripts/sync-project-config.ts
//   GITHUB_TOKEN=ghp_xxx deno run --allow-read --allow-write --allow-net scripts/sync-project-config.ts --dry-run
//   GITHUB_TOKEN=ghp_xxx deno task sync-config
//   GITHUB_TOKEN=ghp_xxx deno task sync-config:dry
// =============================================================================

import { parseArgs } from "@std/cli/parse-args";
import { parse as parseYaml } from "@std/yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of scrum.config.yml (human-defined sections only) */
interface ScrumConfigYml {
  project: {
    owner: string;
    /** "user" for personal accounts, "org" for organisations */
    owner_type: "user" | "org";
    project_number: number;
  };
  field_names: {
    sprint: string;
    status: string;
    story_points: string;
    priority: string;
    epic: string;
    item_type: string;
    assignee: string;
    [key: string]: string;
  };
  sprint?: {
    duration_days: number | null;
    velocity_window?: number;
    carry_over_threshold_days?: number;
    report_submit_time?: string;
    report_recipient?: string | null;
  };
  story_points?: {
    method?: string;
    scale?: number[];
    max_points_per_item?: number;
  };
  [key: string]: unknown;
}

/** Shape written to project-board.config.json */
interface BoardConfig {
  _comment?: string;
  _last_synced: string | null;
  project: { id: string | null; title: string | null; url: string | null };
  status_values: Record<string, unknown>;
  priority: Record<string, unknown>;
  item_types: Record<string, unknown>;
  sprint: {
    _field_id: string | null;
    active_sprint: SprintIteration | null;
    all_iterations: SprintIteration[];
  };
  story_points: { _field_id: string | null };
  _fields_registry: Record<
    string,
    { id: string; dataType: string; __typename: string }
  >;
  _epic_field: Record<string, unknown> | null;
  _assignee_field: { _field_id: string; dataType: string } | null;
}

interface SprintIteration {
  id: string;
  title: string;
  startDate: string;
  duration: number;
  completed?: boolean;
}

// Minimal GraphQL response shapes
interface GhFieldBase {
  __typename: string;
  id: string;
  name: string;
  dataType: string;
  _comment?: string;
}

interface GhSingleSelectOption {
  id: string;
  name: string;
  color: string;
  description: string;
}

interface GhSingleSelectField extends GhFieldBase {
  __typename: "ProjectV2SingleSelectField";
  options: GhSingleSelectOption[];
}

interface GhIterationConfig {
  startDay: number;
  duration: number;
  iterations: Array<{
    id: string;
    title: string;
    startDate: string;
    duration: number;
  }>;
  completedIterations: Array<{
    id: string;
    title: string;
    startDate: string;
    duration: number;
  }>;
}

interface GhIterationField extends GhFieldBase {
  __typename: "ProjectV2IterationField";
  configuration: GhIterationConfig;
}

type GhField = GhFieldBase | GhSingleSelectField | GhIterationField;

interface GhProjectResponse {
  data: {
    user?: {
      projectV2: {
        id: string;
        title: string;
        url: string;
        fields: { nodes: GhField[] };
      };
    };
    organization?: {
      projectV2: {
        id: string;
        title: string;
        url: string;
        fields: { nodes: GhField[] };
      };
    };
  };
  errors?: Array<{ message: string }>;
}

// ---------------------------------------------------------------------------
// GraphQL query
// ---------------------------------------------------------------------------

function buildQuery(
  ownerType: "user" | "org",
  owner: string,
  projectNumber: number,
): string {
  // Both user and organisation expose projectV2 under the same field name;
  // owner_type "org" maps to the "organization" root field.
  const ownerField = ownerType === "user" ? "user" : "organization";
  return `
    query GetProjectFields {
      ${ownerField}(login: "${owner}") {
        projectV2(number: ${projectNumber}) {
          id
          title
          url
          fields(first: 50) {
            nodes {
              __typename
              ... on ProjectV2Field {
                id
                name
                dataType
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                dataType
                options {
                  id
                  name
                  color
                  description
                }
              }
              ... on ProjectV2IterationField {
                id
                name
                dataType
                configuration {
                  startDay
                  duration
                  iterations {
                    id
                    title
                    startDate
                    duration
                  }
                  completedIterations {
                    id
                    title
                    startDate
                    duration
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
}

// ---------------------------------------------------------------------------
// GitHub GraphQL client
// ---------------------------------------------------------------------------

async function fetchProjectFields(
  token: string,
  owner: string,
  ownerType: "user" | "org",
  projectNumber: number,
): Promise<{
  id: string;
  title: string;
  url: string;
  fields: { nodes: GhField[] };
}> {
  const query = buildQuery(ownerType, owner, projectNumber);

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "scrum-config-sync/1.0",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API HTTP error: ${res.status} ${res.statusText}`);
  }

  const json: GhProjectResponse = await res.json();

  if (json.errors?.length) {
    throw new Error(
      `GraphQL errors:\n${json.errors.map((e) => `  - ${e.message}`).join("\n")}`,
    );
  }

  const ownerData =
    ownerType === "user" ? json.data.user : json.data.organization;
  if (!ownerData?.projectV2) {
    throw new Error(
      `Project #${projectNumber} not found for ${ownerType} "${owner}".`,
    );
  }

  return ownerData.projectV2;
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function findField(fields: GhField[], mappedName: string): GhField | undefined {
  return fields.find((f) => f.name === mappedName);
}

function isSingleSelect(f: GhField): f is GhSingleSelectField {
  return f.__typename === "ProjectV2SingleSelectField";
}

function isIteration(f: GhField): f is GhIterationField {
  return f.__typename === "ProjectV2IterationField";
}

function extractOptions(
  field: GhSingleSelectField,
): Array<{ id: string; name: string; color: string; description: string }> {
  return field.options.map(({ id, name, color, description }) => ({ id, name, color, description }));
}

/**
 * Warn when a field_names entry does not match any field returned by GitHub.
 * This catches typos and stale config early.
 */
function warnMissingFields(
  fieldNames: Record<string, string>,
  fields: GhField[],
): void {
  const knownNames = new Set(fields.map((f) => f.name));
  for (const [key, name] of Object.entries(fieldNames)) {
    if (key === "_comment") continue;
    if (!knownNames.has(name)) {
      console.warn(
        `⚠️  field_names.${key}: no field named "${name}" found on the board. ` +
          `Check spelling and case in scrum.config.yml.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Board config builder
// ---------------------------------------------------------------------------

function buildBoardConfig(
  humanConfig: ScrumConfigYml,
  projectMeta: { id: string; title: string; url: string },
  fields: GhField[],
): BoardConfig {
  const fn = humanConfig.field_names;

  // Warn about any field_names entries that don't resolve to a real board field
  warnMissingFields(fn, fields);

  // ── field registry ─────────────────────────────────────────────────────────
  const fieldsRegistry: BoardConfig["_fields_registry"] = {};
  for (const f of fields) {
    fieldsRegistry[f.name] = {
      id: f.id,
      dataType: f.dataType,
      __typename: f.__typename,
    };
  }

  // ── status_values ──────────────────────────────────────────────────────────
  let statusValues: Record<string, unknown> = {};
  const statusField = findField(fields, fn.status);
  if (statusField && isSingleSelect(statusField)) {
    const options = extractOptions(statusField);
    const named: Record<string, string> = {};
    for (const opt of options) {
      const key = opt.name
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      named[key] = opt.name;
    }
    statusValues = {
      _comment: `Auto-synced from GitHub field "${fn.status}". Do not edit manually.`,
      _field_id: statusField.id,
      ...named,
      _options: options,
    };
  }

  // ── priority ───────────────────────────────────────────────────────────────
  let priority: Record<string, unknown> = {};
  const priorityField = findField(fields, fn.priority);
  if (priorityField && isSingleSelect(priorityField)) {
    const options = extractOptions(priorityField);
    priority = {
      _comment: `Auto-synced from GitHub field "${fn.priority}". Do not edit manually.`,
      _field_id: priorityField.id,
      type: "single_select",
      options_ordered: options.map((o) => o.name),
      _options: options,
    };
  }

  // ── item_types ─────────────────────────────────────────────────────────────
  let itemTypes: Record<string, unknown> = {};
  const typeField = findField(fields, fn.item_type);
  if (typeField && isSingleSelect(typeField)) {
    const options = extractOptions(typeField);
    itemTypes = {
      _comment: `Auto-synced from GitHub field "${fn.item_type}". Do not edit manually.`,
      _field_id: typeField.id,
      options: options.map((o) => o.name),
      _options: options,
    };
  }

  // ── sprint ─────────────────────────────────────────────────────────────────
  let sprintBoard: BoardConfig["sprint"] = {
    _field_id: null,
    active_sprint: null,
    all_iterations: [],
  };
  const sprintField = findField(fields, fn.sprint);
  if (sprintField && isIteration(sprintField)) {
    const cfg = sprintField.configuration;
    const allIterations: SprintIteration[] = [
      ...cfg.completedIterations.map((i) => ({ ...i, completed: true })),
      ...cfg.iterations.map((i) => ({ ...i, completed: false })),
    ].sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );

    const active = cfg.iterations[0] ?? null;
    sprintBoard = {
      _field_id: sprintField.id,
      active_sprint: active
        ? {
            id: active.id,
            title: active.title,
            startDate: active.startDate,
            duration: active.duration,
          }
        : null,
      all_iterations: allIterations,
    };
  }

  // ── story_points field ID only ─────────────────────────────────────────────
  // Human-defined values (method, scale, max_points_per_item) live in scrum.config.yml.
  const storyPointsField = findField(fields, fn.story_points);
  const storyPointsBoard: BoardConfig["story_points"] = {
    _comment: `Field ID auto-synced. Scale and method are defined in scrum.config.yml.`,
    _field_id: storyPointsField?.id ?? null,
  } as BoardConfig["story_points"] & { _comment: string };

  // ── epic field ─────────────────────────────────────────────────────────────
  let epicField: BoardConfig["_epic_field"] = null;
  const epicGhField = findField(fields, fn.epic);
  if (epicGhField) {
    if (isSingleSelect(epicGhField)) {
      const options = extractOptions(epicGhField);
      epicField = {
        _comment: `Auto-synced. Epic names are managed in scrum.config.yml under "epics".`,
        _field_id: epicGhField.id,
        type: "single_select",
        options: options.map((o) => o.name),
        _options: options,
      };
    } else {
      epicField = { _field_id: epicGhField.id, type: epicGhField.dataType };
    }
  }

  // ── assignee ───────────────────────────────────────────────────────────────
  let assigneeBoard: BoardConfig["_assignee_field"] = null;
  const assigneeGhField = findField(fields, fn.assignee);
  if (assigneeGhField) {
    assigneeBoard = {
      _field_id: assigneeGhField.id,
      dataType: assigneeGhField.dataType,
    };
  }

  return {
    _comment:
      "Auto-generated by scripts/sync-project-config.ts. Do not edit manually. Run `deno task sync-config` to refresh.",
    _last_synced: new Date().toISOString(),
    project: {
      id: projectMeta.id,
      title: projectMeta.title,
      url: projectMeta.url,
    },
    status_values: statusValues,
    priority,
    item_types: itemTypes,
    sprint: sprintBoard,
    story_points: storyPointsBoard,
    _fields_registry: fieldsRegistry,
    _epic_field: epicField,
    _assignee_field: assigneeBoard,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["dry-run"],
    string: ["config", "board-config"],
  });
  const isDryRun = args["dry-run"] as boolean;
  const humanConfigPath =
    (args["config"] as string | undefined) ?? "./scrum.config.yml";
  const boardConfigPath =
    (args["board-config"] as string | undefined) ??
    "./project-board.config.json";

  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) {
    console.error("❌  GITHUB_TOKEN environment variable is not set.");
    Deno.exit(1);
  }

  console.log(`📂  Reading human config from: ${humanConfigPath}`);
  const rawYaml = await Deno.readTextFile(humanConfigPath);
  const humanConfig = parseYaml(rawYaml) as ScrumConfigYml;

  const { owner, owner_type, project_number } = humanConfig.project;
  console.log(
    `🔍  Fetching fields for ${owner_type} "${owner}" project #${project_number}…`,
  );

  const projectMeta = await fetchProjectFields(
    token,
    owner,
    owner_type,
    project_number,
  );
  const fields = projectMeta.fields.nodes;

  console.log(
    `✅  Found ${fields.length} fields in project "${projectMeta.title}"`,
  );
  console.log(
    `    Fields: ${fields.map((f) => `${f.name} (${f.__typename})`).join(", ")}`,
  );

  const boardConfig = buildBoardConfig(humanConfig, projectMeta, fields);
  const output = JSON.stringify(boardConfig, null, 2);

  if (isDryRun) {
    console.log("\n🔎  [DRY RUN] Would write the following board config:\n");
    console.log(output);
    console.log(`\n⚠️   No files were written. Target: ${boardConfigPath}`);
  } else {
    await Deno.writeTextFile(boardConfigPath, output);
    console.log(`\n💾  Board config written to: ${boardConfigPath}`);
    console.log(`    Last synced: ${boardConfig._last_synced}`);
  }
}

main().catch((err) => {
  console.error("❌  Sync failed:", err.message);
  Deno.exit(1);
});
