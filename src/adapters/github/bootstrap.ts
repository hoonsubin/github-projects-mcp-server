// =============================================================================
// src/adapters/github/bootstrap.ts — GitHub live metadata bootstrap
//
// Formerly config-loader.ts (renamed per Phase 4 of plans/config-loader-refactor.md).
// Single responsibility: fetch live GitHub project field metadata and return
// typed boot state. Does NOT fetch or parse YAML — that moved to
// src/scrum/config-boot.ts (Phase 1). Does NOT resolve env vars — that happens
// in the factory (Phase 0).
//
// Called at startup and on each ConfigReloader.reload().
// =============================================================================

import type { GitHubBackendConfig } from "./types.ts";
import type { ScrumConfig } from "../../domain/config.ts";
import type { IterationEntry } from "../../domain/types.ts";
import type { ContentLocation } from "../../domain/content-location.ts";
import { resolveLocation } from "../../scrum/resolve-location.ts";
import {
  GET_ORG_ISSUE_TYPES_BOOTSTRAP_QUERY,
  GET_ORG_PROJECT_FIELDS_BOOTSTRAP_QUERY,
  GET_USER_PROJECT_FIELDS_BOOTSTRAP_QUERY,
} from "./queries.ts";
import type { SelectFieldNode } from "./types.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Live GitHub project metadata — mutable, patched in-place by ConfigReloader.
 * typeTemplatePaths is included here because it's re-resolved on each reload.
 */
export interface GitHubLiveMetadata {
  typeResolution: TypeResolution;
  projectId: string;
  fields: {
    sprintFieldId: string;
    statusFieldId: string;
    storyPointsFieldId: string | null;
    priorityFieldId: string | null;
    epicFieldId: string | null;
    assigneeFieldId: string | null;
  };
  statusOptions: Record<string, string>;
  priorityOptions: Record<string, string>;
  typeOptions: Record<string, string>;
  typeTemplatePaths: Record<string, ContentLocation>;
  iterations: {
    active: IterationEntry | null;
    next: IterationEntry | null;
    completed: IterationEntry[];
    all: IterationEntry[];
  };
}

/**
 * Adapter-internal boot state. Immutable fields (readonly) hold values set
 * once at factory construction; the mutable `live` block is patched in-place
 * by ConfigReloader on each reload().
 *
 * Replaces the old flat RuntimeConfig.
 */
export interface GitHubBootState {
  readonly scrumConfig: ScrumConfig;
  readonly ghConfig: GitHubBackendConfig;
  live: GitHubLiveMetadata;
}

// ── Bootstrap params ──────────────────────────────────────────────────────────

/** Minimal GitHub client interface used during bootstrapping. */
interface GitHubClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

/** Parameters for bootstrapGitHub(). */
interface BootstrapParams {
  ghConfig: GitHubBackendConfig;
  github: GitHubClient;
  projectRoot: string;
  configDesc: string;
}

// ── Helper types ──────────────────────────────────────────────────────────────

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

export type TypeResolution =
  | { source: "board_field"; fieldId: string }
  | { source: "org_issue_type"; fieldId: null };

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

// ── Field resolution helpers ──────────────────────────────────────────────────

interface ResolvedFieldIds {
  sprintFieldId: string;
  statusFieldId: string;
  storyPointsFieldId: string | null;
  priorityFieldId: string | null;
  epicFieldId: string | null;
  assigneeFieldId: string | null;
  typeFieldId: string | null;
}

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

interface ResolvedOptionMaps {
  statusOptions: Record<string, string>;
  priorityOptions: Record<string, string>;
  typeOptions: Record<string, string>;
}

interface OrgIssueTypesResponse {
  organization: {
    issueTypes: {
      nodes: Array<{
        id: string;
        name: string;
        isEnabled: boolean;
      }>;
    };
  } | null;
}

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

const classifyIterations = (
  activeIterations: IterationEntry[],
  completedIterations: IterationEntry[],
): GitHubLiveMetadata["iterations"] => {
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

  const allMap = new Map<string, IterationEntry>();
  for (const iter of activeIterations) allMap.set(iter.id, iter);
  for (const iter of completedIterations) allMap.set(iter.id, iter);
  const all = [...allMap.values()].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );

  return { active, next, completed: [...completedIterations], all };
};

// ── Main bootstrap function ───────────────────────────────────────────────────

/**
 * Bootstrap live GitHub project field metadata.
 * Called at startup and on each ConfigReloader.reload().
 *
 * Does NOT fetch or parse YAML — receives the already-typed ghConfig.
 * Does NOT resolve env vars — token is already a ResolvedToken.
 */
export const bootstrapGitHub = async (params: BootstrapParams): Promise<GitHubLiveMetadata> => {
  const { ghConfig, github, projectRoot, configDesc } = params;

  const { owner, owner_type: ownerType, project_number: projectNumber } = ghConfig;

  // Validate config cross-references.
  const bootstrapQuery = ownerType === "user"
    ? GET_USER_PROJECT_FIELDS_BOOTSTRAP_QUERY
    : GET_ORG_PROJECT_FIELDS_BOOTSTRAP_QUERY;

  const fieldsResult = await github.graphql<ProjectFieldsResponse>(
    bootstrapQuery,
    { login: owner, number: projectNumber },
  );

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
  const resolvedFieldIds = resolveFieldIds(fieldNodes, ghConfig.field_mapping, projectNumber, configDesc);
  const {
    sprintFieldId,
    statusFieldId,
    storyPointsFieldId,
    priorityFieldId,
    epicFieldId,
    assigneeFieldId,
    typeFieldId,
  } = resolvedFieldIds;
  const { statusOptions, priorityOptions, typeOptions: boardTypeOptions } = buildOptionMaps(
    fieldNodes,
    ghConfig,
  );

  let typeResolution: TypeResolution;
  let typeOptions = boardTypeOptions;

  if (typeFieldId !== null) {
    // Validate each type_mapping entry's display name against live board options.
    if (ghConfig.field_mapping.item_type && ghConfig.type_mapping) {
      const mismatched = Object.entries(ghConfig.type_mapping)
        .filter(([canonicalKey]) => !typeOptions[canonicalKey])
        .map(([canonicalKey, entry]) =>
          `  - type_mapping.${canonicalKey}: display "${entry.display}" not found in ` +
          `"${ghConfig.field_mapping.item_type}" field options`
        );
      if (mismatched.length > 0) {
        throw new Error(
          `${configDesc}: type_mapping declares types whose display names are not present on the board:\n` +
            mismatched.join("\n") + "\n" +
            `For each entry above, either add the option to the ` +
            `"${ghConfig.field_mapping.item_type}" single-select field on your project board, ` +
            `or remove the key from type_mapping.`,
        );
      }
    }
    typeResolution = { source: "board_field", fieldId: typeFieldId };
  } else if (ownerType === "org") {
    const response = await github.graphql<OrgIssueTypesResponse>(
      GET_ORG_ISSUE_TYPES_BOOTSTRAP_QUERY,
      { login: owner },
    );
    const orgIssueTypes = response.organization?.issueTypes.nodes.filter((it) => it.isEnabled) ?? [];
    typeOptions = {};
    for (const [canonicalKey, mapping] of Object.entries(ghConfig.type_mapping ?? {})) {
      const expected = (mapping.display ?? canonicalKey).toLowerCase();
      const match = orgIssueTypes.find((it) => it.name.toLowerCase() === expected);
      if (match) typeOptions[canonicalKey] = match.id;
    }

    if (ghConfig.type_mapping) {
      const mismatched = Object.entries(ghConfig.type_mapping)
        .filter(([canonicalKey]) => !typeOptions[canonicalKey])
        .map(([canonicalKey, entry]) =>
          `  - type_mapping.${canonicalKey}: display "${entry.display}" not found in organization issue types`
        );
      if (mismatched.length > 0) {
        throw new Error(
          `${configDesc}: type_mapping declares types whose display names are not present in organization issue types:\n` +
            mismatched.join("\n") + "\n" +
            `For each entry above, either enable/create the matching organization issue type, ` +
            `or update/remove the key from type_mapping.`,
        );
      }
    }

    typeResolution = { source: "org_issue_type", fieldId: null };
  } else {
    throw new Error(
      `Type field '${
        ghConfig.field_mapping.item_type ?? "(not configured)"
      }' not found in project #${projectNumber}. ` +
        `Update backends.github.field_mapping.item_type in ${configDesc} to match ` +
        `the exact SINGLE_SELECT field name in GitHub Projects.`,
    );
  }

  // Resolve template paths into ContentLocation values anchored to projectRoot.
  const typeTemplatePaths: Record<string, ContentLocation> = {};
  if (ghConfig.type_mapping) {
    for (const [key, entry] of Object.entries(ghConfig.type_mapping)) {
      if (entry.template) {
        typeTemplatePaths[key] = resolveLocation(entry.template, projectRoot);
      }
    }
  }

  let activeIterations: IterationEntry[] = [];
  let completedIterations: IterationEntry[] = [];
  for (const node of fieldNodes) {
    if (isIterationField(node) && node.name === ghConfig.field_mapping.sprint) {
      activeIterations = node.configuration.iterations.map((i) => ({ ...i }));
      completedIterations = node.configuration.completedIterations.map((i) => ({ ...i }));
    }
  }

  const iterations = classifyIterations(activeIterations, completedIterations);

  return {
    typeResolution,
    projectId: projectNode.id,
    fields: {
      sprintFieldId,
      statusFieldId,
      storyPointsFieldId,
      priorityFieldId,
      epicFieldId,
      assigneeFieldId,
    },
    statusOptions,
    priorityOptions,
    typeOptions,
    typeTemplatePaths,
    iterations,
  };
};
