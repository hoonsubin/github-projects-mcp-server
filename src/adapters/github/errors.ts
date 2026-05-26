// =============================================================================
// src/adapters/github/errors.ts — GitHubApiError class
//
// GitHubApiError is the canonical exception thrown by all GitHub adapter code.
// Every throw site declares a machine-readable code, an agent recovery instruction,
// and optional structured context — making errors actionable at every layer.
// =============================================================================

import { AdapterError } from "../../domain/errors.ts";
import type { SupportedBackend } from "../../domain/types.ts";

// ── Error code taxonomy ────────────────────────────────────────────────────────

export type GitHubErrorCode =
  // Resource state
  | "NOT_FOUND" // item / issue / user / project deleted or ID stale
  | "DRAFT_ISSUE_CONSTRAINT" // operation requires a real Issue, not a DraftIssue
  | "RESOLUTION_FAILED" // unable to resolve a StoryRef to an issue number for dependencies
  | "WRONG_CONTENT_TYPE" // project item is not an Issue (e.g. a PullRequest)
  // Platform capability
  | "NOT_IMPLEMENTED" // feature not supported by this adapter or the underlying API
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

interface GitHubApiErrorParams {
  code: GitHubErrorCode;
  /** Agent recovery instruction: what the agent should do next to resolve this error. */
  recovery: string;
  statusCode?: number;
  /**
   * Structured key/value detail (resource IDs, field names, operation names).
   * per-code shapes stabilise.
   */
  context?: Record<string, unknown>;
  /**
   * Raw GraphQL error messages from the GitHub API.
   * legacyResolveHint in error-enrichment.ts is deleted.
   */
  graphqlErrors?: string[];
}

// ── GitHubApiError class ───────────────────────────────────────────────────────

export class GitHubApiError extends AdapterError {
  override readonly backendName: SupportedBackend = "github";
  override readonly name = "GitHubApiError";
  override readonly code: GitHubErrorCode;
  override readonly recovery: string;
  readonly statusCode?: number;
  readonly graphqlErrors?: string[];

  constructor(message: string, params: GitHubApiErrorParams) {
    super(message, params.context);
    this.code = params.code;
    this.recovery = params.recovery;
    this.statusCode = params.statusCode;
    this.graphqlErrors = params.graphqlErrors;
  }
}

// ── NOT_IMPLEMENTED throw helper ───────────────────────────────────────────────

/**
 * Throw a NOT_IMPLEMENTED GitHubApiError for a feature that the GitHub adapter
 * or the underlying API does not yet support. Use at adapter layer throw sites
 * so the backend assembly layer can catch via catchBackend and emit a warning.
 */
export const notImplemented = (
  feature: string,
  context: Record<string, unknown> = {},
): never => {
  throw new GitHubApiError(
    `"${feature}" is not supported by the GitHub adapter.`,
    {
      code: "NOT_IMPLEMENTED",
      recovery: `This feature is not yet available via the GitHub Projects API. ` +
        `No action is required — the field will be null in the response.`,
      context,
    },
  );
};
