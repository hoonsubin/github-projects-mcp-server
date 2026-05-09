// =============================================================================
// src/adapters/github/config-loader.ts — Bootstrap + config loading
//
// Extracted from scrum-read.ts and services/config.ts as part of Story B (Phase 5).
// GitHub-specific config loading lives in the adapter layer.
// =============================================================================

import { parse } from "@std/yaml";
import type { IterationEntry, ScrumConfigYml } from "../../types.ts";
// graphql is imported by consumers of this module's exports (loadConfig, classifyIterations)

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
  statusOptions: Record<string, string>;
  priorityOptions: Record<string, string>;
  typeOptions: Record<string, string>;
  iterations: {
    active: IterationEntry | null;
    next: IterationEntry | null;
    completed: IterationEntry[];
    all: IterationEntry[];
  };
}

/** Minimal GitHub client interface. */
interface GitHubClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

/** Config loader parameters. */
export interface ConfigParams {
  github: GitHubClient;
  owner: string;
  ownerType: "user" | "org";
  projectNumber: number;
  repo: string;
}

// ── Bootstrap helpers ─────────────────────────────────────────────────────────

interface BootstrapConfig {
  owner: string;
  ownerType: "user" | "org";
  projectNumber: number;
}

export const getBootstrapConfig = (): BootstrapConfig => {
  const owner = Deno.env.get("GITHUB_OWNER");
  if (!owner) {
    throw new Error(
      "GITHUB_OWNER environment variable is not set. " +
        "Set it to the GitHub username or organization login that owns the project.",
    );
  }
  const ownerTypeRaw = Deno.env.get("GITHUB_OWNER_TYPE") ?? "user";
  if (ownerTypeRaw !== "user" && ownerTypeRaw !== "org") {
    throw new Error(
      `GITHUB_OWNER_TYPE must be 'user' or 'org', got '${ownerTypeRaw}'.`,
    );
  }
  const projectNumberRaw = Deno.env.get("GITHUB_PROJECT_NUMBER");
  if (!projectNumberRaw) {
    throw new Error("GITHUB_PROJECT_NUMBER environment variable is not set.");
  }
  const projectNumber = parseInt(projectNumberRaw, 10);
  if (isNaN(projectNumber)) {
    throw new Error(
      `GITHUB_PROJECT_NUMBER must be an integer, got '${projectNumberRaw}'.`,
    );
  }
  return { owner, ownerType: ownerTypeRaw as "user" | "org", projectNumber };
};

export const getRepo = (): string => {
  const repo = Deno.env.get("GITHUB_REPO");
  if (!repo) {
    throw new Error(
      "GITHUB_REPO environment variable is not set. " +
        "Set it to the repository slug (e.g., 'github-projects-mcp-server').",
    );
  }
  return repo;
};

// ── GraphQL queries ──────────────────────────────────────────────────────────

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

// ── Helper types ─────────────────────────────────────────────────────────────

interface SingleSelectFieldNode {
  __typename: "ProjectV2SingleSelectField";
  id: string;
  name: string;
  dataType: string;
  options: Array<{ id: string; name: string; color: string; description: string }>;
}

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

interface BaseFieldNode {
  __typename: string;
  id: string;
  name: string;
  dataType: string;
}

type FieldNode = BaseFieldNode | SingleSelectFieldNode | IterationFieldNode;

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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Classify iterations into active, next, completed, and all categories. */
export const classifyIterations = (
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
  for (const iter of activeIterations) {
    allMap.set(iter.id, iter);
  }
  for (const iter of completedIterations) {
    allMap.set(iter.id, { ...iter } as IterationEntry);
  }
  const all = [...allMap.values()].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );

  return { active, next, completed, all };
};

// ── Main function ────────────────────────────────────────────────────────────

export const loadConfig = async (params: ConfigParams): Promise<RuntimeConfig> => {
  const { github, owner, ownerType, projectNumber, repo } = params;

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
    if (node.name === sprintFieldName) sprintFieldId = node.id;
    if (node.name === statusFieldName) statusFieldId = node.id;
    if (node.name === storyPointsFieldName) storyPointsFieldId = node.id;
    if (node.name === priorityFieldName) priorityFieldId = node.id;
    if (epicFieldName && node.name === epicFieldName) epicFieldId = node.id;
    if (assigneeFieldName && node.name === assigneeFieldName) assigneeFieldId = node.id;
    if (typeFieldName && node.name === typeFieldName) typeFieldId = node.id;
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

  let activeIterations: IterationEntry[] = [];
  let completedIterations: IterationEntry[] = [];

  for (const node of fieldNodes) {
    if (node.__typename === "ProjectV2IterationField" && node.name === sprintFieldName) {
      activeIterations = (node as IterationFieldNode).configuration.iterations.map(
        (iter) => ({ ...iter, completed: false }),
      );
      completedIterations = (node as IterationFieldNode).configuration.completedIterations.map(
        (iter) => ({ ...iter, completed: true }),
      );
    }
  }

  const iterations = classifyIterations(activeIterations, completedIterations);

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
