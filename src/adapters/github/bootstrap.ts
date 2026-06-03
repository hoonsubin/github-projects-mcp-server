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
//
// computeTypeTemplatePaths() is also exported for use by the factory at
// construction time — it is a pure computation (no API call) that resolves
// configured template paths into ContentLocation values.
// =============================================================================

import type { GitHubBackendConfig } from "./types.ts";
import type { ScrumConfig } from "../../domain/config.ts";
import type { IterationEntry } from "../../domain/types.ts";
import type { ContentLocation } from "../../domain/content-location.ts";
import { resolveLocation, SUPPORTED_TEMPLATE_EXTENSIONS } from "../../scrum/resolve-location.ts";
import { GitHubApiError } from "./errors.ts";
import {
  buildOptionMaps,
  isCanonicalSingleSelectUnavailable,
  type OrgIssueFieldNode,
} from "./bootstrap-field-sources.ts";
import { GET_OWNER_BOOTSTRAP_QUERY } from "./queries.ts";
import type { SelectFieldNode } from "./types.ts";
import { classifyIterations } from "./internal/iteration-classifier.ts";
import {
  type OwnerProjectFieldsBootstrapResponse,
  projectV2FieldsFromBootstrap,
} from "./internal/owner-graphql.ts";

// ── Template path resolver (pure, no API call) ────────────────────────────────

/**
 * Resolve canonical type key → ContentLocation map from ghConfig.type_mapping.
 *
 * Pure computation — no network or filesystem I/O. Reads only the configured
 * type_mapping entries and resolves template paths/URLs relative to projectRoot.
 *
 * Exported for use by the factory at construction time (before bootstrap) AND
 * called within bootstrapGitHub() to keep the map fresh on each reload.
 *
 * Handles both:
 *   - Local file paths (relative to projectRoot)
 *   - Remote URLs (e.g. https://raw.githubusercontent.com/...)
 */
export const computeTypeTemplatePaths = (
  typeMapping: GitHubBackendConfig["type_mapping"],
  projectRoot: string,
): Record<string, ContentLocation> => {
  const typeTemplatePaths: Record<string, ContentLocation> = {};
  if (typeMapping) {
    for (const [key, entry] of Object.entries(typeMapping)) {
      if (entry.template) {
        typeTemplatePaths[key] = resolveLocation(
          entry.template,
          projectRoot,
          SUPPORTED_TEMPLATE_EXTENSIONS,
        );
      }
    }
  }
  return typeTemplatePaths;
};

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Metadata for a project field that is backed by an org-level issue field.
 * Carries the org issue field ID (for write mutations) and option name→ID map
 * (for single-select writes, since project field options are empty for these).
 */
export interface IssueBackedFieldMeta {
  /** The org-level IssueField node ID used in updateIssueFieldValue mutations. */
  orgFieldId: string;
  /** option display name → org-level option relay ID (for single-select fields). */
  options?: Record<string, string>;
}

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
  /**
   * Project field IDs backed by org-level issue fields.
   * Keyed by project field ID (PVTSSF_… / PVTF_…).
   * Populated only for org-owned projects when issue fields are detected.
   */
  issueBackedFields: Record<string, IssueBackedFieldMeta>;
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
  /** Fixture replay: classify active/next sprint as of this ISO timestamp. */
  iterationAsOf?: string;
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
  /** Pin sprint active/next classification (fixture replay uses manifest.capturedAt). */
  iterationAsOf?: string;
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
    throw new GitHubApiError(
      `Sprint field '${mapping.sprint}' not found in project #${projectNumber}. ` +
        `Update backends.github.field_mapping.sprint in ${configDesc} to match the project field name.`,
      {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery: `Set backends.github.field_mapping.sprint in ${configDesc} to the exact ` +
          "Iteration field name used on the project board, then reload the backend.",
        context: { projectNumber, configuredFieldName: mapping.sprint },
      },
    );
  }
  if (!statusFieldId) {
    throw new GitHubApiError(
      `Status field '${mapping.status}' not found in project #${projectNumber}. ` +
        `Update backends.github.field_mapping.status in ${configDesc} to match the project field name.`,
      {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery: `Set backends.github.field_mapping.status in ${configDesc} to the exact ` +
          "single-select status field name used on the project board, then reload the backend.",
        context: { projectNumber, configuredFieldName: mapping.status },
      },
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

/**
 * Detect which project fields are backed by org-level issue fields by matching
 * project field names against the org issue field list.
 */
const detectIssueBackedFields = (
  projectFieldNodes: FieldNode[],
  orgIssueFieldNodes: OrgIssueFieldNode[],
): Record<string, IssueBackedFieldMeta> => {
  const issueBackedFields: Record<string, IssueBackedFieldMeta> = {};
  const orgFieldByName = new Map(orgIssueFieldNodes.map((f) => [f.name, f]));

  for (const projectField of projectFieldNodes) {
    const orgField = orgFieldByName.get(projectField.name);
    if (!orgField) continue;

    const meta: IssueBackedFieldMeta = { orgFieldId: orgField.id };
    if (orgField.options && orgField.options.length > 0) {
      meta.options = Object.fromEntries(orgField.options.map((o) => [o.name, o.id]));
    }
    issueBackedFields[projectField.id] = meta;
  }

  return issueBackedFields;
};

interface OwnerBootstrapResponse {
  user?: { projectV2?: { id: string; fields: { nodes: FieldNode[] } } | null } | null;
  organization?: OrgBootstrapResponse["organization"];
}

interface OrgBootstrapResponse {
  organization: {
    projectV2?: { id: string; fields: { nodes: FieldNode[] } } | null;
    issueFields: { nodes: OrgIssueFieldNode[] };
    issueTypes: {
      nodes: Array<{
        id: string;
        name: string;
        isEnabled: boolean;
      }>;
    };
  } | null;
}

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

  let projectNode: { id: string; fields: { nodes: FieldNode[] } } | null | undefined;
  let orgIssueFieldNodes: OrgIssueFieldNode[] = [];
  let orgIssueTypes: Array<{ id: string; name: string; isEnabled: boolean }> = [];

  const ownerResult = await github.graphql<OwnerBootstrapResponse>(
    GET_OWNER_BOOTSTRAP_QUERY,
    { login: owner, number: projectNumber, isOrg: ownerType === "org" },
  );
  if (ownerType === "user") {
    projectNode = ownerResult.user?.projectV2;
  } else {
    const org = ownerResult.organization;
    projectNode = org?.projectV2;
    orgIssueFieldNodes = org?.issueFields.nodes ?? [];
    orgIssueTypes = org?.issueTypes.nodes ?? [];
  }

  if (!projectNode) {
    throw new GitHubApiError(
      `Project #${projectNumber} not found for ${ownerType} '${owner}'. ` +
        `Ensure the token has Projects: Read access.`,
      {
        code: "NOT_FOUND",
        statusCode: 404,
        recovery: "Verify backends.github.owner, owner_type, and project_number in config, " +
          "and confirm the token can read this project. " +
          "Make sure owner_type matches the project's owner type — " +
          'set to "user" for user-owned projects or "org" for organization-owned projects.',
        context: { owner, ownerType, projectNumber },
      },
    );
  }

  const fieldNodes = projectNode.fields.nodes;
  if (fieldNodes.length === 0) {
    throw new GitHubApiError(
      `No fields found in project #${projectNumber}. ` +
        `Ensure the project has at least the required fields (Sprint, Status).`,
      {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery:
          "Add the required Sprint (Iteration) and Status (single-select) fields to the project, " +
          "then reload the backend.",
        context: { projectNumber, owner, ownerType },
      },
    );
  }

  // Resolve field IDs, option maps, and iterations from live field metadata.
  const resolvedFieldIds = resolveFieldIds(
    fieldNodes,
    ghConfig.field_mapping,
    projectNumber,
    configDesc,
  );
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
    orgIssueFieldNodes,
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
        throw new GitHubApiError(
          `${configDesc}: type_mapping declares types whose display names are not present on the board:\n` +
            mismatched.join("\n") + "\n" +
            `For each entry above, either add the option to the ` +
            `"${ghConfig.field_mapping.item_type}" single-select field on your project board, ` +
            `or remove the key from type_mapping.`,
          {
            code: "OPTION_NOT_FOUND",
            statusCode: 400,
            recovery: "Align type_mapping display names with the project Type field options, " +
              "then reload the backend.",
            context: {
              projectNumber,
              configuredTypeField: ghConfig.field_mapping.item_type,
              mismatched,
            },
          },
        );
      }
    }
    typeResolution = { source: "board_field", fieldId: typeFieldId };
  } else if (ownerType === "org") {
    const enabledOrgIssueTypes = orgIssueTypes.filter((it) => it.isEnabled);
    typeOptions = {};
    for (const [canonicalKey, mapping] of Object.entries(ghConfig.type_mapping ?? {})) {
      const expected = (mapping.display ?? canonicalKey).toLowerCase();
      const match = enabledOrgIssueTypes.find((it) => it.name.toLowerCase() === expected);
      if (match) typeOptions[canonicalKey] = match.id;
    }

    if (ghConfig.type_mapping) {
      const mismatched = Object.entries(ghConfig.type_mapping)
        .filter(([canonicalKey]) => !typeOptions[canonicalKey])
        .map(([canonicalKey, entry]) =>
          `  - type_mapping.${canonicalKey}: display "${entry.display}" not found in organization issue types`
        );
      if (mismatched.length > 0) {
        throw new GitHubApiError(
          `${configDesc}: type_mapping declares types whose display names are not present in organization issue types:\n` +
            mismatched.join("\n") + "\n" +
            `For each entry above, either enable/create the matching organization issue type, ` +
            `or update/remove the key from type_mapping.`,
          {
            code: "OPTION_NOT_FOUND",
            statusCode: 400,
            recovery:
              "Ensure organization issue types exist and are enabled for each configured type_mapping display name, " +
              "then reload the backend.",
            context: { owner, projectNumber, mismatched },
          },
        );
      }
    }

    typeResolution = { source: "org_issue_type", fieldId: null };
  } else {
    throw new GitHubApiError(
      `Type field '${
        ghConfig.field_mapping.item_type ?? "(not configured)"
      }' not found in project #${projectNumber}. ` +
        `Update backends.github.field_mapping.item_type in ${configDesc} to match ` +
        `the exact SINGLE_SELECT field name in GitHub Projects.`,
      {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery:
          `Set backends.github.field_mapping.item_type in ${configDesc} to a valid single-select field ` +
          "name on the project board, then reload the backend.",
        context: {
          projectNumber,
          owner,
          ownerType,
          configuredTypeField: ghConfig.field_mapping.item_type ?? null,
        },
      },
    );
  }

  // Resolve template paths — pure computation from config, no API call.
  const typeTemplatePaths = computeTypeTemplatePaths(ghConfig.type_mapping, projectRoot);

  let activeIterations: IterationEntry[] = [];
  let completedIterations: IterationEntry[] = [];
  for (const node of fieldNodes) {
    if (isIterationField(node) && node.name === ghConfig.field_mapping.sprint) {
      activeIterations = node.configuration.iterations.map((i) => ({ ...i }));
      completedIterations = node.configuration.completedIterations.map((i) => ({ ...i }));
    }
  }

  const iterations = classifyIterations(
    activeIterations,
    completedIterations,
    params.iterationAsOf ? new Date(params.iterationAsOf) : new Date(),
  );

  // Detect issue-backed project fields for org-owned projects. Degrade (skip
  // issue-backed writes) only when both the project board and org issue-field
  // catalogs lack options for a configured single-select such as Priority.
  let issueBackedFields: Record<string, IssueBackedFieldMeta> = {};
  if (ownerType === "org") {
    const priorityNeedsCatalog = !!ghConfig.field_mapping.priority;
    const priorityCatalogUnavailable = priorityNeedsCatalog &&
      isCanonicalSingleSelectUnavailable(
        ghConfig.field_mapping.priority,
        fieldNodes,
        orgIssueFieldNodes,
        true,
      );
    if (!priorityCatalogUnavailable) {
      issueBackedFields = detectIssueBackedFields(fieldNodes, orgIssueFieldNodes);
    }
  }

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
    issueBackedFields,
  };
};
