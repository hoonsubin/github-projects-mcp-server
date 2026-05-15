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
      log.debug(`✗ graphql:${op} timed out after ${ms}ms`);
      throw new GitHubApiError("Request timed out after 30s");
    }
    log.debug(`✗ graphql:${op} network error (${ms}ms)`, err);
    throw new GitHubApiError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const ms = Math.round(performance.now() - t0);

  if (response.status === 401) {
    log.debug(`✗ graphql:${op} 401 Unauthorized (${ms}ms)`);
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
    log.debug(`✗ graphql:${op} 403 rate-limited (${ms}ms), resets ${resetTime}`);
    throw new GitHubApiError(
      `Rate limit or permission denied. Rate limit resets at ${resetTime}.`,
      403,
    );
  }
  if (!response.ok) {
    log.debug(`✗ graphql:${op} HTTP ${response.status} (${ms}ms)`);
    throw new GitHubApiError(
      `GitHub API error: HTTP ${response.status} ${response.statusText}`,
      response.status,
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
      undefined,
      messages,
    );
  }

  if (json.data === undefined) {
    log.debug(`✗ graphql:${op} no data returned (${ms}ms)`);
    throw new GitHubApiError("GitHub API returned no data and no errors.");
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
      throw new GitHubApiError("Request timed out after 30s");
    }
    log.debug(`✗ rest:${method} ${path} network error (${ms}ms)`, err);
    throw new GitHubApiError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const ms = Math.round(performance.now() - t0);

  if (response.status === 401) {
    log.debug(`✗ rest:${method} ${path} 401 Unauthorized (${ms}ms)`);
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
    log.debug(`✗ rest:${method} ${path} 403 rate-limited (${ms}ms), resets ${resetTime}`);
    throw new GitHubApiError(
      `Rate limit or permission denied. Rate limit resets at ${resetTime}.`,
      403,
    );
  }
  if (!response.ok) {
    log.debug(`✗ rest:${method} ${path} HTTP ${response.status} (${ms}ms)`);
    throw new GitHubApiError(
      `GitHub API error: HTTP ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  // Extract Link header before parsing JSON
  const linkHeader = response.headers.get("Link") ?? null;

  const data = (await response.json()) as T;

  log.debug(`← rest:${method} ${path} OK (${ms}ms)`);
  return { data, linkHeader };
};
