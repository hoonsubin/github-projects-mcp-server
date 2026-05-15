// =============================================================================
// src/adapters/github/errors.ts — GitHubApiError class
//
// GitHubApiError is the canonical exception thrown by all GitHub adapter code.
// Every throw site declares a machine-readable code, an agent recovery instruction,
// and optional structured context — making errors actionable at every layer.
// =============================================================================

// ── Error code taxonomy ────────────────────────────────────────────────────────

export type GitHubErrorCode =
  // Resource state
  | "NOT_FOUND" // item / issue / user / project deleted or ID stale
  | "DRAFT_ISSUE_CONSTRAINT" // operation requires a real Issue, not a DraftIssue
  | "WRONG_CONTENT_TYPE" // project item is not an Issue (e.g. a PullRequest)
  // Platform configuration
  | "FIELD_NOT_CONFIGURED" // project field not set up in GitHub Projects
  | "OPTION_NOT_FOUND" // vocabulary value missing from project field options
  // API mutations
  | "MUTATION_FAILED" // mutation completed but returned no data
  // GitHub API transport
  | "AUTH_FAILED" // 401 — token invalid or expired
  | "RATE_LIMITED" // 403 + x-ratelimit-reset header present
  | "PERMISSION_DENIED" // 403 without rate-limit header
  | "GRAPHQL_ERROR" // errors array in GraphQL response body
  | "NETWORK_ERROR" // timeout or TCP/network failure
  | "HTTP_ERROR"; // non-2xx catch-all

// ── Exhaustiveness helper ──────────────────────────────────────────────────────

/**
 * Use at the default branch of any switch(err.code) to get a compile-time
 * guarantee that all GitHubErrorCode values are handled.
 *
 *   switch (err.code) {
 *     case "NOT_FOUND": ...
 *     ...
 *     default: assertNever(err.code);
 *   }
 */
export const assertNever = (x: never): never => {
  throw new Error(`Unhandled GitHubErrorCode: ${String(x)}`);
};

// ── Parameter object ───────────────────────────────────────────────────────────

export interface GitHubApiErrorParams {
  code: GitHubErrorCode;
  /** Agent recovery instruction: what the agent should do next to resolve this error. */
  recovery: string;
  statusCode?: number;
  /**
   * Structured key/value detail (resource IDs, field names, operation names).
   * Tech debt: replace with a discriminated union keyed on `code` once the
   * per-code shapes stabilise.
   */
  context?: Record<string, unknown>;
  /**
   * Raw GraphQL error messages from the GitHub API.
   * Tech debt: demote to context.rawErrors and remove this field once
   * legacyResolveHint in error-enrichment.ts is deleted.
   */
  graphqlErrors?: string[];
}

// ── GitHubApiError class ───────────────────────────────────────────────────────

export class GitHubApiError extends Error {
  override readonly name = "GitHubApiError";
  readonly code: GitHubErrorCode;
  readonly recovery: string;
  readonly statusCode?: number;
  readonly context?: Record<string, unknown>;
  readonly graphqlErrors?: string[];

  constructor(message: string, params: GitHubApiErrorParams) {
    super(message);
    this.code = params.code;
    this.recovery = params.recovery;
    this.statusCode = params.statusCode;
    this.context = params.context;
    this.graphqlErrors = params.graphqlErrors;
  }
}
