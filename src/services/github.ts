import type { GraphQLResponse } from "../types.ts";

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
// documentation: https://docs.github.com/en/graphql/guides/forming-calls-with-graphql#about-queries
export const graphql = async <T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> => {
  const token = getToken();

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
    if (err instanceof Error && err.name === "AbortError") {
      throw new GitHubApiError("Request timed out after 30s");
    }
    throw new GitHubApiError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
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
    throw new GitHubApiError(
      `Rate limit or permission denied. Rate limit resets at ${resetTime}.`,
      403
    );
  }
  if (!response.ok) {
    throw new GitHubApiError(
      `GitHub API error: HTTP ${response.status} ${response.statusText}`,
      response.status
    );
  }

  const json = (await response.json()) as GraphQLResponse<T>;

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message);
    throw new GitHubApiError(
      `GraphQL errors: ${messages.join("; ")}`,
      undefined,
      messages
    );
  }

  if (json.data === undefined) {
    throw new GitHubApiError("GitHub API returned no data and no errors.");
  }

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
