// =============================================================================
// src/adapters/github/types.ts - GitHub adapter projection types
//
// Single source of truth for all GitHub API types used by this adapter:
//
//   - GitHubBackendConfig     - platform-specific connection config
//   - GraphQLResponse<T>      - generic response envelope
//   - ItemContentType         - alias of the generated ProjectV2ItemType enum
//   - ProjectItem*            - query-specific projections of GH.Issue / PullRequest / DraftIssue
//   - ProjectItem             - the full project board item (replaces ProjectV2Item)
//   - ItemFieldValue          - flat field-value projection (replaces ProjectV2ItemFieldValue)
//   - FieldValueNode          - minimal structural interface for extractBoardFields
//   - BoardFields             - board field extraction output
//   - Comment / LinkedPr      - issue detail output shapes
//   - ResolvedToken           - branded token type for compile-time safety
//
// Nothing in the domain layer (src/domain/, src/scrum/) imports from this file.
// =============================================================================

import type * as GH from "./generated/github-types.ts";
import type {
  DependencyEntry,
  EntityRef,
  EpicRef,
  ItemType,
  StoryBase,
} from "../../domain/types.ts";
import { GitHubApiError } from "./errors.ts";

// ── Adapter-internal branded node ID types ───────────────────────────────────
//
// These branded string types distinguish GitHub's three node ID formats at
// compile time. The domain layer sees only opaque EntityRef { id: string }.
// These brands never cross the port boundary - use toEntityRef() to erase
// the brand when returning to the domain/port layers.

/**
 * GitHub Projects v2 item node ID (PVTI_... prefix).
 * This is the canonical project item handle used in all domain-facing ref.id values.
 * Returned by every read tool; passed to every write tool.
 */
export type GitHubItemId = string & { readonly _brand: "GitHubItemId" };

/**
 * GitHub Issue node ID (I_... prefix).
 * Used internally by the adapter for issue-specific GraphQL operations
 * (detailed issue queries, label mutations, comment posting).
 * NEVER exposed as ref.id to the domain layer - always resolve to GitHubItemId first.
 */
export type GitHubIssueId = string & { readonly _brand: "GitHubIssueId" };

/**
 * GitHub Milestone node ID (MI_... prefix).
 * Used for epic references (EpicRef.id).
 */
export type GitHubMilestoneId = string & { readonly _brand: "GitHubMilestoneId" };

/**
 * Erase the GitHub node ID brand and produce a domain-safe EntityRef.
 *
 * This is the port-boundary crossing point for item IDs: everything on the
 * left is GitHub-specific; everything on the right is universal domain vocabulary.
 * Call this at every adapter boundary where a GitHubItemId returns to the
 * port or domain layer.
 *
 * Renamed from: toResolvedRef
 */
export const toEntityRef = (itemId: GitHubItemId): EntityRef => ({ id: itemId });

// ── GitHub backend connection config (moved from src/types.ts) ───────────────

/**
 * GitHub-specific backend configuration.
 * All values here are platform-specific - the use-case layer never reads this directly.
 * Auth values are $ENV_VAR references resolved by the config loader at startup.
 */
/** GitHub account type. */
export type OwnerType = "user" | "org";

export interface GitHubBackendConfig {
  auth: {
    token: string; // resolved from $GITHUB_TOKEN or literal value
  };
  owner: string;
  owner_type: OwnerType;
  project_number: number;
  tracked_repos: string[];
  /** Platform identity for team members. `ref` cross-references project.team[].name. */
  team?: Array<{
    ref: string;
    login: string;
  }>;
  /** Maps canonical Scrum field names to exact GitHub project field names. */
  field_mapping: {
    sprint: string; // REQUIRED - ITERATION type field
    status: string; // REQUIRED - SINGLE_SELECT type field
    story_points?: string; // optional - NUMBER type field
    priority?: string; // optional - SINGLE_SELECT type field
    item_type?: string; // optional - SINGLE_SELECT type field for story type
    epic?: string; // optional - field used to track epic association on the board
    assignee?: string; // optional - field used to track assignees on the board
  };
  /** Maps canonical status keys → exact GitHub single-select option names. */
  status_display: Record<string, string>;
  /** Maps canonical priority keys → exact GitHub single-select option names. */
  priority_display: Record<string, string>;
  /**
   * Maps canonical type keys to their board display name and an optional repo-relative
   * template file path. Required when field_mapping.item_type is set.
   *
   * Each entry is a contract with the agent: the MCP will expose this type in
   * vocabulary.type and (when template is declared) in vocabulary.template_uris.
   * The set of keys is open - teams may add custom types beyond the built-in PBI set.
   * The server validates each display name against live board options at startup and
   * surfaces a decorated error for any key whose display name is not found on the board.
   *
   * Example:
   *   feature:
   *     display: "Feature"
   *     template: .github/ISSUE_TEMPLATE/feature.md
   *   bug:
   *     display: "Bug"
   */
  type_mapping?: Record<string, { display: string; template?: string }>;
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
 * title-case ("Issue", "PullRequest", "DraftIssue") - these are separate fields.
 */
export type ItemContentType = GH.ProjectV2ItemType;

// ── Named field sets (avoids repeated Pick expressions) ──────────────────────
//
// Each alias names a coherent subset of a generated GH.* type. Interfaces compose
// these aliases so readers see *what* the shape represents, not *how* it is built.
// These are exported so mappers.ts and other internal modules can reuse them.

/** Core identity fields shared by Issue, PullRequest, and DraftIssue. */
export type IssueIdentity = Required<Pick<GH.Issue, "id" | "number" | "title" | "body" | "url">>;

/** Minimal PR identity: same five core fields from GH.PullRequest. */
export type PrIdentity = Required<Pick<GH.PullRequest, "id" | "number" | "title" | "body" | "url">>;

/** PR discriminator field (isDraft) - compose with PrIdentity for full PR identity. */
export type PrDiscriminator = Required<Pick<GH.PullRequest, "isDraft">>;

/** PR state enum (OPEN | CLOSED | MERGED). */
export type PrState = GH.PullRequestState;

/** Issue state enum (OPEN | CLOSED). */
export type IssueState = GH.IssueState;

/** Minimal milestone reference (id + title). */
export type MilestoneRef = Required<Pick<GH.Milestone, "id" | "title">>;

/** Issue reference stub (id + number + title) for dependency connections. */
export type IssueRef = Required<Pick<GH.Issue, "id" | "number" | "title">>;

/** Label stub (name + color) for connection nodes. */
export type LabelRef = Required<Pick<GH.Label, "name" | "color">>;

/** Label-only stub (name) - used in IssueDetailsInput.labels. */
export type LabelNameOnly = Required<Pick<GH.Label, "name">>;

/** User login stub - used in author/assignee connections. */
export type UserLogin = Required<Pick<GH.User, "login">>;

/** IssueComment projection: body + createdAt + url. */
export type CommentProjection = Required<Pick<GH.IssueComment, "body" | "createdAt" | "url">>;

/** PullRequest projection for timeline cross-reference events. */
export type TimelinePrSource = Required<
  Pick<GH.PullRequest, "number" | "title" | "url" | "state" | "isDraft">
>;

/** ProjectV2SingleSelectFieldOption stub (id + name + color + description). */
export type SelectFieldOption = Required<
  Pick<GH.ProjectV2SingleSelectFieldOption, "id" | "name" | "color" | "description">
>;

/** ProjectV2SingleSelectField projection - id + name + dataType + options. */
export type SelectFieldNode =
  & Required<
    Pick<GH.ProjectV2SingleSelectField, "id" | "name" | "dataType">
  >
  & {
    options: SelectFieldOption[];
  };

/** PageInfo projection - hasNextPage + endCursor. */
export type PageInfoRef = Required<Pick<GH.PageInfo, "hasNextPage" | "endCursor">>;

/** ProjectV2 projection - id only. */
export type ProjectV2Ref = Required<Pick<GH.ProjectV2, "id">>;

/** ProjectV2Item projection - id + type + createdAt + updatedAt + isArchived. */
export type ProjectV2ItemRef = Required<
  Pick<GH.ProjectV2Item, "id" | "type" | "createdAt" | "updatedAt" | "isArchived">
>;

// ── Content projection types ──────────────────────────────────────────────────
//
// These replace the hand-rolled ProjectV2IssueContent / ProjectV2PRContent /
// ProjectV2DraftIssueContent types from src/types.ts.
//
// Design: scalar fields that exist on the generated GH.* interfaces are declared
// via the named aliases above so the compiler validates them against the schema.
// Nested connection fields (assignees, labels, milestone) are defined as inline
// query-projection shapes - narrower than the full schema types - matching exactly
// what our GraphQL fragments fetch.

export interface ProjectItemIssueContent extends IssueIdentity {
  __typename: "Issue";
  state: GH.IssueState;
  assignees: AssigneeNodes;
  labels: LabelColorNodes;
  milestone: MilestoneRefNode | null;
  repository: FieldValueRepository;
  blockedBy?: { nodes: IssueRefNode[] };
}

export interface ProjectItemPRContent extends PrIdentity, PrDiscriminator {
  __typename: "PullRequest";
  state: GH.PullRequestState;
  assignees: AssigneeNodes;
  labels: LabelColorNodes;
  repository: FieldValueRepository;
}

export interface ProjectItemDraftContent
  extends Required<Pick<GH.DraftIssue, "id" | "title" | "body">> {
  __typename: "DraftIssue";
  assignees: AssigneeNodes;
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
// by __typename. Each optional field corresponds to a specific generated type
// (see the inline type-assertion comments below).
//
// Sub-shapes are grounded in GH.* types via Pick; the flat scalar fields
// (iterationId, title, startDate, duration, text, number, date, name, color,
// optionId) are derived from the respective GH.ProjectV2ItemField*Value types.

/** Query projection of GH.ProjectV2FieldCommon - we only fetch id + name. */
export type FieldValueField = Required<Pick<GH.ProjectV2FieldCommon, "id" | "name">>;

/** Query projection of GH.User - we only fetch login. */
export type FieldValueUser = Pick<GH.User, "login">;

/** Query projection of GH.UserConnection.nodes - flat array of login-only users. */
export type FieldValueUserNodes = Required<Pick<GH.UserConnection, "nodes">> & {
  nodes: FieldValueUser[];
};

/** Query projection of GH.Label - we only fetch name + color. */
export type FieldValueLabel = Required<Pick<GH.Label, "name" | "color">>;

/** Query projection of GH.LabelConnection.nodes - flat array of name+color labels. */
export type FieldValueLabelNodes = Required<Pick<GH.LabelConnection, "nodes">> & {
  nodes: FieldValueLabel[];
};

/** Query projection of GH.Milestone - we only fetch id + title + dueOn. */
export type FieldValueMilestone = Required<Pick<GH.Milestone, "id" | "title">> & {
  dueOn: GH.Milestone["dueOn"];
};

/** Query projection of GH.Repository - we only fetch name + nameWithOwner. */
export type FieldValueRepository = Required<Pick<GH.Repository, "name" | "nameWithOwner">>;

/** Minimal assignees connection for content projections - login-only, non-nullable nodes. */
export type AssigneeNodes = { nodes: Array<{ login: string }> };

/** Minimal labels connection for content projections - name + color, non-nullable nodes. */
export type LabelColorNodes = { nodes: Array<{ name: string; color: string }> };

/** Issue node stub used in blockedBy / blocking connection nodes. */
export type IssueRefNode = Required<Pick<GH.Issue, "id" | "number" | "title">>;

/** Minimal milestone reference used in issue content projections (no dueOn - use FieldValueMilestone where dueOn is needed). */
export type MilestoneRefNode = Required<Pick<GH.Milestone, "id" | "title">>;

export interface ItemFieldValue {
  __typename: string;
  field: FieldValueField;
  // Iteration (GH.ProjectV2ItemFieldIterationValue)
  iterationId?: string;
  title?: string;
  startDate?: string;
  duration?: number;
  // Text (GH.ProjectV2ItemFieldTextValue)
  text?: string;
  // Number (GH.ProjectV2ItemFieldNumberValue)
  number?: number;
  // Date (GH.ProjectV2ItemFieldDateValue)
  date?: string;
  // Single-select (GH.ProjectV2ItemFieldSingleSelectValue)
  name?: string;
  color?: string;
  optionId?: string;
  // User (GH.ProjectV2ItemFieldUserValue)
  users?: FieldValueUserNodes;
  // Label (GH.ProjectV2ItemFieldLabelValue)
  labels?: FieldValueLabelNodes;
  // Milestone (GH.ProjectV2ItemFieldMilestoneValue)
  milestone?: FieldValueMilestone;
  // Repository (GH.ProjectV2ItemFieldRepositoryValue)
  repository?: FieldValueRepository;
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
  type: ItemType | null; // canonical key from typeOptions; null when Type field absent or unset
}

// ── Issue detail output types (absorbed from raw-types.ts) ───────────────────

/** Linked pull request extracted from cross-references. Returned by buildLinkedPrList. */
export interface LinkedPr {
  number: number;
  title: string;
  url: string;
  state: string;
  is_draft: boolean;
}

/** A GitHub Projects draft issue - has no issue number, URL, or milestone. */
export interface DraftStory extends StoryBase {
  kind: "draft";
  key: null;
  url: null;
  epic: null;
  blocked_by: DependencyEntry[]; // always [] - Draft Issues have no tracked dependencies
}

/** A real GitHub Issue (or PR) promoted to a project item. */
export interface IssueStory extends StoryBase {
  kind: "issue";
  key: string; // human-readable issue number, e.g. "42"
  url: string; // canonical URL in the backend UI
  epic: { ref: EpicRef; name: string } | null;
}

// ── Auth token types ──────────────────────────────────────────────────────────

/**
 * A token value that has been resolved from its environment variable.
 * Never a "$VAR" reference — always a literal bearer token.
 */
export type ResolvedToken = string & { readonly _brand: "ResolvedToken" };

/**
 * Resolve a raw auth.token value — resolves "$VAR" refs, passes literals through.
 * Called exactly once in the adapter factory.
 *
 * Throws GitHubApiError (not Error) so auth failures follow the same structured
 * error-handling path as all other adapter errors.
 */
export const resolveToken = (raw: string, configDesc: string): ResolvedToken => {
  if (!raw.startsWith("$")) return raw as ResolvedToken;
  const varName = raw.slice(1);
  const resolved = Deno.env.get(varName);
  if (!resolved) {
    throw new GitHubApiError(
      `Config error in ${configDesc}: backends.github.auth.token references ` +
        `$${varName} but that environment variable is not set.`,
      {
        code: "AUTH_FAILED",
        recovery:
          `Set the ${varName} environment variable to a fine-grained personal access token ` +
          `generated at https://github.com/settings/tokens with at minimum: ` +
          `Projects (read/write), Issues (read/write), Metadata (read-only).`,
      },
    );
  }
  return resolved as ResolvedToken;
};

/**
 * GitHub token prefixes as of 2024:
 *   ghp_       — classic personal access tokens
 *   github_pat_ — fine-grained personal access tokens
 *   ghs_       — GitHub Apps installation tokens
 */
const TOKEN_SYNTAX = /^(ghp_|github_pat_|ghs_)[A-Za-z0-9_]+$/;

/**
 * Validate a resolved token's syntax before any API call is made.
 *
 * The empty-string check is safety-critical — prevents sending an empty
 * bearer token to GitHub. The prefix check is a best-effort early warning;
 * if GitHub introduces new token formats, widen the regex rather than
 * working around it.
 */
export const validateToken = (token: ResolvedToken, configDesc: string): void => {
  if (token.length === 0) {
    throw new GitHubApiError(
      `${configDesc}: backends.github.auth.token resolved to an empty string.`,
      {
        code: "AUTH_FAILED",
        recovery:
          "Check that the environment variable referenced in auth.token is set and non-empty.",
      },
    );
  }
  if (!TOKEN_SYNTAX.test(token)) {
    throw new GitHubApiError(
      `GitHub token syntax validation failed in ${configDesc}. ` +
        `Expected a classic (ghp_...), fine-grained (github_pat_...), ` +
        `or installation (ghs_...) token.`,
      {
        code: "AUTH_FAILED",
        recovery:
          "Check that the env var referenced in backends.github.auth.token contains the correct token. " +
          "Generate a new token at https://github.com/settings/tokens if needed.",
      },
    );
  }
};
