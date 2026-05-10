// GitHub Projects v2 GraphQL API types
//
// ── Phase 1, step 1: add Scrum domain types ──────────────────────────────────
// [COMPLETE] All five types implemented below.
//
// ── SCRUM DOMAIN TYPES ─────────────────────────────────────────────────────────

/**
 * A reference to a single Story.
 * Accepted forms: `{ "number": 42 }` (user-facing reference, e.g., issue number)
 * or `{ "id": "<opaque>" }` (backend-native handle returned by previous calls).
 */
export interface StoryRef {
  number?: number; // user-facing issue number (e.g. GitHub issue #42)
  id?: string; // opaque backend handle returned by a previous tool call
}

/**
 * A reference to a sprint.
 * Accepted forms: `"current"`, `"next"`, `null` (= no sprint, i.e., the backlog),
 * or an explicit sprint name (e.g., `"Sprint 12"`).
 */
export type SprintRef = "current" | "next" | null | string;

/**
 * One of the five writable board fields.
 * The set is fixed; new field types are out of scope for v1.
 */
export type ScrumField = "status" | "sprint" | "story_points" | "priority" | "assignee";

/**
 * Story type — drives the type label or category the backend applies.
 * NOTE: There is no "impediment" StoryType. scrum_log_impediment uses type:"spike"
 * plus an "impediment" label.
 */
export type StoryType = "feature" | "bug" | "tech_debt" | "spike";

/**
 * The canonical Story entity returned by every read tool.
 *
 * Epic IS writable in v1 (maps to GitHub Milestone).
 */
export interface Story {
  ref: { number: number; id: string }; // always populated with both forms after a read
  title: string;
  body: string;
  type: StoryType | null;
  status: string | null; // team's vocabulary value, e.g. "In Progress"
  sprint: string | null; // sprint name, or null if in backlog
  story_points: number | null;
  priority: string | null; // team's vocabulary value, e.g. "Must"
  assignees: string[]; // GitHub logins
  labels: string[]; // excludes type:* label (reflected in `type`)
  epic: string | null; // GitHub Milestone title; null if unset
  created_at: string; // ISO-8601
  updated_at: string; // ISO-8601
  url: string | null; // canonical URL in the backend UI
}

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

/**
 * @deprecated — DoR and DoD are now plain string[] in ScrumConfigYml.
 * Retained temporarily to avoid breaking any remaining references.
 * Remove in Phase 4 cleanup.
 */
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

/**
 * One canonical priority tier. The ordered position in the array (index 0 =
 * highest) defines relative urgency. The agent reasons in these keys; each
 * backend maps them to its own display labels via priority_display.
 */
export interface PriorityTier {
  key: string; // e.g. "p0", "p1", "p2", "p3"
}

/**
 * Semantic metadata for a single canonical workflow state.
 * terminal — counts as "done" for velocity and burndown (exactly one should be true).
 * blocking — indicates the story is impeding sprint flow; used for impediment
 *            inference when explicit dependency link data is unavailable.
 */
export interface StatusSemantics {
  terminal: boolean;
  blocking: boolean;
}

/**
 * GitHub-specific backend configuration.
 * All values here are platform-specific — the use-case layer never reads this directly.
 * Auth values are $ENV_VAR references resolved by the config loader at startup.
 */
export interface GitHubBackendConfig {
  auth: {
    token: string; // resolved from $GITHUB_TOKEN or literal value
  };
  owner: string;
  owner_type: "user" | "org";
  project_number: number;
  tracked_repos: string[];
  /** Platform identity for team members. `ref` cross-references project.team[].name. */
  team?: Array<{
    ref: string;
    login: string;
  }>;
  /** Maps canonical Scrum field names to exact GitHub project field names. */
  field_mapping: {
    sprint: string; // REQUIRED — ITERATION type field
    status: string; // REQUIRED — SINGLE_SELECT type field
    story_points?: string; // optional — NUMBER type field
    priority?: string; // optional — SINGLE_SELECT type field
    [key: string]: string | undefined;
  };
  /** Maps canonical status keys → exact GitHub single-select option names. */
  status_display: Record<string, string>;
  /** Maps canonical priority keys → exact GitHub single-select option names. */
  priority_display: Record<string, string>;
}

/** Top-level shape of .github/scrum/config.yml. */
export interface ScrumConfigYml {
  /** Platform-agnostic project identity, agent behaviour, and team roster. */
  project: {
    name: string;
    agent?: {
      name?: string;
      autonomy?: {
        level: "conservative" | "standard" | "full";
        require_confirmation_above_n_items?: number;
      };
    };
    team?: Array<{
      name: string;
      role: "scrum_master" | "product_owner" | "developer";
      contact?: string;
    }>;
  };

  /** Platform-neutral Scrum taxonomy — consumed by use-case layer and agent. */
  scrum: {
    sprint?: {
      length_weeks?: number;
      start_day?: string;
      story_point_scale?: string;
      story_point_values?: number[];
      velocity_window?: number;
      carry_over_threshold_days?: number;
    };
    /** Ordered highest→lowest. p0 is most urgent. */
    priority: PriorityTier[];
    /** Canonical workflow states with semantic metadata. */
    status: Record<string, StatusSemantics>;
  };

  /** Agent-facing quality gates. Server never enforces these. */
  definition_of_ready?: string[];
  definition_of_done?: string[];

  /** Ceremony artifact template paths, or null for agent skill defaults. */
  templates?: Partial<Record<ArtifactType, string | null>>;

  /** Where the agent writes ceremony documents (outside MCP server scope). */
  ceremony_records?: {
    backend: string;
    discussion_category?: string;
    issue_label?: string;
    file_path?: string;
  };

  /**
   * Backend adapter configurations, keyed by platform name (e.g. "github").
   * The agent identifies backends by these keys when routing cross-platform calls.
   */
  backends: {
    github?: GitHubBackendConfig;
    [key: string]: unknown; // future backends (notion, linear, etc.)
  };
}

/**
 * A single sprint iteration entry enriched with a `completed` flag.
 * Extends IterationEntry so sprint tools can use IterationEntry helpers
 * on both active and completed sprints.
 */
// todo: [Phase 4] Remove — SprintIteration becomes internal to new tool handlers ([#19](https://github.com/hoonsubin/github-projects-mcp-server/issues/19))
export interface SprintIteration extends IterationEntry {
  completed?: boolean;
}

// todo: [Phase 4] Remove — BoardConfig is sync-script-specific; RuntimeConfig (src/services/config.ts) ([#19](https://github.com/hoonsubin/github-projects-mcp-server/issues/19))
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

// todo: [Phase 4] Remove entire section — GhFieldBase, GhSingleSelectField, GhIterationField, ([#19](https://github.com/hoonsubin/github-projects-mcp-server/issues/19))
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

// todo: [Phase 4] Remove — MergedScrumConfig is replaced by RuntimeConfig in src/services/config.ts ([#19](https://github.com/hoonsubin/github-projects-mcp-server/issues/19))
/**
 * Merged runtime configuration: scrum.config.yml (human-authored) overlaid
 * with project-board.config.json (GitHub-synced). The sprint tools operate
 * on this type exclusively — they never read the raw files directly.
 */
export interface MergedScrumConfig extends ScrumConfigYml {
  /** GitHub-synced board state from project-board.config.json. */
  _board: BoardConfig;
}

// todo: [Phase 4] Remove — ResolvedScrumFields is replaced by RuntimeConfig in src/services/config.ts ([#19](https://github.com/hoonsubin/github-projects-mcp-server/issues/19))
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

// todo: [Phase 4] Remove — IterationVelocity is internal to scrum_get_velocity handler ([#19](https://github.com/hoonsubin/github-projects-mcp-server/issues/19))
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

// todo: [Phase 4] Remove — SprintStatusResult is internal to scrum_get_board handler ([#19](https://github.com/hoonsubin/github-projects-mcp-server/issues/19))
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

// todo: [Phase 4] Remove — BulkUpdateResult is internal to scrum_plan_sprint handler ([#19](https://github.com/hoonsubin/github-projects-mcp-server/issues/19))
/** Per-item result for bulk update and sprint close operations. */
export interface BulkUpdateResult {
  item_id: string;
  title: string;
  success: boolean;
  error?: string;
}

// ── SCRUM history types (scrum_get_history) ────────────────────────────────────

/** Response shape for scrum_get_history tool. */
export interface SprintHistoryResponse {
  window: number;
  sprints: SprintSnapshot[];
  message?: string; // present when no sprints available
}

/** A single sprint snapshot returned by scrum_get_history. */
export interface SprintSnapshot {
  name: string;
  start_date: string; // ISO date (YYYY-MM-DD)
  end_date: string; // ISO date (YYYY-MM-DD)
  duration_days: number;
  stories: SprintStory[];
  summary: SprintSummary;
}

/** Lightweight story entry within a sprint snapshot. */
export interface SprintStory {
  number: number;
  title: string;
  points: number;
  status: string | null;
}

/** Aggregated summary for a sprint snapshot. */
export interface SprintSummary {
  committed_points: number;
  completed_points: number;
  carried_points: number;
  completion_rate: number; // 0–1, rounded to 2 decimals
  story_count: number;
  completed_count: number;
}

// ── Backlog types (scrum_get_backlog) ─────────────────────────────────────────

/** Readiness assessment for a backlog story against Definition of Ready. */
export interface StoryReadiness {
  /** Has story points assigned and acceptance criteria checklist present */
  has_estimation_and_ac: boolean;
  /** Has some but not all DoR criteria met */
  partially_ready: boolean;
  /** Has none of the DoR criteria */
  not_ready: boolean;
}

/** Response shape for scrum_get_backlog. */
export interface GetBacklogResult {
  stories: Story[];
  total_count: number;
  readiness: {
    /** Stories with all DoR criteria met */
    ready: number;
    /** Stories with partial DoR criteria */
    partially_ready: number;
    /** Stories with no DoR criteria */
    not_ready: number;
  };
}

// ── Burndown types (scrum_get_burndown) ──────────────────────────────────────

/** Response shape for scrum_get_burndown. */
export interface BurndownResponse {
  sprint: BurndownSprintMeta;
  data_source: "audit_log" | "issue_close_proxy";
  warning?: string;
  series: BurndownDayPoint[];
  ideal: IdealDayPoint[];
  stories: BurndownStory[];
}

/** Sprint window metadata returned alongside the burndown series. */
export interface BurndownSprintMeta {
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  duration_days: number;
  days_remaining: number;
}

/** One entry in the actual burndown series — one per calendar day. */
export interface BurndownDayPoint {
  date: string; // YYYY-MM-DD
  remaining_points: number;
  completed_points: number;
}

/** One entry in the ideal burndown line — one per calendar day. */
export interface IdealDayPoint {
  date: string; // YYYY-MM-DD
  remaining_points: number;
}

/** Lightweight per-story summary in the burndown response. */
export interface BurndownStory {
  number: number;
  title: string;
  points: number; // 0 if the story has no points assigned
  status: string | null;
  completed_at: string | null; // ISO-8601 timestamp, or null if not yet done
}

// ── Template types (scrum_get_template) ──────────────────────────────────────

/**
 * The five ceremony artifact types for which custom templates can be declared.
 * Used in ScrumConfigYml.templates, GetTemplateSchema, and TemplateResponse.
 */
export type ArtifactType =
  | "sprint_review"
  | "retrospective"
  | "standup"
  | "sprint_planning"
  | "refinement";

/**
 * Discriminated union response for scrum_get_template.
 *
 * source: "custom"  — a custom template was fetched from the repo.
 *                     content is the raw template text; the agent applies it.
 * source: "default" — no custom template is declared for this artifact type.
 *                     content is null; the agent uses its own built-in default.
 *
 * Invalid states (e.g. content: null with source: "custom") are structurally
 * excluded by the discriminated union — the compiler enforces the contract.
 */
export type TemplateResponse =
  | { content: string; source: "custom" }
  | { content: null; source: "default" };
