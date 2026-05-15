// =============================================================================
// src/adapters/github/internal/http-client.ts — GitHub HTTP transport layer
//
// Extracted from services/github.ts as part of Phase C (Structural Cleanup).
// Provides GraphQL and REST transport to the GitHub API.
// =============================================================================

import type { GraphQLResponse } from "../types.ts";
import { log } from "../../../services/logger.ts";
import { GitHubApiError } from "../errors.ts";

const GITHUB_API_URL = "https://api.github.com/graphql";
const REST_API_URL = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 30_000;

// ── REST API response wrapper ───────────────────────────────────────────────────

/**
 * Typed wrapper for REST API responses.
 *
 * Returns both `data` and `linkHeader` so callers can paginate via the
 * Link header without a second HTTP round-trip. Non-paginating callers
 * simply ignore `linkHeader`.
 */
export interface RestResponse<T> {
  data: T;
  linkHeader: string | null;
}

/**
 * Unified client interface for GitHub HTTP transport.
 * Enables dependency inversion and easy mocking in tests.
 */
export interface GitHubClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  rest<T>(
    path: string,
    options?: {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      params?: Record<string, string>;
      body?: unknown;
      accept?: string;
    },
  ): Promise<RestResponse<T>>;
}

const getToken = (): string => {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) {
    throw new GitHubApiError(
      "GITHUB_TOKEN environment variable is not set.",
      {
        code: "AUTH_FAILED",
        recovery: "Set GITHUB_TOKEN to a fine-grained personal access token generated at " +
          "https://github.com/settings/tokens with at minimum: " +
          "Projects (read/write), Issues (read/write), Metadata (read-only).",
      },
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
      log.debug(`✗ graphql:${op} timed out after ${ms}ms`);
      throw new GitHubApiError("GraphQL request timed out after 30s.", {
        code: "NETWORK_ERROR",
        recovery:
          "Check your network connection and retry. If timeouts persist, GitHub may be experiencing an outage.",
      });
    }
    log.debug(`✗ graphql:${op} network error (${ms}ms)`, err);
    throw new GitHubApiError(
      `GraphQL network error: ${err instanceof Error ? err.message : String(err)}`,
      {
        code: "NETWORK_ERROR",
        recovery: "Check your network connection and retry.",
      },
    );
  } finally {
    clearTimeout(timeout);
  }

  const ms = Math.round(performance.now() - t0);

  if (response.status === 401) {
    log.debug(`✗ graphql:${op} 401 Unauthorized (${ms}ms)`);
    throw new GitHubApiError(
      "GraphQL authentication failed (HTTP 401).",
      {
        code: "AUTH_FAILED",
        statusCode: 401,
        recovery: "Your GITHUB_TOKEN is invalid or expired. Generate a new fine-grained token at " +
          "https://github.com/settings/tokens with: Projects (read/write), " +
          "Issues (read/write), Metadata (read-only). Then restart the server.",
      },
    );
  }
  if (response.status === 403) {
    const rateLimitReset = response.headers.get("x-ratelimit-reset");
    if (rateLimitReset) {
      const resetTime = new Date(Number(rateLimitReset) * 1000).toISOString();
      log.debug(`✗ graphql:${op} 403 rate-limited (${ms}ms), resets ${resetTime}`);
      throw new GitHubApiError(
        `GraphQL rate limit exceeded. Resets at ${resetTime}.`,
        {
          code: "RATE_LIMITED",
          statusCode: 403,
          recovery: `Wait until ${resetTime}, then retry the same request.`,
          context: { resetAt: resetTime },
        },
      );
    }
    log.debug(`✗ graphql:${op} 403 permission denied (${ms}ms)`);
    throw new GitHubApiError(
      "GraphQL request forbidden (HTTP 403).",
      {
        code: "PERMISSION_DENIED",
        statusCode: 403,
        recovery: "Your token lacks a required permission. Update your fine-grained token at " +
          "https://github.com/settings/tokens and restart the server.",
      },
    );
  }
  if (!response.ok) {
    log.debug(`✗ graphql:${op} HTTP ${response.status} (${ms}ms)`);
    throw new GitHubApiError(
      `GitHub GraphQL API returned HTTP ${response.status} ${response.statusText}.`,
      {
        code: "HTTP_ERROR",
        statusCode: response.status,
        recovery: "Retry the request. If the error persists, check https://githubstatus.com.",
      },
    );
  }

  const json = (await response.json()) as GraphQLResponse<T>;

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message);
    // Log at debug — the tool-level interceptor always re-logs errors with full
    // context (tool name + params). Keeping the API detail at debug avoids
    // printing the same failure twice at ERROR level.
    log.debug(`✗ graphql:${op} GraphQL errors (${ms}ms)`, messages);
    throw new GitHubApiError(
      `GraphQL errors: ${messages.join("; ")}`,
      {
        code: "GRAPHQL_ERROR",
        recovery: "Check the error messages above. Common causes: missing token permission " +
          "(add the required scope at https://github.com/settings/tokens), " +
          "invalid field or argument in the query, or a stale node ID.",
        graphqlErrors: messages,
      },
    );
  }

  if (json.data === undefined) {
    log.debug(`✗ graphql:${op} no data returned (${ms}ms)`);
    throw new GitHubApiError(
      "GitHub GraphQL API returned no data and no errors.",
      {
        code: "HTTP_ERROR",
        recovery: "This is an unexpected GitHub API response. Retry the request.",
      },
    );
  }

  log.debug(`← graphql:${op} OK (${ms}ms)`);
  return json.data;
};

// ── REST API helper ─────────────────────────────────────────────────────────────

/**
 * Make a single GitHub REST API request.
 *
 * Base URL: https://api.github.com
 * Auth:     Bearer GITHUB_TOKEN (same env var as graphql())
 * Timeout:  30 s via AbortController (same pattern as graphql())
 *
 * Returns { data, linkHeader } so callers can paginate via the Link header
 * without a second HTTP round-trip.
 *
 * Throws GitHubApiError on 401, 403, and non-2xx responses —
 * same classification as graphql().
 */
export const rest = async <T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    params?: Record<string, string>;
    body?: unknown;
    accept?: string;
  } = {},
): Promise<RestResponse<T>> => {
  const token = getToken();
  const method = options.method ?? "GET";
  const t0 = performance.now();

  log.debug(`→ rest:${method} ${path}`, options.params);

  // Build URL with query params
  const url = new URL(`${REST_API_URL}/${path}`);
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, value);
    }
  }

  // Build headers
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "github-projects-mcp-server/1.0.0",
    "X-GitHub-Api-Version": "2022-11-28",
    ...options.accept ? { Accept: options.accept } : { Accept: "application/vnd.github+json" },
  };

  // Build body for non-GET requests
  let body: string | undefined;
  if (options.body && method !== "GET") {
    body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    const ms = Math.round(performance.now() - t0);
    if (err instanceof Error && err.name === "AbortError") {
      log.debug(`✗ rest:${method} ${path} timed out after ${ms}ms`);
      throw new GitHubApiError("REST request timed out after 30s.", {
        code: "NETWORK_ERROR",
        recovery:
          "Check your network connection and retry. If timeouts persist, GitHub may be experiencing an outage.",
      });
    }
    log.debug(`✗ rest:${method} ${path} network error (${ms}ms)`, err);
    throw new GitHubApiError(
      `REST network error: ${err instanceof Error ? err.message : String(err)}`,
      {
        code: "NETWORK_ERROR",
        recovery: "Check your network connection and retry.",
      },
    );
  } finally {
    clearTimeout(timeout);
  }

  const ms = Math.round(performance.now() - t0);

  if (response.status === 401) {
    log.debug(`✗ rest:${method} ${path} 401 Unauthorized (${ms}ms)`);
    throw new GitHubApiError(
      "REST authentication failed (HTTP 401).",
      {
        code: "AUTH_FAILED",
        statusCode: 401,
        recovery: "Your GITHUB_TOKEN is invalid or expired. Generate a new fine-grained token at " +
          "https://github.com/settings/tokens with: Projects (read/write), " +
          "Issues (read/write), Metadata (read-only). Then restart the server.",
      },
    );
  }
  if (response.status === 403) {
    const rateLimitReset = response.headers.get("x-ratelimit-reset");
    if (rateLimitReset) {
      const resetTime = new Date(Number(rateLimitReset) * 1000).toISOString();
      log.debug(`✗ rest:${method} ${path} 403 rate-limited (${ms}ms), resets ${resetTime}`);
      throw new GitHubApiError(
        `REST rate limit exceeded. Resets at ${resetTime}.`,
        {
          code: "RATE_LIMITED",
          statusCode: 403,
          recovery: `Wait until ${resetTime}, then retry the same request.`,
          context: { resetAt: resetTime },
        },
      );
    }
    log.debug(`✗ rest:${method} ${path} 403 permission denied (${ms}ms)`);
    throw new GitHubApiError(
      "REST request forbidden (HTTP 403).",
      {
        code: "PERMISSION_DENIED",
        statusCode: 403,
        recovery: "Your token lacks a required permission. Update your fine-grained token at " +
          "https://github.com/settings/tokens and restart the server.",
      },
    );
  }
  if (!response.ok) {
    log.debug(`✗ rest:${method} ${path} HTTP ${response.status} (${ms}ms)`);
    throw new GitHubApiError(
      `GitHub REST API returned HTTP ${response.status} ${response.statusText}.`,
      {
        code: "HTTP_ERROR",
        statusCode: response.status,
        recovery: "Retry the request. If the error persists, check https://githubstatus.com.",
      },
    );
  }

  // Extract Link header before parsing JSON
  const linkHeader = response.headers.get("Link") ?? null;

  const data = (await response.json()) as T;

  log.debug(`← rest:${method} ${path} OK (${ms}ms)`);
  return { data, linkHeader };
};
