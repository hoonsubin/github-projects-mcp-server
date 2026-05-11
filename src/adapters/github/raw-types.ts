// =============================================================================
// src/adapters/github/raw-types.ts — GitHub adapter domain projection types
//
// Only types that are genuine domain abstractions with no equivalent in
// src/generated/github-types.ts or src/types.ts live here.
//
// GitHub API raw types (RawItem, RawFieldValue, RawContent, response wrappers,
// CommentNode, CrossReferencedEventNode, IssueDetailsNode) have been removed.
// Use ProjectV2Item and related types from src/types.ts instead. Local
// response shapes in backend.ts and mappers.ts serve the one-off query paths.
// =============================================================================

// ── Board field projection ─────────────────────────────────────────────────────

/**
 * Minimal structural interface for any field-value node used by extractBoardFields.
 * ProjectV2ItemFieldValue from src/types.ts satisfies this interface structurally,
 * so callers can pass either type without an explicit cast.
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
}

// ── Issue detail output types ──────────────────────────────────────────────────

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
