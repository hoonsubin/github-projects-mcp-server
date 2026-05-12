// =============================================================================
// src/adapters/github/config-loader.ts — Bootstrap + config loading
//
// Single responsibility: read the local config file, resolve credentials,
// fetch live GitHub field metadata, and return a RuntimeConfig.
//
// The only environment variable the server requires is whatever the config
// file references via $VAR notation in backends.*.auth.*. Everything else
// (owner, project number, repo, field names) comes from the config file itself.
// =============================================================================

import { parse } from "@std/yaml";
import type { GitHubBackendConfig, IterationEntry } from "./types.ts";
import type { ScrumConfigYml } from "../../domain/config.ts";

// ── Runtime types ────────────────────────────────────────────────────────────

/** Runtime configuration: parsed config overlaid with live GitHub field metadata. */
export interface RuntimeConfig {
  yml: ScrumConfigYml;
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
  /** Path to the config file. Defaults to ".github/scrum/config.yml". */
  configPath?: string;
}

// ── Env-var resolution ───────────────────────────────────────────────────────

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

// ── GraphQL query ────────────────────────────────────────────────────────────

// $isUser / $isOrg are mutually exclusive booleans derived from owner_type.
// Using @include so GitHub only resolves the relevant root field — querying
// both simultaneously causes a hard GraphQL error when the login doesn't
// match one of the account types (e.g. a user login passed to organization()).
const GET_PROJECT_FIELDS_QUERY = `
  query GetProjectFields($login: String!, $number: Int!, $isUser: Boolean!, $isOrg: Boolean!) {
    user(login: $login) @include(if: $isUser) {
      projectV2(number: $number) {
        id
        fields(first: 50) {
          nodes {
            ... on ProjectV2Field { id name dataType }
            ... on ProjectV2SingleSelectField {
              id name dataType
              options { id name color description }
            }
            ... on ProjectV2IterationField {
              id name dataType
              configuration {
                iterations { id title startDate duration }
                completedIterations { id title startDate duration }
              }
            }
          }
        }
      }
    }
    organization(login: $login) @include(if: $isOrg) {
      projectV2(number: $number) {
        id
        fields(first: 50) {
          nodes {
            ... on ProjectV2Field { id name dataType }
            ... on ProjectV2SingleSelectField {
              id name dataType
              options { id name color description }
            }
            ... on ProjectV2IterationField {
              id name dataType
              configuration {
                iterations { id title startDate duration }
                completedIterations { id title startDate duration }
              }
            }
          }
        }
      }
    }
  }
`;

// ── Helper types ─────────────────────────────────────────────────────────────

interface SingleSelectFieldNode {
  id: string;
  name: string;
  dataType: string;
  options: Array<{ id: string; name: string; color: string; description: string }>;
}

interface IterationFieldNode {
  id: string;
  name: string;
  dataType: string;
  configuration: {
    iterations: Array<{ id: string; title: string; startDate: string; duration: number }>;
    completedIterations: Array<{ id: string; title: string; startDate: string; duration: number }>;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

  let next: IterationEntry | null = null;
  if (active) {
    const activeEnd = new Date(active.startDate);
    activeEnd.setDate(activeEnd.getDate() + active.duration);
    const allSorted = [...activeIterations].sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );
    for (const iter of allSorted) {
      const start = new Date(iter.startDate);
      start.setHours(0, 0, 0, 0);
      if (start > activeEnd) {
        next = iter;
        break;
      }
    }
  } else {
    const allSorted = [...activeIterations].sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );
    for (const iter of allSorted) {
      const start = new Date(iter.startDate);
      start.setHours(0, 0, 0, 0);
      if (start > today) {
        next = iter;
        break;
      }
    }
  }

  const completed = completedIterations.map((iter) => ({ ...iter, completed: true }));

  const allMap = new Map<string, IterationEntry>();
  for (const iter of activeIterations) allMap.set(iter.id, iter);
  for (const iter of completedIterations) allMap.set(iter.id, { ...iter });
  const all = [...allMap.values()].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );

  return { active, next, completed, all };
};

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate that every canonical status key declared in scrum.status has a
 * corresponding entry in the backend's status_display. Fail fast at startup
 * rather than silently dropping status translations at runtime.
 */
const validateStatusDisplay = (
  canonicalKeys: string[],
  statusDisplay: Record<string, string>,
  backendName: string,
  configPath: string,
): void => {
  const missing = canonicalKeys.filter((k) => !(k in statusDisplay));
  if (missing.length > 0) {
    throw new Error(
      `Config error in ${configPath}: backends.${backendName}.status_display is missing ` +
        `entries for canonical status keys: ${missing.join(", ")}. ` +
        `Add a display name for each key or remove the key from scrum.status.`,
    );
  }
};

/**
 * Validate that every canonical priority key declared in scrum.priority has a
 * corresponding entry in the backend's priority_display.
 */
const validatePriorityDisplay = (
  canonicalKeys: string[],
  priorityDisplay: Record<string, string>,
  backendName: string,
  configPath: string,
): void => {
  const missing = canonicalKeys.filter((k) => !(k in priorityDisplay));
  if (missing.length > 0) {
    throw new Error(
      `Config error in ${configPath}: backends.${backendName}.priority_display is missing ` +
        `entries for canonical priority keys: ${missing.join(", ")}. ` +
        `Add a display name for each key or remove the key from scrum.priority.`,
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
  configPath: string,
): void => {
  if (!backendTeam) return;
  const unresolved = backendTeam.filter((m) => !projectTeamNames.has(m.ref));
  if (unresolved.length > 0) {
    throw new Error(
      `Config error in ${configPath}: backends.${backendName}.team has refs that do not ` +
        `match any project.team[].name: ${unresolved.map((m) => `"${m.ref}"`).join(", ")}.`,
    );
  }
};

// ── Main function ────────────────────────────────────────────────────────────

export const loadConfig = async (params: ConfigParams): Promise<RuntimeConfig> => {
  const { github, configPath = ".github/scrum/config.yml" } = params;

  // ── Step 1: Read and parse local config file ────────────────────────────────

  let rawYml: string;
  try {
    rawYml = await Deno.readTextFile(configPath);
  } catch (err) {
    throw new Error(
      `Cannot read config file at '${configPath}': ${
        err instanceof Error ? err.message : String(err)
      }. ` +
        `Ensure the server is started from the project root.`,
    );
  }

  let yml: ScrumConfigYml;
  try {
    yml = parse(rawYml) as ScrumConfigYml;
  } catch (err) {
    throw new Error(
      `Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Step 2: Validate required top-level sections ────────────────────────────

  if (!yml.project) throw new Error(`${configPath} is missing required 'project' section.`);
  if (!yml.scrum) throw new Error(`${configPath} is missing required 'scrum' section.`);
  if (!yml.backends) throw new Error(`${configPath} is missing required 'backends' section.`);
  if (!yml.backends.github) {
    throw new Error(
      `${configPath} is missing 'backends.github'. ` +
        `Only the GitHub backend is supported in this version.`,
    );
  }

  const ghConfig = yml.backends.github as GitHubBackendConfig;

  // ── Step 3: Resolve $ENV_VAR references in auth ─────────────────────────────

  const resolvedToken = resolveEnvRef(ghConfig.auth.token, "backends.github.auth.token");

  // Replace the token in the config so downstream code never touches raw env refs.
  // We do NOT mutate the original yml object — create a patched copy for internal use.
  const patchedGhConfig: GitHubBackendConfig = {
    ...ghConfig,
    auth: { ...ghConfig.auth, token: resolvedToken },
  };

  // ── Step 4: Validate config cross-references ────────────────────────────────

  const canonicalStatusKeys = Object.keys(yml.scrum.status);
  const canonicalPriorityKeys = yml.scrum.priority.map((p) => p.key);
  const projectTeamNames = new Set(yml.project.team?.map((m) => m.name) ?? []);

  validateStatusDisplay(canonicalStatusKeys, patchedGhConfig.status_display, "github", configPath);
  validatePriorityDisplay(
    canonicalPriorityKeys,
    patchedGhConfig.priority_display,
    "github",
    configPath,
  );
  validateTeamRefs(patchedGhConfig.team, projectTeamNames, "github", configPath);

  // ── Step 5: Fetch live GitHub project fields ────────────────────────────────

  const { owner, owner_type: ownerType, project_number: projectNumber } = patchedGhConfig;

  const fieldsResult = await github.graphql<ProjectFieldsResponse>(GET_PROJECT_FIELDS_QUERY, {
    login: owner,
    number: projectNumber,
    // todo: `!isUser` === `isOrg`. No need for the redundant check
    isUser: ownerType === "user",
    isOrg: ownerType === "org",
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

  // ── Step 6: Resolve field IDs from field names ──────────────────────────────

  const { field_mapping } = patchedGhConfig;
  const sprintFieldName = field_mapping.sprint;
  const statusFieldName = field_mapping.status;
  const storyPointsFieldName = field_mapping.story_points ?? null;
  const priorityFieldName = field_mapping.priority ?? null;
  const epicFieldName = field_mapping.epic ?? null;
  const assigneeFieldName = field_mapping.assignee ?? null;
  const typeFieldName = field_mapping.item_type ?? null;

  let sprintFieldId = "";
  let statusFieldId = "";
  let storyPointsFieldId: string | null = null;
  let priorityFieldId: string | null = null;
  let epicFieldId: string | null = null;
  let assigneeFieldId: string | null = null;
  let typeFieldId: string | null = null;

  for (const node of fieldNodes) {
    if (node.name === sprintFieldName) sprintFieldId = node.id;
    if (node.name === statusFieldName) statusFieldId = node.id;
    if (storyPointsFieldName && node.name === storyPointsFieldName) {
      storyPointsFieldId = node.id;
    }
    if (priorityFieldName && node.name === priorityFieldName) priorityFieldId = node.id;
    if (epicFieldName && node.name === epicFieldName) epicFieldId = node.id;
    if (assigneeFieldName && node.name === assigneeFieldName) assigneeFieldId = node.id;
    if (typeFieldName && node.name === typeFieldName) typeFieldId = node.id;
  }

  if (!sprintFieldId) {
    throw new Error(
      `Sprint field '${sprintFieldName}' not found in project #${projectNumber}. ` +
        `Update backends.github.field_mapping.sprint in ${configPath} to match the project field name.`,
    );
  }
  if (!statusFieldId) {
    throw new Error(
      `Status field '${statusFieldName}' not found in project #${projectNumber}. ` +
        `Update backends.github.field_mapping.status in ${configPath} to match the project field name.`,
    );
  }

  // ── Step 7: Build canonical → display name maps ────────────────────────────
  //
  // We join in two hops:
  //   canonical key (e.g. "done") → display name (e.g. "Done") via *_display
  // The server resolves the ID-to-name mapping internally; agents should see display names.

  const statusOptions: Record<string, string> = {};
  const priorityOptions: Record<string, string> = {};
  const typeOptions: Record<string, string> = {};

  for (const node of fieldNodes) {
    const ssNode = node as SingleSelectFieldNode;
    if (!ssNode.options) continue;

    if (node.name === statusFieldName) {
      // Build a display-name → option-ID lookup for this field
      const displayToId = new Map(ssNode.options.map((o) => [o.name, o.id]));
      for (const [canonicalKey, displayName] of Object.entries(patchedGhConfig.status_display)) {
        const optionId = displayToId.get(displayName);
        if (optionId) statusOptions[displayName] = optionId; // displayName → optionId
      }
    }

    if (priorityFieldName && node.name === priorityFieldName) {
      const displayToId = new Map(ssNode.options.map((o) => [o.name, o.id]));
      for (const [canonicalKey, displayName] of Object.entries(patchedGhConfig.priority_display)) {
        const optionId = displayToId.get(displayName);
        if (optionId) priorityOptions[displayName] = optionId; // displayName → optionId
      }
    }
  }

  // ── Step 8: Classify iterations ─────────────────────────────────────────────

  let activeIterations: IterationEntry[] = [];
  let completedIterations: IterationEntry[] = [];

  for (const node of fieldNodes) {
    const iterNode = node as IterationFieldNode;
    if (node.name === sprintFieldName && iterNode.configuration) {
      activeIterations = iterNode.configuration.iterations.map((i) => ({ ...i, completed: false }));
      completedIterations = iterNode.configuration.completedIterations.map((i) => ({
        ...i,
        completed: true,
      }));
    }
  }

  const iterations = classifyIterations(activeIterations, completedIterations);

  // ── Step 9: Return RuntimeConfig ─────────────────────────────────────────────
  //
  // Expose the patched config (with resolved token) internally. The token is
  // accessible to the backend adapter but never serialised into tool responses.

  const patchedYml: ScrumConfigYml = {
    ...yml,
    backends: { ...yml.backends, github: patchedGhConfig },
  };

  return {
    yml: patchedYml,
    projectId: projectNode.id,
    fields: {
      sprintFieldId,
      statusFieldId,
      storyPointsFieldId,
      priorityFieldId,
      epicFieldId,
      assigneeFieldId,
      typeFieldId,
    },
    statusOptions,
    priorityOptions,
    typeOptions,
    iterations,
  };
};
