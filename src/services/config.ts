// =============================================================================
// src/services/config.ts
//
// Phase 1, step 3: loadConfig — merges .github/scrum/config.yml with live
// GitHub project field metadata at invocation time.
// =============================================================================

import { parse } from "@std/yaml";
import type { IterationEntry, ScrumConfigYml } from "../types.ts";

// ── Runtime types ────────────────────────────────────────────────────────────

/** Runtime configuration: YAML config overlaid with live GitHub field metadata. */
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
  statusOptions: Record<string, string>; // vocabulary name → GitHub option ID
  priorityOptions: Record<string, string>; // vocabulary name → GitHub option ID
  typeOptions: Record<string, string>; // StoryType value → GitHub option ID
  iterations: {
    active: IterationEntry | null;
    next: IterationEntry | null;
    completed: IterationEntry[];
    all: IterationEntry[];
  };
}

/** Minimal GitHub client interface — the real client is passed in from index.ts. */
interface GitHubClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

/** Config loader parameters — passed explicitly to maintain stateless design. */
export interface ConfigParams {
  github: GitHubClient;
  owner: string;
  ownerType: "user" | "org";
  projectNumber: number;
  repo: string;
}

// todo: [Phase 4] Consider moving RuntimeConfig to src/types.ts for consistency with other domain types ([#19](https://github.com/hoonsubin/github-projects-mcp-server/issues/19))

/** Single-select field node from the GraphQL response. */
interface SingleSelectFieldNode {
  __typename: "ProjectV2SingleSelectField";
  id: string;
  name: string;
  dataType: string;
  options: Array<{ id: string; name: string; color: string; description: string }>;
}

/** Iteration field node from the GraphQL response. */
interface IterationFieldNode {
  __typename: "ProjectV2IterationField";
  id: string;
  name: string;
  dataType: string;
  configuration: {
    iterations: Array<{ id: string; title: string; startDate: string; duration: number }>;
    completedIterations: Array<{ id: string; title: string; startDate: string; duration: number }>;
  };
}

/** Base field node (common to all field types). */
interface BaseFieldNode {
  __typename: string;
  id: string;
  name: string;
  dataType: string;
}

type FieldNode = BaseFieldNode | SingleSelectFieldNode | IterationFieldNode;

/** GraphQL response shape for the project fields query. */
interface ProjectFieldsResponse {
  user?: {
    projectV2: {
      id: string;
      fields: { nodes: FieldNode[] };
    };
  };
  organization?: {
    projectV2: {
      id: string;
      fields: { nodes: FieldNode[] };
    };
  };
}

// ── GraphQL queries ──────────────────────────────────────────────────────────

/** Fetch a file from the repository as a blob. */
const GET_REPO_FILE_QUERY = `
  query GetRepoFile($owner: String!, $repo: String!, $expression: String!) {
    repository(owner: $owner, name: $repo) {
      object(expression: $expression) {
        ... on Blob {
          text
          oid
        }
      }
    }
  }
`;

/** Fetch project field metadata (IDs, names, single-select options, iterations). */
const GET_PROJECT_FIELDS_QUERY = `
  query GetProjectFields($login: String!, $number: Int!) {
    user(login: $login) {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Classify iterations into active, next, completed, and all categories.
 *
 * - active: the iteration where today falls between startDate and startDate + duration days
 * - next: the first iteration (by startDate) that starts after the active one's end date
 * - completed: all from completedIterations[]
 * - all: deduplicated union of active, remaining future, and completed
 */
export const classifyIterations = (
  activeIterations: IterationEntry[],
  completedIterations: IterationEntry[],
): RuntimeConfig["iterations"] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find active iteration(s) — today falls within [startDate, startDate + duration)
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

  // Find next iteration — first one that starts after the active iteration's end date
  let next: IterationEntry | null = null;
  if (active) {
    const activeEnd = new Date(active.startDate);
    activeEnd.setDate(activeEnd.getDate() + active.duration);
    // Consider all iterations (active + future) sorted by startDate
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
    // No active iteration — next is the earliest future iteration
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

  // Build completed list with completed flag
  const completed = completedIterations.map((iter) => ({ ...iter, completed: true }));

  // Build all list — deduplicated union
  const allMap = new Map<string, IterationEntry>();
  for (const iter of activeIterations) {
    allMap.set(iter.id, iter);
  }
  for (const iter of completedIterations) {
    // Cast to include completed flag (used by classifyIterations return type)
    allMap.set(iter.id, { ...iter } as IterationEntry);
  }
  const all = [...allMap.values()].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );

  return { active, next, completed, all };
};

// ── Main function ────────────────────────────────────────────────────────────

/**
 * Load and merge scrum.config.yml with live GitHub project field metadata.
 * Called by every tool handler at invocation time (stateless).
 *
 * Implementation steps:
 *   1. Fetch scrum.config.yml via GetRepoFileSchema handler
 *   2. Parse YAML and validate against ScrumConfigYml
 *   3. Fetch project field metadata via GraphQL
 *   4. Match field names to resolve field IDs
 *   5. Build statusOptions, priorityOptions, typeOptions maps
 *   6. Classify iterations (active, next, completed, all)
 *   7. Return RuntimeConfig
 *
 * @param params - Configuration parameters (stateless, no env-var coupling)
 */
export const loadConfig = async (params: ConfigParams): Promise<RuntimeConfig> => {
  const { github, owner, ownerType, projectNumber, repo } = params;

  // Step 1: Fetch scrum.config.yml from the repository
  const ref = Deno.env.get("GITHUB_REF") ?? "HEAD";
  const filePath = ".github/scrum/config.yml";
  const expression = `${ref}:${filePath}`;

  const fileResult = await github.graphql<{
    repository?: {
      object?: { text: string; oid: string } | null;
    } | null;
  }>(GET_REPO_FILE_QUERY, { owner, repo, expression });

  const blob = fileResult.repository?.object;
  if (!blob || blob.text === null || blob.text === undefined) {
    throw new Error(
      `File '${filePath}' not found at ref '${ref}' in repository '${owner}/${repo}'. ` +
        "Ensure the file exists and the token has Contents: Read access.",
    );
  }

  // Step 2: Parse YAML
  let yml: ScrumConfigYml;
  try {
    yml = parse(blob.text) as ScrumConfigYml;
  } catch (err) {
    throw new Error(
      `Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!yml.project) {
    throw new Error(`${filePath} is missing required 'project' section.`);
  }

  // Step 3: Fetch project field metadata
  const login = yml.project.owner;
  const fieldsResult = await github.graphql<ProjectFieldsResponse>(GET_PROJECT_FIELDS_QUERY, {
    login,
    number: projectNumber,
  });

  const project = ownerType === "user"
    ? fieldsResult.user?.projectV2
    : fieldsResult.organization?.projectV2;

  if (!project) {
    throw new Error(
      `Project #${projectNumber} not found for ${ownerType} '${login}'. ` +
        "Ensure the token has Projects: Read access.",
    );
  }

  const fieldNodes = project.fields.nodes;
  if (fieldNodes.length === 0) {
    throw new Error(
      `No fields found in project #${projectNumber}. ` +
        "Ensure the project has at least the required fields (Sprint, Status, etc.).",
    );
  }

  // Step 4: Match field names from config.yml to resolve field IDs
  // Use `field_names` as defined in ScrumConfigYml type (supports fallback to `fields` for backward compat).
  const ymlTyped = yml as ScrumConfigYml & { fields?: Record<string, string> };
  const fieldNames = ymlTyped.field_names ?? ymlTyped.fields ?? ({} as Record<string, string>);
  const sprintFieldName = fieldNames.sprint ?? "Sprint";
  const statusFieldName = fieldNames.status ?? "Status";
  const storyPointsFieldName = fieldNames.story_points ?? "Story Points";
  const priorityFieldName = fieldNames.priority ?? "Priority";
  const epicFieldName = fieldNames.epic ?? null;
  const assigneeFieldName = fieldNames.assignee ?? null;
  const typeFieldName = fieldNames.item_type ?? null;

  let sprintFieldId = "";
  let statusFieldId = "";
  let storyPointsFieldId: string | null = null;
  let priorityFieldId: string | null = null;
  let epicFieldId: string | null = null;
  let assigneeFieldId: string | null = null;
  let typeFieldId: string | null = null;

  for (const node of fieldNodes) {
    switch (node.name) {
      case sprintFieldName:
        sprintFieldId = node.id;
        break;
      case statusFieldName:
        statusFieldId = node.id;
        break;
      case storyPointsFieldName:
        storyPointsFieldId = node.id;
        break;
      case priorityFieldName:
        priorityFieldId = node.id;
        break;
    }
    // Guard against null field names to avoid matching empty-string field names
    if (epicFieldName && node.name === epicFieldName) {
      epicFieldId = node.id;
    }
    if (assigneeFieldName && node.name === assigneeFieldName) {
      assigneeFieldId = node.id;
    }
    if (typeFieldName && node.name === typeFieldName) {
      typeFieldId = node.id;
    }
  }

  if (!sprintFieldId) {
    throw new Error(
      `Sprint field '${sprintFieldName}' not found in project #${projectNumber}. ` +
        `Update the 'fields.sprint' value in ${filePath} to match the project field name.`,
    );
  }
  if (!statusFieldId) {
    throw new Error(
      `Status field '${statusFieldName}' not found in project #${projectNumber}. ` +
        `Update the 'fields.status' value in ${filePath} to match the project field name.`,
    );
  }

  // Step 5: Build statusOptions, priorityOptions, typeOptions maps
  const statusVocab = yml.status ?? {};
  const priorityVocab = yml.priority ?? {};

  const statusOptions: Record<string, string> = {};
  const priorityOptions: Record<string, string> = {};
  const typeOptions: Record<string, string> = {};

  for (const node of fieldNodes) {
    if (node.__typename === "ProjectV2SingleSelectField") {
      const options = (node as SingleSelectFieldNode).options;
      if (node.name === statusFieldName) {
        for (const opt of options) {
          // Map vocabulary names to option IDs
          for (const [vocabKey, vocabValue] of Object.entries(statusVocab)) {
            if (vocabValue === opt.name) {
              statusOptions[vocabKey] = opt.id;
            }
          }
        }
      } else if (node.name === priorityFieldName) {
        for (const opt of options) {
          for (const [vocabKey, vocabValue] of Object.entries(priorityVocab)) {
            if (vocabValue === opt.name) {
              priorityOptions[vocabKey] = opt.id;
            }
          }
        }
      }
    }
  }

  // Step 6: Classify iterations from the sprint field's configuration
  let activeIterations: IterationEntry[] = [];
  let completedIterations: IterationEntry[] = [];

  for (const node of fieldNodes) {
    if (node.__typename === "ProjectV2IterationField" && node.name === sprintFieldName) {
      const iterNode = node as IterationFieldNode;
      activeIterations = iterNode.configuration.iterations.map((i) => ({
        id: i.id,
        title: i.title,
        startDate: i.startDate,
        duration: i.duration,
      }));
      completedIterations = iterNode.configuration.completedIterations.map((i) => ({
        id: i.id,
        title: i.title,
        startDate: i.startDate,
        duration: i.duration,
      }));
      break;
    }
  }

  const iterations = classifyIterations(activeIterations, completedIterations);

  // Step 7: Assemble and return RuntimeConfig
  return {
    yml,
    projectId: project.id,
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
