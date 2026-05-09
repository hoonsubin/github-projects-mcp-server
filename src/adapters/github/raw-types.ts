// =============================================================================
// src/adapters/github/raw-types.ts — GitHub-specific raw types
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// These are pure declarations — no logic. All GitHub schema knowledge
// is confined to the adapter layer.
// =============================================================================

// ── Raw GraphQL response types ─────────────────────────────────────────────────

/** Raw field-value node from project items query. */
export interface RawFieldValue {
  field?: { id: string } | null;
  name?: string; // single-select display name
  optionId?: string;
  number?: number; // number field value
  title?: string; // iteration title
  iterationId?: string;
  startDate?: string;
  duration?: number;
}

/** Raw content node (Issue or DraftIssue). */
export interface RawContent {
  id: string;
  number?: number;
  title: string;
  body?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  assignees?: { nodes: Array<{ login: string }> };
  labels?: { nodes: Array<{ name: string }> };
  milestone?: { title: string } | null;
}

/** Raw project item node. */
export interface RawItem {
  id: string;
  content: RawContent | null;
  fieldValues: { nodes: RawFieldValue[] };
}

/** GraphQL response for fetching project items. */
export interface GetProjectItemsResponse {
  user?: {
    projectV2?: {
      items: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RawItem[];
      };
    } | null;
  } | null;
}

/** GraphQL response for fetching issue details. */
export interface GetIssueDetailsResponse {
  node?: {
    id?: string;
    number?: number;
    title?: string;
    body?: string;
    url?: string;
    createdAt?: string;
    updatedAt?: string;
    assignees?: { nodes: Array<{ login: string }> };
    labels?: { nodes: Array<{ name: string }> };
    milestone?: { title: string } | null;
    comments?: {
      nodes: Array<{
        id: string;
        author?: { login: string } | null;
        body: string;
        createdAt: string;
        url: string;
      }>;
    };
    timelineItems?: {
      nodes: Array<{
        source?: {
          number?: number;
          title?: string;
          url?: string;
          state?: string;
          isDraft?: boolean;
        } | null;
      }>;
    };
  } | null;
}

/** GraphQL response for fetching item fields. */
export interface GetItemFieldsResponse {
  node?: {
    fieldValues?: { nodes: RawFieldValue[] };
  } | null;
}

/** Repository labels response. */
export interface RepoLabelsResponse {
  repository?: {
    labels?: {
      nodes: Array<{ name: string; color: string; description: string }>;
    };
  };
}

// ── Comment and Linked PR types ────────────────────────────────────────────────

/** Comment extracted from issue timeline. */
export interface Comment {
  author: string;
  body: string;
  created_at: string;
  url: string;
}

/** Comment node from GraphQL response. */
export interface CommentNode {
  author?: { login: string } | null;
  body: string;
  createdAt: string;
  url: string;
}

/** Linked pull request extracted from cross-references. */
export interface LinkedPr {
  number: number;
  title: string;
  url: string;
  state: string;
  is_draft: boolean;
}

/** Cross-referenced event node from timeline. */
export interface CrossReferencedEventNode {
  source?: {
    number?: number | null;
    title?: string | null;
    url?: string | null;
    state?: string | null;
    isDraft?: boolean | null;
  } | null;
}

// ── Field-value minimal interface ──────────────────────────────────────────────

/**
 * Minimal interface for any field-value node that carries board fields.
 * Works on both RawFieldValue and GET_ITEM_FIELDS_QUERY shapes.
 */
export interface FieldValueNode {
  field?: { id: string } | null;
  name?: string; // single-select option display name
  title?: string; // iteration title
  number?: number; // number field value
}

/** Extracted board fields from any field-value node array. */
export interface BoardFields {
  status: string | null;
  sprint: string | null;
  story_points: number | null;
  priority: string | null;
}

// ── Typed inner node from GET_ISSUE_DETAILS_QUERY response ─────────────────────

/** Typed inner node from GET_ISSUE_DETAILS_QUERY response. */
export interface IssueDetailsNode {
  id: string;
  number: number;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
  assignees?: { nodes: Array<{ login: string }> };
  labels?: { nodes: Array<{ name: string }> };
  milestone?: { title: string } | null;
  comments?: { nodes: CommentNode[] };
  timelineItems?: { nodes: CrossReferencedEventNode[] };
}

// ── Burndown internals ─────────────────────────────────────────────────────────

/** Result of the completion-timestamp resolution step. */
export interface CompletionResult {
  completions: Map<number, string>;
  data_source: "audit_log" | "issue_close_proxy";
  warning?: string;
}
