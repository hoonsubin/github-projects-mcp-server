// =============================================================================
// src/services/error-enrichment.ts — Error formatting for the framework layer
//
// enrichError is the single point where adapter errors become agent-readable text.
//
// Every GitHubApiError thrown by the adapter layer carries an explicit code and
// recovery instruction declared at the throw site. enrichError renders them as
// structured, agent-readable output.
//
// The legacy pattern-matching fallback (legacyResolveHint) has been deleted now
// that all throw sites declare explicit recovery strings.
// =============================================================================

import { GitHubApiError } from "../adapters/github/errors.ts";

// Re-export for convenience — callers can do instanceof checks from this module.
export { GitHubApiError };

// ── Non-GitHub error formatter ─────────────────────────────────────────────────

const formatNonGitHubError = (err: unknown): string =>
  err instanceof Error ? `Error: ${err.message}` : `Error: ${String(err)}`;

// ── enrichError — public API ───────────────────────────────────────────────────

/**
 * Format any error thrown by the adapter layer into agent-readable text.
 *
 * For GitHubApiError: renders as "[CODE] message\n\n→ Recovery: ..."
 * For all other errors: returns "Error: <message>".
 */
export const enrichError = (err: unknown): string => {
  if (!(err instanceof GitHubApiError)) {
    return formatNonGitHubError(err);
  }

  const detail = err.context ? `\nDetails: ${JSON.stringify(err.context)}` : "";

  return `[${err.code}] ${err.message}${detail}\n\n→ Recovery: ${err.recovery}`;
};
