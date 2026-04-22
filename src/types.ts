// GitHub Projects v2 GraphQL API types

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
export interface SprintIteration extends IterationEntry {
  completed?: boolean;
}

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

/**
 * Merged runtime configuration: scrum.config.yml (human-authored) overlaid
 * with project-board.config.json (GitHub-synced). The sprint tools operate
 * on this type exclusively — they never read the raw files directly.
 */
export interface MergedScrumConfig extends ScrumConfigYml {
  /** GitHub-synced board state from project-board.config.json. */
  _board: BoardConfig;
}

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

/** Per-item result for bulk update and sprint close operations. */
export interface BulkUpdateResult {
  item_id: string;
  title: string;
  success: boolean;
  error?: string;
}
