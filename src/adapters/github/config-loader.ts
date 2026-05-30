// =============================================================================
// src/adapters/github/config-loader.ts - Bootstrap + config loading
//
// Single responsibility: read the config file (from any location), resolve
// credentials, fetch live GitHub field metadata, and return a RuntimeConfig.
//
// The only environment variable the server requires is whatever the config
// file references via $VAR notation in backends.*.auth.*. Everything else
// (owner, project number, repo, field names) comes from the config file itself.
// =============================================================================

import { parse } from "@std/yaml";
import { dirname, resolve } from "@std/path";
import type { GitHubBackendConfig } from "./types.ts";
import type { ScrumConfig } from "../../domain/config.ts";
import type { IterationEntry } from "../../domain/types.ts";
import {
  GET_ORG_PROJECT_FIELDS_BOOTSTRAP_QUERY,
  GET_USER_PROJECT_FIELDS_BOOTSTRAP_QUERY,
} from "./queries.ts";
import type { ContentLocation } from "../../domain/content-location.ts";
import { describeContentLocation } from "../../domain/content-location.ts";
import { fetchContent } from "../../scrum/fetch-location.ts";
import { resolveLocation } from "../../scrum/resolve-location.ts";

// ── Runtime types ─────────────────────────────────────────────────────────────

/** Runtime configuration: parsed config overlaid with live GitHub field metadata. */
export interface RuntimeConfig {
  scrumConfig: ScrumConfig;
  projectId: string;
  fields: {
    sprintFieldId: string;
    statusFieldId: string;
    storyPointsFieldId: string | null;
    priorityFieldId: string | null;
    epicFieldId: string | null;
    assigneeFieldId: string | null;
    typeFieldId: string | null;
  };
  /**
   * Maps canonical status key → GitHub single-select option ID.
   * Built by joining scrum.status keys → github.status_display values → live option IDs.
   * The use-case layer and adapter use this for all status reads and writes.
   */
  statusOptions: Record<string, string>;
  /**
   * Maps canonical priority key → GitHub single-select option ID.
   * Built by joining scrum.priority keys → github.priority_display values → live option IDs.
   */
  priorityOptions: Record<string, string>;
  typeOptions: Record<string, string>;
  /**
   * Maps canonical type keys → resolved template locations.
   * Only keys where type_mapping[key].template is declared are present.
   * Empty when no templates are configured.
   */
  typeTemplatePaths: Record<string, ContentLocation>;
  iterations: {
    active: IterationEntry | null;
    next: IterationEntry | null;
    completed: IterationEntry[];
    all: IterationEntry[];
  };
}

/** Minimal GitHub client interface used during config loading. */
interface GitHubClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

/** Config loader parameters. Only the GitHub client is required. */
interface ConfigParams {
  github: GitHubClient;
  /** Where to load the config from. Defaults to { kind: "file", path: ".github/scrum/config.yml" }. */
  configLocation?: ContentLocation;
}

// ── Env-var resolution ────────────────────────────────────────────────────────

/**
 * If `value` starts with "$", treat the remainder as an environment variable
 * name and return its value. Throws with a clear message if the variable is
 * unset. Literal values (no "$" prefix) are returned as-is.
 */
const resolveEnvRef = (value: string, context: string): string => {
  if (!value.startsWith("$")) return value;
  const varName = value.slice(1);
  const resolved = Deno.env.get(varName);
  if (!resolved) {
    throw new Error(
      `Config error: ${context} references $${varName} but that environment variable is not set.`,
    );
  }
  return resolved;
};

// ── Helper types ──────────────────────────────────────────────────────────────

import type { SelectFieldNode } from "./types.ts";

/** Query projection of GH.ProjectV2SingleSelectField - all mandatory fields. */
interface SingleSelectFieldNode extends SelectFieldNode {}

interface IterationFieldNode {
  id: string;
  name: string;
  dataType: string;
  configuration: {
    iterations: IterationEntry[];
    completedIterations: IterationEntry[];
  };
}

interface BaseFieldNode {
  id: string;
  name: string;
  dataType: string;
}

type FieldNode = BaseFieldNode | SingleSelectFieldNode | IterationFieldNode;

interface ProjectFieldsResponse {
  user?: { projectV2?: { id: string; fields: { nodes: FieldNode[] } } | null } | null;
  organization?: { projectV2?: { id: string; fields: { nodes: FieldNode[] } } | null } | null;
}

// ── Type guards ───────────────────────────────────────────────────────────────

const isSingleSelectField = (node: FieldNode): node is SingleSelectFieldNode =>
  "options" in node && Array.isArray((node as SingleSelectFieldNode).options);

const isIterationField = (node: FieldNode): node is IterationFieldNode => "configuration" in node;

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate that every canonical key in `canonicalKeys` has a corresponding
 * entry in `displayMap`. Fail fast at startup rather than silently dropping
 * translations at runtime.
 */
const validateDisplayMap = (
  canonicalKeys: string[],
  displayMap: Record<string, string>,
  fieldLabel: string,
  backendName: string,
  configDesc: string,
): void => {
  const missing = canonicalKeys.filter((k) => !(k in displayMap));
  if (missing.length > 0) {
    throw new Error(
      `Config error in ${configDesc}: backends.${backendName}.${fieldLabel}_display is missing ` +
        `entries for canonical ${fieldLabel} keys: ${missing.join(", ")}. ` +
        `Add a display name for each key or remove the key from scrum.${fieldLabel}.`,
    );
  }
};

/**
 * Validate that every team `ref` in a backend's team list resolves to a known
 * project team member name.
 */
const validateTeamRefs = (
  backendTeam: Array<{ ref: string }> | undefined,
  projectTeamNames: Set<string>,
  backendName: string,
  configDesc: string,
): void => {
  if (!backendTeam) return;
  const unresolved = backendTeam.filter((m) => !projectTeamNames.has(m.ref));
  if (unresolved.length > 0) {
    throw new Error(
      `Config error in ${configDesc}: backends.${backendName}.team has refs that do not ` +
        `match any project.team[].name: ${unresolved.map((m) => `"${m.ref}"`).join(", ")}.`,
    );
  }
};

// ── Field resolution helpers ──────────────────────────────────────────────────

/** Resolved field IDs extracted from live project field nodes. */
interface ResolvedFieldIds {
  sprintFieldId: string;
  statusFieldId: string;
  storyPointsFieldId: string | null;
  priorityFieldId: string | null;
  epicFieldId: string | null;
  assigneeFieldId: string | null;
  typeFieldId: string | null;
}

/**
 * Walk `fieldNodes` and match each configured field name to its live GitHub node ID.
 * Throws if the required sprint or status fields are not found.
 */
const resolveFieldIds = (
  fieldNodes: FieldNode[],
  mapping: GitHubBackendConfig["field_mapping"],
  projectNumber: number,
  configDesc: string,
): ResolvedFieldIds => {
  let sprintFieldId = "";
  let statusFieldId = "";
  let storyPointsFieldId: string | null = null;
  let priorityFieldId: string | null = null;
  let epicFieldId: string | null = null;
  let assigneeFieldId: string | null = null;
  let typeFieldId: string | null = null;

  for (const node of fieldNodes) {
    if (node.name === mapping.sprint) sprintFieldId = node.id;
    if (node.name === mapping.status) statusFieldId = node.id;
    if (mapping.story_points && node.name === mapping.story_points) storyPointsFieldId = node.id;
    if (mapping.priority && node.name === mapping.priority) priorityFieldId = node.id;
    if (mapping.epic && node.name === mapping.epic) epicFieldId = node.id;
    if (mapping.assignee && node.name === mapping.assignee) assigneeFieldId = node.id;
    if (mapping.item_type && node.name === mapping.item_type) typeFieldId = node.id;
  }

  if (!sprintFieldId) {
    throw new Error(
      `Sprint field '${mapping.sprint}' not found in project #${projectNumber}. ` +
        `Update backends.github.field_mapping.sprint in ${configDesc} to match the project field name.`,
    );
  }
  if (!statusFieldId) {
    throw new Error(
      `Status field '${mapping.status}' not found in project #${projectNumber}. ` +
        `Update backends.github.field_mapping.status in ${configDesc} to match the project field name.`,
    );
  }

  // item_type is required - the Type board field is how every story indicates its type.
  if (!typeFieldId) {
    throw new Error(
      `Type field '${
        mapping.item_type ?? "(not configured)"
      }' not found in project #${projectNumber}. ` +
        `Update backends.github.field_mapping.item_type in ${configDesc} to match ` +
        `the exact SINGLE_SELECT field name in GitHub Projects, or add the field to the project.`,
    );
  }

  return {
    sprintFieldId,
    statusFieldId,
    storyPointsFieldId,
    priorityFieldId,
    epicFieldId,
    assigneeFieldId,
    typeFieldId,
  };
};

/** Resolved option ID maps built from live single-select field nodes. */
interface ResolvedOptionMaps {
  statusOptions: Record<string, string>;
  priorityOptions: Record<string, string>;
  typeOptions: Record<string, string>;
}

/**
 * Walk `fieldNodes` and build display-name → option-ID maps for status, priority,
 * and type fields. Keys are display names (not canonical keys) matching *_display config.
 */
const buildOptionMaps = (
  fieldNodes: FieldNode[],
  ghConfig: GitHubBackendConfig,
): ResolvedOptionMaps => {
  const statusOptions: Record<string, string> = {};
  const priorityOptions: Record<string, string> = {};
  const typeOptions: Record<string, string> = {};
  const { field_mapping, status_display, priority_display, type_mapping } = ghConfig;

  for (const node of fieldNodes) {
    if (!isSingleSelectField(node)) continue;
    const displayToId = new Map(node.options.map((o) => [o.name, o.id]));

    if (node.name === field_mapping.status) {
      for (const displayName of Object.values(status_display)) {
        const id = displayToId.get(displayName);
        if (id) statusOptions[displayName] = id;
      }
    }
    if (field_mapping.priority && node.name === field_mapping.priority) {
      for (const displayName of Object.values(priority_display)) {
        const id = displayToId.get(displayName);
        if (id) priorityOptions[displayName] = id;
      }
    }
    if (field_mapping.item_type && type_mapping && node.name === field_mapping.item_type) {
      for (const [canonicalKey, entry] of Object.entries(type_mapping)) {
        const id = displayToId.get(entry.display);
        if (id) typeOptions[canonicalKey] = id;
      }
    }
  }

  return { statusOptions, priorityOptions, typeOptions };
};

// ── Iteration classification ──────────────────────────────────────────────────

/** Classify iterations into active, next, completed, and all categories. */
const classifyIterations = (
  activeIterations: IterationEntry[],
  completedIterations: IterationEntry[],
): RuntimeConfig["iterations"] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let active: IterationEntry | null = null;
  for (const iter of activeIterations) {
    const start = new Date(iter.startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + iter.duration);
    if (today >= start && today < end) {
      active = iter;
      break;
    }
  }

  // Find the first iteration that starts after the active sprint ends (or after today
  // if no sprint is active). Sort once and find the first match past the cutoff.
  const cutoff: Date = (() => {
    if (active) {
      const d = new Date(active.startDate);
      d.setDate(d.getDate() + active.duration);
      return d;
    }
    return today;
  })();
  const allSorted = [...activeIterations].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );
  const next = allSorted.find((iter) => {
    const s = new Date(iter.startDate);
    s.setHours(0, 0, 0, 0);
    return s >= cutoff;
  }) ?? null;

  // Deduplicate across active and completed by ID in case GitHub returns overlaps,
  // then sort chronologically for stable ordering.
  const allMap = new Map<string, IterationEntry>();
  for (const iter of activeIterations) allMap.set(iter.id, iter);
  for (const iter of completedIterations) allMap.set(iter.id, iter);
  const all = [...allMap.values()].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );

  return { active, next, completed: [...completedIterations], all };
};

// ── Main function ─────────────────────────────────────────────────────────────

export const loadConfig = async (params: ConfigParams): Promise<RuntimeConfig> => {
  const { github } = params;

  const configLocation: ContentLocation = params.configLocation ?? {
    kind: "file",
    path: resolve(Deno.cwd(), ".github/scrum/config.yml"),
  };
  const configDesc = describeContentLocation(configLocation);

  // Fetch and parse the config file from wherever its location points.
  let rawYml: string;
  try {
    rawYml = await fetchContent(configLocation);
  } catch (err) {
    throw new Error(
      `Cannot read config at '${configDesc}': ${
        err instanceof Error ? err.message : String(err)
      }. ` +
        `Ensure the server is started from the project root, or pass --config <path>.`,
    );
  }

  let parsedConfig: ScrumConfig;
  try {
    parsedConfig = parse(rawYml) as ScrumConfig;
  } catch (err) {
    throw new Error(
      `Failed to parse ${configDesc}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Validate required top-level sections.
  if (!parsedConfig.project) {
    throw new Error(`${configDesc} is missing required 'project' section.`);
  }
  if (!parsedConfig.scrum) throw new Error(`${configDesc} is missing required 'scrum' section.`);
  if (!parsedConfig.backends) {
    throw new Error(`${configDesc} is missing required 'backends' section.`);
  }
  if (!parsedConfig.backends.github) {
    throw new Error(
      `${configDesc} is missing 'backends.github'. ` +
        `Only the GitHub backend is supported in this version.`,
    );
  }

  // Compute baseDir: the directory portion of the config location.
  // For inline configs, fall back to the process working directory.
  const baseDir: string = (() => {
    switch (configLocation.kind) {
      case "file":
        return dirname(configLocation.path);
      case "url":
        return dirname(configLocation.url.pathname);
      case "inline":
        return Deno.cwd();
    }
  })();

  const ghConfig = parsedConfig.backends.github as GitHubBackendConfig;

  // Resolve $ENV_VAR references in auth and patch the config object.
  // We do NOT mutate the original parsed object - create a patched copy for internal use.
  const resolvedToken = resolveEnvRef(ghConfig.auth.token, "backends.github.auth.token");
  const patchedGhConfig: GitHubBackendConfig = {
    ...ghConfig,
    auth: { ...ghConfig.auth, token: resolvedToken },
  };

  // Compute projectRoot: resolve projRoot relative to baseDir, or use baseDir itself.
  const projectRoot = parsedConfig.project.projRoot
    ? resolve(baseDir, parsedConfig.project.projRoot)
    : baseDir;

  // Validate config cross-references.
  const canonicalStatusKeys = Object.keys(parsedConfig.scrum.status);
  const canonicalPriorityKeys = parsedConfig.scrum.priority.map((p) => p.key);
  const projectTeamNames = new Set(parsedConfig.project.team?.map((m) => m.name) ?? []);

  validateDisplayMap(
    canonicalStatusKeys,
    patchedGhConfig.status_display,
    "status",
    "github",
    configDesc,
  );
  validateDisplayMap(
    canonicalPriorityKeys,
    patchedGhConfig.priority_display,
    "priority",
    "github",
    configDesc,
  );
  validateTeamRefs(patchedGhConfig.team, projectTeamNames, "github", configDesc);

  // Validate type_mapping - required when field_mapping.item_type is declared.
  if (
    patchedGhConfig.field_mapping.item_type &&
    (!patchedGhConfig.type_mapping || Object.keys(patchedGhConfig.type_mapping).length === 0)
  ) {
    throw new Error(
      `${configDesc}: backends.github.type_mapping is missing or empty, but field_mapping.item_type is set. ` +
        `type_mapping declares each canonical type key alongside its board display name and optional template path. Example:\n` +
        `  type_mapping:\n` +
        `    bug:\n` +
        `      display: "Bug"\n` +
        `    feature:\n` +
        `      display: "Feature"\n` +
        `      template: .github/ISSUE_TEMPLATE/feature.md`,
    );
  }

  // Fetch live GitHub project fields.
  const { owner, owner_type: ownerType, project_number: projectNumber } = patchedGhConfig;

  const bootstrapQuery = ownerType === "user"
    ? GET_USER_PROJECT_FIELDS_BOOTSTRAP_QUERY
    : GET_ORG_PROJECT_FIELDS_BOOTSTRAP_QUERY;

  const fieldsResult = await github.graphql<ProjectFieldsResponse>(bootstrapQuery, {
    login: owner,
    number: projectNumber,
  });

  const projectNode = ownerType === "user"
    ? fieldsResult.user?.projectV2
    : fieldsResult.organization?.projectV2;

  if (!projectNode) {
    throw new Error(
      `Project #${projectNumber} not found for ${ownerType} '${owner}'. ` +
        `Ensure the token has Projects: Read access.`,
    );
  }

  const fieldNodes = projectNode.fields.nodes;
  if (fieldNodes.length === 0) {
    throw new Error(
      `No fields found in project #${projectNumber}. ` +
        `Ensure the project has at least the required fields (Sprint, Status).`,
    );
  }

  // Resolve field IDs, option maps, and iterations from live field metadata.
  const fields = resolveFieldIds(
    fieldNodes,
    patchedGhConfig.field_mapping,
    projectNumber,
    configDesc,
  );
  const { statusOptions, priorityOptions, typeOptions } = buildOptionMaps(
    fieldNodes,
    patchedGhConfig,
  );

  // Validate each type_mapping entry's display name against live board options.
  // A declared key absent from typeOptions means its display name wasn't found on the board.
  if (patchedGhConfig.field_mapping.item_type && patchedGhConfig.type_mapping) {
    const mismatched = Object.entries(patchedGhConfig.type_mapping)
      .filter(([canonicalKey]) => !typeOptions[canonicalKey])
      .map(([canonicalKey, entry]) =>
        `  - type_mapping.${canonicalKey}: display "${entry.display}" not found in ` +
        `"${patchedGhConfig.field_mapping.item_type}" field options`
      );
    if (mismatched.length > 0) {
      throw new Error(
        `${configDesc}: type_mapping declares types whose display names are not present on the board:\n` +
          mismatched.join("\n") + "\n" +
          `For each entry above, either add the option to the ` +
          `"${patchedGhConfig.field_mapping.item_type}" single-select field on your project board, ` +
          `or remove the key from type_mapping.`,
      );
    }
  }

  // Resolve template paths into ContentLocation values anchored to projectRoot.
  const typeTemplatePaths: Record<string, ContentLocation> = {};
  if (patchedGhConfig.type_mapping) {
    for (const [key, entry] of Object.entries(patchedGhConfig.type_mapping)) {
      if (entry.template) {
        typeTemplatePaths[key] = resolveLocation(entry.template, projectRoot);
      }
    }
  }

  let activeIterations: IterationEntry[] = [];
  let completedIterations: IterationEntry[] = [];
  for (const node of fieldNodes) {
    if (isIterationField(node) && node.name === patchedGhConfig.field_mapping.sprint) {
      activeIterations = node.configuration.iterations.map((i) => ({ ...i }));
      completedIterations = node.configuration.completedIterations.map((i) => ({ ...i }));
    }
  }

  const iterations = classifyIterations(activeIterations, completedIterations);

  // Expose the patched config (with resolved token) internally. The token is
  // accessible to the backend adapter but never serialised into tool responses.
  const patchedConfig: ScrumConfig = {
    ...parsedConfig,
    backends: { ...parsedConfig.backends, github: patchedGhConfig },
  };

  return {
    scrumConfig: patchedConfig,
    projectId: projectNode.id,
    fields,
    statusOptions,
    priorityOptions,
    typeOptions,
    typeTemplatePaths,
    iterations,
  };
};
