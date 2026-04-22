import type { GraphQLResponse } from "../types.ts";
import { log } from "./logger.ts";

const GITHUB_API_URL = "https://api.github.com/graphql";
const REQUEST_TIMEOUT_MS = 30_000;

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly graphqlErrors?: string[]
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

const getToken = (): string => {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) {
    throw new GitHubApiError(
      "GITHUB_TOKEN environment variable is not set. " +
        "Generate a token at https://github.com/settings/tokens with scopes: " +
        "read:project, project (for write), repo (for issue/PR access)."
    );
  }
  return token;
}
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
  variables: Record<string, unknown> = {}
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
      `Network error: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timeout);
  }

  const ms = Math.round(performance.now() - t0);

  if (response.status === 401) {
    log.error(`✗ graphql:${op} 401 Unauthorized (${ms}ms)`);
    throw new GitHubApiError(
      "Authentication failed. Check that GITHUB_TOKEN is valid and has the required scopes.",
      401
    );
  }
  if (response.status === 403) {
    const rateLimitReset = response.headers.get("x-ratelimit-reset");
    const resetTime = rateLimitReset
      ? new Date(Number(rateLimitReset) * 1000).toISOString()
      : "unknown";
    log.error(`✗ graphql:${op} 403 rate-limited (${ms}ms), resets ${resetTime}`);
    throw new GitHubApiError(
      `Rate limit or permission denied. Rate limit resets at ${resetTime}.`,
      403
    );
  }
  if (!response.ok) {
    log.error(`✗ graphql:${op} HTTP ${response.status} (${ms}ms)`);
    throw new GitHubApiError(
      `GitHub API error: HTTP ${response.status} ${response.statusText}`,
      response.status
    );
  }

  const json = (await response.json()) as GraphQLResponse<T>;

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message);
    log.error(`✗ graphql:${op} GraphQL errors (${ms}ms)`, messages);
    throw new GitHubApiError(
      `GraphQL errors: ${messages.join("; ")}`,
      undefined,
      messages
    );
  }

  if (json.data === undefined) {
    log.error(`✗ graphql:${op} no data returned (${ms}ms)`);
    throw new GitHubApiError("GitHub API returned no data and no errors.");
  }

  log.debug(`← graphql:${op} OK (${ms}ms)`);
  return json.data;
}

/** Format a GitHubApiError into a human-readable MCP tool error string. */
export const formatError = (err: unknown): string => {
  if (err instanceof GitHubApiError) {
    return `Error: ${err.message}`;
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Error: ${String(err)}`;
}
