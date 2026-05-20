// =============================================================================
// src/adapters/github/types.ts — GitHub adapter projection types
//
// Single source of truth for all GitHub API types used by this adapter:
//
//   - GitHubBackendConfig     — platform-specific connection config
//   - GraphQLResponse<T>      — generic response envelope
//   - ItemContentType         — alias of the generated ProjectV2ItemType enum
//   - ProjectItem*            — query-specific projections of GH.Issue / PullRequest / DraftIssue
//   - ProjectItem             — the full project board item (replaces ProjectV2Item)
//   - ItemFieldValue          — flat field-value projection (replaces ProjectV2ItemFieldValue)
//   - FieldValueNode          — minimal structural interface for extractBoardFields
//   - BoardFields             — board field extraction output
//   - Comment / LinkedPr      — issue detail output shapes
//
// Nothing in the domain layer (src/domain/, src/scrum/) imports from this file.
// =============================================================================

import type * as GH from "../../generated/github-types.ts";

// ── GitHub backend connection config (moved from src/types.ts) ───────────────

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
    item_type?: string; // optional — SINGLE_SELECT type field for story type
    epic?: string; // optional — field used to track epic association on the board
    assignee?: string; // optional — field used to track assignees on the board
    [key: string]: string | undefined;
  };
  /** Maps canonical status keys → exact GitHub single-select option names. */
  status_display: Record<string, string>;
  /** Maps canonical priority keys → exact GitHub single-select option names. */
  priority_display: Record<string, string>;
  /**
   * Maps canonical story type keys → exact GitHub single-select option names
   * for the item_type field. Only required when field_mapping.item_type is set.
   * Example: { feature: "Feature", bug: "Bug", tech_debt: "Tech Debt", spike: "Spike" }
   */
  type_display?: Record<string, string>;
}

// ── GraphQL response envelope (moved from src/types.ts) ─────────────────────

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

// ── Project item type (grounded in generated schema) ─────────────────────────

/**
 * Enumerates the underlying content types a GitHub Projects v2 item can have.
 * Direct alias of GH.ProjectV2ItemType from the generated schema.
 *
 * Note: these are item-level values ("ISSUE", "PULL_REQUEST", "DRAFT_ISSUE")
 * on ProjectItem.type. The __typename discriminators on content objects use
 * title-case ("Issue", "PullRequest", "DraftIssue") — these are separate fields.
 */
export type ItemContentType = GH.ProjectV2ItemType;

// ── Content projection types ──────────────────────────────────────────────────
//
// These replace the hand-rolled ProjectV2IssueContent / ProjectV2PRContent /
// ProjectV2DraftIssueContent types from src/types.ts.
//
// Design: scalar fields that exist on the generated GH.* interfaces are declared
// via Required<Pick<GH.X, ...>> so the compiler validates them against the schema.
// Nested connection fields (assignees, labels, milestone) are defined as inline
// query-projection shapes — narrower than the full schema types — matching exactly
// what our GraphQL fragments fetch.

export interface ProjectItemIssueContent
  extends Required<Pick<GH.Issue, "id" | "number" | "title" | "body" | "url">> {
  __typename: "Issue";
  state: GH.IssueState; // "OPEN" | "CLOSED" — grounded in generated enum
  assignees: { nodes: Array<{ login: string }> };
  labels: { nodes: Array<{ name: string; color: string }> };
  milestone: { id: string; title: string; dueOn: string | null } | null;
  repository: { name: string; nameWithOwner: string };
}

export interface ProjectItemPRContent
  extends Required<Pick<GH.PullRequest, "id" | "number" | "title" | "body" | "url" | "isDraft">> {
  __typename: "PullRequest";
  state: GH.PullRequestState; // "OPEN" | "CLOSED" | "MERGED" — grounded in generated enum
  assignees: { nodes: Array<{ login: string }> };
  labels: { nodes: Array<{ name: string; color: string }> };
  repository: { name: string; nameWithOwner: string };
}

export interface ProjectItemDraftContent
  extends Required<Pick<GH.DraftIssue, "id" | "title" | "body">> {
  __typename: "DraftIssue";
  assignees: { nodes: Array<{ login: string }> };
}

// ── Board item (replaces ProjectV2Item in src/types.ts) ──────────────────────

export interface ProjectItem {
  id: string;
  type: GH.ProjectV2ItemType;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  content: ProjectItemIssueContent | ProjectItemPRContent | ProjectItemDraftContent | null;
  fieldValues: { nodes: ItemFieldValue[] };
}

// ── Field value projection (replaces ProjectV2ItemFieldValue in src/types.ts) ─
//
// Flat projection of all field value properties our queries may return, keyed
// by __typename. Each optional field corresponds to a specific generated type:
//   iterationId / title / startDate / duration → GH.ProjectV2ItemFieldIterationValue
//   name / color / optionId                    → GH.ProjectV2ItemFieldSingleSelectValue
//   number                                     → GH.ProjectV2ItemFieldNumberValue
//   text                                       → GH.ProjectV2ItemFieldTextValue
//   date                                       → GH.ProjectV2ItemFieldDateValue
//   users                                      → GH.ProjectV2ItemFieldUserValue
//   labels                                     → GH.ProjectV2ItemFieldLabelValue
//   milestone                                  → GH.ProjectV2ItemFieldMilestoneValue
//   repository                                 → GH.ProjectV2ItemFieldRepositoryValue
//
// TODO: replace with a proper discriminated union aligned to the per-type
// generated interfaces once extractBoardFields is refactored.
export interface ItemFieldValue {
  __typename: string;
  field: { id: string; name: string };
  // Iteration
  iterationId?: string;
  title?: string;
  startDate?: string;
  duration?: number;
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
  // User
  users?: { nodes: Array<{ login: string }> };
  // Label
  labels?: { nodes: Array<{ name: string; color: string }> };
  // Milestone
  milestone?: { id: string; title: string; dueOn: string | null };
  // Repository
  repository?: { name: string; nameWithOwner: string };
}

// ── Board extraction types (absorbed from raw-types.ts) ──────────────────────

/**
 * Minimal structural interface for any field-value node passed to extractBoardFields.
 * ItemFieldValue satisfies this interface structurally.
 */
export interface FieldValueNode {
  field?: { id: string } | null;
  name?: string; // single-select option display name
  title?: string; // iteration title
  number?: number; // number field value
}

/** Extracted board fields from a field-value node array. */
export interface BoardFields {
  status: string | null;
  sprint: string | null;
  story_points: number | null;
  priority: string | null;
  type: string | null; // canonical key from typeOptions; null when Type field absent or unset
}

// ── Issue detail output types (absorbed from raw-types.ts) ───────────────────

/** Comment extracted from issue timeline. Returned by buildCommentList. */
export interface Comment {
  author: string;
  body: string;
  created_at: string;
  url: string;
}

/** Linked pull request extracted from cross-references. Returned by buildLinkedPrList. */
export interface LinkedPr {
  number: number;
  title: string;
  url: string;
  state: string;
  is_draft: boolean;
}
