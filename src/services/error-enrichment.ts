// =============================================================================
// src/services/error-enrichment.ts — Error enrichment for GitHub API failures
//
// Appends actionable fix hints to GitHubApiError messages. Designed for
// small dense models (≤9B parameters) that benefit from explicit next-step
// instructions rather than inferring fixes from bare error messages.
// =============================================================================

import { GitHubApiError } from "../adapters/github/errors.ts";

// Re-export for convenience — callers can use `enrichError` + `instanceof GitHubApiError`
// from this single module without importing from adapters/github/errors.ts directly.
export { GitHubApiError };

// ---------------------------------------------------------------------------
// enrichError — actionable fix hints for small/local LLMs
// ---------------------------------------------------------------------------

interface ErrorEnrichmentContext {
  /**
   * The tool operation name (e.g. "get_repo_file", "create_issue").
   * Used to include the exact token permission required by that operation.
   */
  operation?: string;
}

/** Maps operation names to the fine-grained token permission they require. */
const REQUIRED_PERMISSION: Record<string, string> = {
  graphql: "Contents: Read (or the permission required by the queried resource)",
  get_repo_file: "Contents: Read",
  create_issue: "Issues: Read and write",
  update_issue: "Issues: Read and write",
  create_comment: "Issues: Read and write",
  write_repo_file: "Contents: Read and write",
  get_issue_timeline: "Issues: Read",
  get_audit_log: "Organization: Read (Enterprise only — requires GHES or GHEC)",
};

const TOKEN_URL = "https://github.com/settings/tokens";

/**
 * Classify a GitHubApiError and return a concrete fix hint string,
 * or null if no specific hint is available for this error.
 */
const resolveHint = (err: GitHubApiError, ctx: ErrorEnrichmentContext): string | null => {
  const scopeNeeded = ctx.operation ? REQUIRED_PERMISSION[ctx.operation] : undefined;

  // ── HTTP-level errors ───────────────────────────────────────────────────

  if (err.statusCode === 401) {
    return (
      "Your GITHUB_TOKEN is invalid or expired. " +
      `Generate a new fine-grained personal access token at ${TOKEN_URL} ` +
      "with at minimum: Projects (read/write), Issues (read/write), " +
      "Contents (read/write if using file tools), Metadata (read-only)."
    );
  }

  if (err.statusCode === 403) {
    if (/rate limit/i.test(err.message)) {
      return "Wait until the reset time shown above, then retry the same request.";
    }
    return (
      "Permission denied. " +
      (scopeNeeded ? `This operation requires '${scopeNeeded}' on your token. ` : "") +
      `Update your fine-grained token at ${TOKEN_URL} and restart the server.`
    );
  }

  // ── GraphQL-level errors (HTTP 200, errors array in response body) ───────

  if (!err.graphqlErrors?.length) return null;

  const msgs = err.graphqlErrors.join(" ");

  if (/Could not resolve to a Repository/i.test(msgs)) {
    return (
      "The repository was not found or your token cannot access it. Check: " +
      "(1) owner and repo name are spelled correctly, " +
      "(2) your fine-grained token explicitly grants access to that repository, " +
      "(3) the repository exists and has not been deleted or transferred."
    );
  }

  if (/Resource not accessible by personal access token/i.test(msgs)) {
    return (
      "Your token is missing a required permission. " +
      (scopeNeeded ? `Add '${scopeNeeded}' to your token. ` : "") +
      `Regenerate it at ${TOKEN_URL}.`
    );
  }

  if (/must have push access|write access required|write permission/i.test(msgs)) {
    const writeScope = scopeNeeded ?? "Contents: Read and write (or Issues: Read and write)";
    return (
      `Write access denied. Your token needs '${writeScope}'. ` +
      `Update it at ${TOKEN_URL} and restart the server.`
    );
  }

  if (/Field .+? doesn't exist on type|Cannot query field|Unknown argument/i.test(msgs)) {
    return (
      "The GraphQL query references an invalid field, argument, or type. " +
      "Revise the query: start with `query { viewer { login } }` to confirm " +
      "connectivity, then add fields one at a time until the error reappears."
    );
  }

  if (/Variable .+? of type .+? was provided invalid value|Expected type /i.test(msgs)) {
    return (
      "A query variable has the wrong type or value format. " +
      "Check that variable types match the schema " +
      "(e.g. node IDs are String, not Int; dates are ISO strings like '2025-06-01')."
    );
  }

  return null;
};

/**
 * Like formatError(), but appends a concrete `→ Fix:` hint for known GitHub
 * API error patterns. Falls back to formatError() for non-GitHubApiError types.
 */
export const enrichError = (err: unknown, ctx: ErrorEnrichmentContext = {}): string => {
  if (err instanceof GitHubApiError) {
    const base = `Error: ${err.message}`;
    const hint = resolveHint(err, ctx);
    return hint ? `${base}\n\n→ Fix: ${hint}` : base;
  }
  // formatError inlined for non-GitHubApiError fallback
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Error: ${String(err)}`;
};
