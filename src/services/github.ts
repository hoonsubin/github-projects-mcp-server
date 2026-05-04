import type { GraphQLResponse } from "../types.ts";
import { log } from "./logger.ts";

export const GITHUB_API_URL = "https://api.github.com/graphql";
const REQUEST_TIMEOUT_MS = 30_000;

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly graphqlErrors?: string[],
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export const getToken = (): string => {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) {
    throw new GitHubApiError(
      "GITHUB_TOKEN environment variable is not set. " +
        "Generate a token at https://github.com/settings/tokens with scopes: " +
        "read:project, project (for write), repo (for issue/PR access).",
    );
  }
  return token;
};
// ---------------------------------------------------------------------------
// GraphQL operation name extractor
// ---------------------------------------------------------------------------

/**
 * Extract a readable label from a GraphQL query string for log lines.
 * Named operations (e.g. "query GetAllProjectItems(...)") return the name.
 * Anonymous operations return "query" or "mutation".
 * Falls back to "graphql" if the string is unrecognisable.
 */
const extractOpName = (query: string): string => {
  const named = query.match(/\b(?:query|mutation)\s+(\w+)/);
  if (named) return named[1];
  const anon = query.match(/\b(query|mutation)\b/);
  return anon ? anon[1] : "graphql";
};

// documentation: https://docs.github.com/en/graphql/guides/forming-calls-with-graphql#about-queries
export const graphql = async <T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> => {
  const token = getToken();
  const op = extractOpName(query);
  const t0 = performance.now();

  log.debug(`→ graphql:${op}`, variables);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(GITHUB_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "github-projects-mcp-server/1.0.0",
        "X-Github-Next-Global-ID": "1", // opt-in to new global node IDs
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    const ms = Math.round(performance.now() - t0);
    if (err instanceof Error && err.name === "AbortError") {
      log.error(`✗ graphql:${op} timed out after ${ms}ms`);
      throw new GitHubApiError("Request timed out after 30s");
    }
    log.error(`✗ graphql:${op} network error (${ms}ms)`, err);
    throw new GitHubApiError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const ms = Math.round(performance.now() - t0);

  if (response.status === 401) {
    log.error(`✗ graphql:${op} 401 Unauthorized (${ms}ms)`);
    throw new GitHubApiError(
      "Authentication failed. Check that GITHUB_TOKEN is valid and has the required scopes.",
      401,
    );
  }
  if (response.status === 403) {
    const rateLimitReset = response.headers.get("x-ratelimit-reset");
    const resetTime = rateLimitReset
      ? new Date(Number(rateLimitReset) * 1000).toISOString()
      : "unknown";
    log.error(
      `✗ graphql:${op} 403 rate-limited (${ms}ms), resets ${resetTime}`,
    );
    throw new GitHubApiError(
      `Rate limit or permission denied. Rate limit resets at ${resetTime}.`,
      403,
    );
  }
  if (!response.ok) {
    log.error(`✗ graphql:${op} HTTP ${response.status} (${ms}ms)`);
    throw new GitHubApiError(
      `GitHub API error: HTTP ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const json = (await response.json()) as GraphQLResponse<T>;

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message);
    log.error(`✗ graphql:${op} GraphQL errors (${ms}ms)`, messages);
    throw new GitHubApiError(
      `GraphQL errors: ${messages.join("; ")}`,
      undefined,
      messages,
    );
  }

  if (json.data === undefined) {
    log.error(`✗ graphql:${op} no data returned (${ms}ms)`);
    throw new GitHubApiError("GitHub API returned no data and no errors.");
  }

  log.debug(`← graphql:${op} OK (${ms}ms)`);
  return json.data;
};

/** Format a GitHubApiError into a human-readable MCP tool error string. */
export const formatError = (err: unknown): string => {
  if (err instanceof GitHubApiError) {
    return `Error: ${err.message}`;
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Error: ${String(err)}`;
};

// ---------------------------------------------------------------------------
// enrichError — formatError + actionable fix hints for small/local LLMs
// ---------------------------------------------------------------------------
//
// Small dense models (≤9B parameters) benefit from explicit next-step
// instructions embedded in the tool response rather than having to infer
// what to do from a bare error message. enrichError() appends a "→ Fix:"
// line for every known GitHub API failure pattern so the agent can act
// without needing to reason about token permissions independently.
//
// Usage: replace formatError(err) with enrichError(err, { operation: "..." })
// in tool handlers. Falls back to formatError() for non-GitHubApiError types.

export interface EnrichErrorContext {
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
};

const TOKEN_URL = "https://github.com/settings/tokens";

/**
 * Classify a GitHubApiError and return a concrete fix hint string,
 * or null if no specific hint is available for this error.
 */
const resolveHint = (err: GitHubApiError, ctx: EnrichErrorContext): string | null => {
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
export const enrichError = (err: unknown, ctx: EnrichErrorContext = {}): string => {
  if (!(err instanceof GitHubApiError)) {
    return formatError(err);
  }
  const base = `Error: ${err.message}`;
  const hint = resolveHint(err, ctx);
  return hint ? `${base}\n\n→ Fix: ${hint}` : base;
};
