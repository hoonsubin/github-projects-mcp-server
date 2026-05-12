// GitHub Projects v2 GraphQL API types
//
// ── Phase 1, step 1: add Scrum domain types ──────────────────────────────────
// [COMPLETE] All five types implemented below.
//
// ── SCRUM DOMAIN TYPES ─────────────────────────────────────────────────────────

/**
 * A reference to a single Story.
 * Every read tool returns `Story.ref.id` — pass it back here to identify the story.
 * Backend-agnostic: the id is an opaque project-item handle (PVTI_... on GitHub)
 * returned by scrum_get_sprint, scrum_get_backlog, or scrum_create_story.
 */
export interface StoryRef {
  id: string; // opaque project-item handle returned by any read tool
}

/**
 * A reference to a sprint.
 * Accepted forms: `"current"`, `"next"`, `null` (= no sprint, i.e., the backlog),
 * or an explicit sprint name (e.g., `"Sprint 12"`).
 */
export type SprintRef = "current" | "next" | null | string;

/**
 * The canonical Story entity returned by every read tool.
 *
 * Epic IS writable in v1 (maps to GitHub Milestone).
 */
export interface Story {
  ref: { id: string }; // opaque project-item handle — use in subsequent tool calls
  key: string | null; // human-readable identifier ("42", "PRO-123"); null for draft issues
  title: string;
  body: string;
  type: "feature" | "bug" | "tech_debt" | "spike" | null;
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

// ── Items / Cards ─────────────────────────────────────────────────────────────

export type ItemContentType = "Issue" | "PullRequest" | "DraftIssue";

// todo: all `ProjectV2` types must be removed from this code, and replace them with actual graphQL schema where it can
export interface ProjectV2ItemFieldValue {
  __typename: string;
  field: { id: string; name: string };
  text?: string;
  number?: number;
  date?: string;
  name?: string;
  color?: string;
  optionId?: string;
  title?: string;
  startDate?: string;
  duration?: number;
  iterationId?: string;
  users?: { nodes: Array<{ login: string }> };
  labels?: { nodes: Array<{ name: string; color: string }> };
  milestone?: { title: string; dueOn: string | null };
  repository?: { name: string; nameWithOwner: string };
}

export interface ProjectV2IssueContent {
  __typename: "Issue";
  id: string;
  number: number;
  title: string;
  url: string;
  state: string;
  body: string;
  assignees: { nodes: Array<{ login: string }> };
  labels: { nodes: Array<{ name: string; color: string }> };
  repository: { name: string; nameWithOwner: string };
  milestone: { title: string; dueOn: string | null } | null;
}

export interface ProjectV2PRContent {
  __typename: "PullRequest";
  id: string;
  number: number;
  title: string;
  url: string;
  state: string;
  body: string;
  assignees: { nodes: Array<{ login: string }> };
  labels: { nodes: Array<{ name: string; color: string }> };
  repository: { name: string; nameWithOwner: string };
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
  content: ProjectV2IssueContent | ProjectV2PRContent | ProjectV2DraftIssueContent | null;
}

// ── GraphQL response wrappers ─────────────────────────────────────────────────

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

// ── SCRUM config types ────────────────────────────────────────────────────────

/**
 * One canonical priority tier. The ordered position in the array (index 0 =
 * highest) defines relative urgency. The agent reasons in these keys; each
 * backend maps them to its own display labels via priority_display.
 */
interface PriorityTier {
  key: string; // e.g. "p0", "p1", "p2", "p3"
}

/**
 * Semantic metadata for a single canonical workflow state.
 * terminal — counts as "done" for velocity and burndown (exactly one should be true).
 * blocking — indicates the story is impeding sprint flow; used for impediment
 *            inference when explicit dependency link data is unavailable.
 */
interface StatusSemantics {
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
