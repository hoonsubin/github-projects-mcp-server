// GitHub Projects v2 GraphQL API types
//
// ── Phase 1, step 1: add Scrum domain types ──────────────────────────────────
//
// StoryRef and SprintRef are currently scaffolded and exported from
// src/services/resolver.ts as a temporary home. Before implementing loadConfig
// or either resolver function, move them here and update resolver.ts to import
// from "../types.ts" instead.
//
// todo: [Phase 1, step 1] Move StoryRef here from resolver.ts, then delete from resolver.ts:
//   export interface StoryRef {
//     number?: number; // user-facing issue number (e.g. GitHub issue #42)
//     id?: string;     // opaque backend handle returned by a previous tool call
//   }
//
// todo: [Phase 1, step 1] Move SprintRef here from resolver.ts, then delete from resolver.ts:
//   export type SprintRef = "current" | "next" | null | string;
//
// todo: [Phase 1, step 1] Add ScrumField — the five writable board fields:
//   export type ScrumField = "status" | "sprint" | "story_points" | "priority" | "assignee";
//
// todo: [Phase 1, step 1] Add StoryType — drives the type label applied by the backend:
//   export type StoryType = "feature" | "bug" | "tech_debt" | "spike";
//   NOTE: There is no "impediment" StoryType. scrum_log_impediment uses type:"spike"
//   plus an "impediment" label. The README's scrum_log_impediment description says
//   "typed impediment" — this is misleading shorthand, not a missing enum value.
//
// todo: [Phase 1, step 1] Add Story interface — canonical shape returned by every read tool:
//   export interface Story {
//     ref: { number: number; id: string }; // always populated with both forms after a read
//     title: string;
//     body: string;
//     type: StoryType | null;
//     status: string | null;       // team's vocabulary value, e.g. "In Progress"
//     sprint: string | null;       // sprint name, or null if in backlog
//     story_points: number | null;
//     priority: string | null;     // team's vocabulary value, e.g. "Must"
//     assignees: string[];         // GitHub logins
//     labels: string[];            // excludes type:* label (reflected in `type`)
//     epic: string | null;         // GitHub Milestone title; null if unset
//     created_at: string;          // ISO-8601
//     updated_at: string;          // ISO-8601
//     url: string | null;          // canonical URL in the backend UI
//   }
//   NOTE: README story shape table says "(V1 reads epic membership; does not write)" —
//   this is stale. scrum_create_story and scrum_update_story both accept epic as input
//   (it maps to a GitHub Milestone). Epic IS writable in v1. The README table note
//   should be removed.

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

// ── Shared primitives ────────────────────────────────────────────────────────

/**
 * A single sprint iteration entry as returned by the GitHub iteration field
 * configuration. Used in ProjectV2Field, GhIterationConfig, and as the base
 * for SprintIteration.
 */
export interface IterationEntry {
  id: string;
  title: string;
  startDate: string;
  duration: number;
}

/** A versioned definition checklist (DoR and DoD share this shape). */
export interface DefinitionCriteria {
  version: string;
  last_updated: string;
  criteria: string[];
}

// ── Projects ─────────────────────────────────────────────────────────────────

export interface ProjectV2 {
  id: string;
  number: number;
  title: string;
  shortDescription: string | null;
  url: string;
  public: boolean;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
  readme: string | null;
  owner: { __typename: "User" | "Organization"; login: string };
  fields: { nodes: ProjectV2Field[] };
  items: { totalCount: number };
}

export interface ProjectV2Field {
  id: string;
  name: string;
  dataType: string;
  // Single-select specific
  options?: Array<{
    id: string;
    name: string;
    color: string;
    description: string;
  }>;
  // Iteration specific
  configuration?: {
    iterations: IterationEntry[];
    completedIterations: IterationEntry[];
  };
}

// ── Items / Cards ─────────────────────────────────────────────────────────────

export type ItemContentType = "Issue" | "PullRequest" | "DraftIssue";

export interface ProjectV2ItemFieldValue {
  __typename: string;
  field: { id: string; name: string };
  // Text
  text?: string;
  // Number
  number?: number;
  // Date
  date?: string;
  // Single-select
  name?: string;
  color?: string;
  optionId?: string;
  // Iteration
  title?: string;
  startDate?: string;
  duration?: number;
  iterationId?: string;
  // User
  users?: { nodes: Array<{ login: string }> };
  // Label
  labels?: { nodes: Array<{ name: string; color: string }> };
  // Milestone
  milestone?: { title: string; dueOn: string | null };
  // Repository
  repository?: { name: string; nameWithOwner: string };
}

/** Fields shared by both Issue and PullRequest content nodes. */
export interface LinkedContentBase {
  id: string;
  number: number;
  title: string;
  url: string;
  state: string;
  body: string;
  assignees: { nodes: Array<{ login: string }> };
  labels: { nodes: Array<{ name: string; color: string }> };
  repository: { name: string; nameWithOwner: string };
}

export interface ProjectV2IssueContent extends LinkedContentBase {
  __typename: "Issue";
  milestone: { title: string; dueOn: string | null } | null;
}

export interface ProjectV2PRContent extends LinkedContentBase {
  __typename: "PullRequest";
  isDraft: boolean;
}

export interface ProjectV2DraftIssueContent {
  __typename: "DraftIssue";
  id: string;
  title: string;
  body: string;
  assignees: { nodes: Array<{ login: string }> };
}

export interface ProjectV2Item {
  id: string;
  type: ItemContentType;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  fieldValues: { nodes: ProjectV2ItemFieldValue[] };
  content:
    | ProjectV2IssueContent
    | ProjectV2PRContent
    | ProjectV2DraftIssueContent
    | null;
}

// ── GraphQL response wrappers ─────────────────────────────────────────────────

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

/** Paginated projectsV2 connection — shared by user and org list responses. */
export interface ProjectsV2Connection {
  nodes: ProjectV2[];
  pageInfo: PageInfo;
  totalCount: number;
}

export interface UserProjectsData {
  user: { projectsV2: ProjectsV2Connection } | null;
}

export interface OrgProjectsData {
  organization: { projectsV2: ProjectsV2Connection } | null;
}

export interface SingleProjectData {
  user?: { projectV2: ProjectV2 | null };
  organization?: { projectV2: ProjectV2 | null };
}

export interface ProjectItemsData {
  user?: {
    projectV2: {
      items: {
        nodes: ProjectV2Item[];
        pageInfo: PageInfo;
        totalCount: number;
      };
    } | null;
  };
  organization?: {
    projectV2: {
      items: {
        nodes: ProjectV2Item[];
        pageInfo: PageInfo;
        totalCount: number;
      };
    } | null;
  };
}

export interface AddProjectItemData {
  addProjectV2ItemById: { item: { id: string } };
}

export interface AddDraftIssueData {
  addProjectV2DraftIssue: { projectItem: { id: string } };
}

export interface UpdateProjectItemFieldData {
  updateProjectV2ItemFieldValue: { projectV2Item: { id: string } };
}

export interface DeleteProjectItemData {
  deleteProjectV2Item: { deletedItemId: string };
}

export interface ArchiveProjectItemData {
  archiveProjectV2Item: { item: { id: string; isArchived: boolean } };
}

export interface UpdateProjectData {
  updateProjectV2: {
    projectV2: Pick<
      ProjectV2,
      "id" | "title" | "shortDescription" | "public" | "closed"
    >;
  };
}

// ── SCRUM config types ────────────────────────────────────────────────────────

/** Shape of scrum.config.yml (human-defined sections only). */
export interface ScrumConfigYml {
  project: {
    owner: string;
    /** "user" for personal accounts, "org" for organisations. */
    owner_type: "user" | "org";
    project_number: number;
  };
  product?: {
    name: string;
    vision: string;
    product_goal: string;
  };
  team?: {
    product_owner: { name: string; contact: string };
    members: Array<{
      login: string;
      name: string;
      scrum_master_sprint: number;
    }>;
    supervisor: { name: string; contact: string; report_recipient: boolean };
  };
  sprint_goal?: {
    field_name: string | null;
    required: boolean;
    format: string;
  };
  // field_names maps Scrum concepts to the actual field names used in this project's board.
  // loadConfig (Phase 1, step 3) resolves these strings to GitHub field IDs at call time
  // via RuntimeConfig.fields — no static binding needed.
  field_names: {
    sprint: string;
    status: string;
    story_points: string;
    priority: string;
    epic: string;
    item_type: string;
    assignee: string;
    impediment: string;
    [key: string]: string;
  };
  item_id?: {
    user_story_prefix: string;
    task_prefix: string;
    commit_format: string;
  };
  epics?: Array<{ id: string; title: string; priority: string }>;
  story_points?: {
    method?: string;
    scale?: number[];
    max_points_per_item?: number;
  };
  sprint?: {
    duration_days: number | null;
    velocity_window?: number;
    carry_over_threshold_days?: number;
    report_submit_time?: string;
    report_recipient?: string | null;
  };
  impediment?: {
    escalation_threshold_days?: number;
  };
  autonomy?: {
    level: "conservative" | "standard" | "full";
    require_confirmation_above_n_items: number;
  };
  definition_of_ready?: DefinitionCriteria;
  definition_of_done?: DefinitionCriteria;
  [key: string]: unknown;
}

/**
 * A single sprint iteration entry enriched with a `completed` flag.
 * Extends IterationEntry so sprint tools can use IterationEntry helpers
 * on both active and completed sprints.
 */
// todo: [Phase 4] Remove — SprintIteration becomes internal to new tool handlers
export interface SprintIteration extends IterationEntry {
  completed?: boolean;
}

// todo: [Phase 4] Remove — BoardConfig is sync-script-specific; RuntimeConfig (src/services/config.ts)
//   is its replacement. The sync script that writes project-board.config.json is also retired.
/** Shape written to project-board.config.json by the sync script. */
export interface BoardConfig {
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
  impediment?: {
    _field_id: string | null;
    statuses: string[];
    _options?: Array<{ id: string; name: string; color: string }>;
  };
  story_points: { _field_id: string | null };
  _fields_registry: Record<
    string,
    { id: string; dataType: string; __typename: string }
  >;
  _epic_field: Record<string, unknown> | null;
  _assignee_field: { _field_id: string; dataType: string } | null;
}

// todo: [Phase 4] Remove entire section — GhFieldBase, GhSingleSelectField, GhIterationField,
//   GhProjectResponse are sync-script-only shapes. The sync script is retired. Any remaining
//   GraphQL response shape needs are served by src/generated/github-types.ts (codegen).
// ── Sync script GraphQL shapes ────────────────────────────────────────────────

export interface GhFieldBase {
  __typename: string;
  id: string;
  name: string;
  dataType: string;
}

export interface GhSingleSelectOption {
  id: string;
  name: string;
  color: string;
  description: string;
}

export interface GhSingleSelectField extends GhFieldBase {
  __typename: "ProjectV2SingleSelectField";
  options: GhSingleSelectOption[];
}

export interface GhIterationConfig {
  startDay: number;
  duration: number;
  iterations: IterationEntry[];
  completedIterations: IterationEntry[];
}

export interface GhIterationField extends GhFieldBase {
  __typename: "ProjectV2IterationField";
  configuration: GhIterationConfig;
}

export type GhField = GhFieldBase | GhSingleSelectField | GhIterationField;

export interface GhProjectResponse {
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

// ── SCRUM runtime types ───────────────────────────────────────────────────────

// todo: [Phase 4] Remove — MergedScrumConfig is replaced by RuntimeConfig in src/services/config.ts
/**
 * Merged runtime configuration: scrum.config.yml (human-authored) overlaid
 * with project-board.config.json (GitHub-synced). The sprint tools operate
 * on this type exclusively — they never read the raw files directly.
 */
export interface MergedScrumConfig extends ScrumConfigYml {
  /** GitHub-synced board state from project-board.config.json. */
  _board: BoardConfig;
}

// todo: [Phase 4] Remove — ResolvedScrumFields is replaced by RuntimeConfig in src/services/config.ts
/**
 * Resolved field IDs after name → ID mapping via _fields_registry.
 * Produced by resolveFields() and consumed by all sprint tool helpers.
 */
export interface ResolvedScrumFields {
  sprintFieldId: string;
  statusFieldId: string;
  storyPointsFieldId: string | null;
  priorityFieldId: string | null;
  impedimentFieldId: string | null;
  /** Option ID for the "Done" status value; null until status_values is synced. */
  doneOptionId: string | null;
  /** Option ID for the "Blocked" status value; null until status_values is synced. */
  blockedOptionId: string | null;
}

// todo: [Phase 4] Remove — IterationVelocity is internal to scrum_get_velocity handler
/** Per-iteration velocity entry used by github_get_velocity. */
export interface IterationVelocity {
  iterationId: string;
  title: string;
  startDate: string;
  durationDays: number;
  endDate: string;
  committedPoints: number;
  completedPoints: number;
  completionRate: number; // 0–1
  isCurrent: boolean;
}

// todo: [Phase 4] Remove — SprintStatusResult is internal to scrum_get_board handler
/** Aggregated sprint health snapshot used by github_get_sprint_status. */
export interface SprintStatusResult {
  iteration: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    daysRemaining: number;
  };
  committedPoints: number;
  completedPoints: number;
  completionPct: number;
  itemsByStatus: Record<string, ProjectV2Item[]>;
  blockedItems: ProjectV2Item[];
  carryOverItems: ProjectV2Item[];
}

// todo: [Phase 4] Remove — BulkUpdateResult is internal to scrum_plan_sprint handler
/** Per-item result for bulk update and sprint close operations. */
export interface BulkUpdateResult {
  item_id: string;
  title: string;
  success: boolean;
  error?: string;
}
