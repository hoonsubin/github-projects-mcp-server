// =============================================================================
// src/types.ts — Re-export barrel
//
// Types are now organised by architectural layer:
//
//   Domain entities  →  src/domain/types.ts
//   Domain config    →  src/domain/config.ts
//   GitHub adapter   →  src/adapters/github/types.ts  (Phase B)
//
// This barrel preserves all existing import paths during the migration.
// Do not add new type declarations here — add them to the appropriate layer file.
// =============================================================================

// ── Domain layer re-exports ───────────────────────────────────────────────────

export type {
  ArtifactType,
  BurndownDayPoint,
  BurndownResponse,
  BurndownSprintMeta,
  BurndownStory,
  IdealDayPoint,
  IterationEntry,
  SprintRef,
  Story,
  StoryRef,
  TemplateResponse,
} from "./domain/types.ts";

export type { ScrumConfigYml } from "./domain/config.ts";

// ── GitHub Projects v2 GraphQL API types ──────────────────────────────────────
// These will move to src/adapters/github/types.ts in Phase B.
// todo: all ProjectV2 types and GraphQLResponse must move to src/adapters/github/types.ts

export type ItemContentType = "Issue" | "PullRequest" | "DraftIssue";

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

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

// ── GitHub-specific backend configuration ─────────────────────────────────────
// Will move to src/adapters/github/types.ts in Phase B.

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
