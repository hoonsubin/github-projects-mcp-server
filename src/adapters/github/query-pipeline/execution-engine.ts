// =============================================================================
// src/adapters/github/execution-engine.ts - Execution Engine
//
// Phase 4 of adapter refactoring - the Humble Object that calls the GitHub API.
// No query construction. No response interpretation. No retry logic.
// All policy (page limits, rate-limit handling) lives outside this class.
//
// Accepts a PlatformRequest (document + variables), handles cursor pagination,
// and returns PaginationResult with raw unknown[] nodes. The caller provides a
// PageExtractor callback to navigate the response shape - the engine knows
// nothing about what the response represents.
// =============================================================================

import type { GitHubClient } from "../infra/http-client.ts";
import type { PlatformRequest } from "../infra/platform-request.ts";

// ── Pagination policy ────────────────────────────────────────────────────────

/**
 * Controls the engine's pagination behaviour.
 * All policy is external - the engine does not make decisions about limits.
 */
export interface PaginationPolicy {
  /** Maximum number of pages to fetch (safety valve against runaway loops). */
  readonly maxPages: number;
  /** Declared page size (informational - the engine does not set this value;
   *  it is embedded in the query document by the assembler). */
  readonly pageSize: number;
  /** When true the caller should stop if the API returns a rate-limit signal.
   *  The engine does not detect rate limits itself (the HTTP client does). */
  readonly stopOnRateLimit: boolean;
  /** Stop paginating once this many nodes have been collected. Undefined = no cap. */
  readonly maxItems?: number;
}

export const DEFAULT_PAGINATION_POLICY: PaginationPolicy = {
  maxPages: 20,
  pageSize: 50,
  stopOnRateLimit: true,
};

/** Single-page policy for server-filtered queries (e.g. sprint scope). */
export const SPRINT_PAGINATION_POLICY: PaginationPolicy = {
  maxPages: 1,
  pageSize: 50,
  maxItems: 50,
  stopOnRateLimit: true,
};

// ── Page extractor ───────────────────────────────────────────────────────────

/**
 * Callback that extracts pagination metadata and nodes from a typed response.
 *
 * The engine calls `gh.graphql<T>(document, variables)` but has no knowledge
 * of T's shape. The extractor is the only place that navigates the response
 * to find `nodes`, `pageInfo`, and `totalCount`. It may throw (e.g. project
 * not found) - the engine transparently propagates the error.
 */
export interface PageExtractor<T> {
  (response: T): {
    readonly nodes: readonly unknown[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
    readonly totalCount: number;
  };
}

// ── Pagination result ────────────────────────────────────────────────────────

/**
 * The engine's output - raw nodes collected from all fetched pages.
 * The caller (ResultNormalizer) interprets the nodes and maps them to domain types.
 */
export interface PaginationResult {
  /** All nodes collected across all fetched pages, in page order. */
  readonly nodes: readonly unknown[];
  /** Total item count as reported by the API on the first page. */
  readonly totalCount: number;
  /** Number of pages actually consumed (1..maxPages). */
  readonly pagesConsumed: number;
  /** True when page cap was reached before all pages were fetched. */
  readonly truncated: boolean;
}

// ── ExecutionEngine ──────────────────────────────────────────────────────────

/**
 * Humble Object - the only class that directly calls the GitHub GraphQL API
 * for paginated queries. Hard to unit-test by design; integration-tested
 * through PaginatedProjectItemFetcher.
 *
 * Accepts a single PlatformRequest (document + variables), fetches all pages
 * using cursor-based pagination, and returns raw nodes. The caller provides
 * a PageExtractor to navigate the response shape.
 *
 * No query construction. No response interpretation. No rate-limit handling.
 * No knowledge of project items, issues, or any domain type.
 */
export class ExecutionEngine {
  constructor(
    private readonly gh: GitHubClient,
    private readonly policy: PaginationPolicy = DEFAULT_PAGINATION_POLICY,
  ) {}

  /**
   * Execute a paginated GraphQL query, collecting all nodes across all pages.
   *
   * The request.variables MUST NOT include a `cursor` key - the engine adds
   * `cursor` with the pageInfo.endCursor value for each subsequent page.
   *
   * @param request  A single PlatformRequest with document + variables.
   * @param extractor  Callback to extract nodes/pageInfo/totalCount from the response.
   * @returns PaginationResult with raw nodes from all pages.
   */
  async execute<T>(
    request: PlatformRequest,
    extractor: PageExtractor<T>,
  ): Promise<PaginationResult> {
    // ── First page ─────────────────────────────────────────────────────────
    const firstResponse = await this.gh.graphql<T>(
      request.document,
      request.variables,
    );
    const firstPage = extractor(firstResponse);

    const allNodes: unknown[] = [...firstPage.nodes];
    let pageInfo = firstPage.pageInfo;
    let pagesConsumed = 1;

    // ── Remaining pages ────────────────────────────────────────────────────
    while (
      pageInfo.hasNextPage &&
      pageInfo.endCursor &&
      pagesConsumed < this.policy.maxPages &&
      (this.policy.maxItems === undefined || allNodes.length < this.policy.maxItems)
    ) {
      const vars = { ...request.variables, cursor: pageInfo.endCursor };
      const response = await this.gh.graphql<T>(request.document, vars);
      const page = extractor(response);
      allNodes.push(...page.nodes);
      pageInfo = page.pageInfo;
      pagesConsumed++;
    }

    const truncated = pageInfo.hasNextPage &&
      pagesConsumed >= this.policy.maxPages;

    return {
      nodes: allNodes,
      totalCount: firstPage.totalCount,
      pagesConsumed,
      truncated,
    };
  }
}
