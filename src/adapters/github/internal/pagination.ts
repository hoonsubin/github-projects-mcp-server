// =============================================================================
// src/adapters/github/internal/pagination.ts - PaginatedProjectItemFetcher
//
// Cursor-based pagination infrastructure for GitHub Projects v2 items.
// Phase 4: delegates execution to ExecutionEngine (Humble Object pattern).
// The fetcher is now a thin convenience wrapper — its public API is unchanged
// so no consumer code needs modification.
//
// Phase 1 of adapter refactoring — query-building responsibility moved to
// project-items-query-builder.ts. The fetcher is pure cursor iteration.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import { ExecutionEngine, type PageExtractor } from "./execution-engine.ts";
import type { PlatformRequest } from "./assemblers/types.ts";
import type { ProjectItemsResponse } from "./project-items-query-builder.ts";
import type {
  ItemFieldValue,
  OwnerType,
  ProjectItem,
  ProjectItemDraftContent,
  ProjectItemIssueContent,
  ProjectItemPRContent,
  ProjectV2ItemRef,
} from "../types.ts";

// ── Page extractor for project items responses ───────────────────────────────

/**
 * Navigate a ProjectItemsResponse to extract nodes, pageInfo, and totalCount.
 * Throws GitHubApiError when the project is not found — the engine propagates this.
 */
const projectItemsExtractor = (
  ownerType: OwnerType,
  projectNumber: number,
  login: string,
): PageExtractor<ProjectItemsResponse> => {
  return (response: ProjectItemsResponse) => {
    const project = ownerType === "user"
      ? response.user?.projectV2
      : response.organization?.projectV2;
    if (!project) {
      throw new GitHubApiError(
        `Project #${projectNumber} not found for ${ownerType} '${login}'.`,
        {
          code: "NOT_FOUND",
          recovery: "Verify the project number and owner in backends.github config.",
        },
      );
    }
    return {
      nodes: project.items?.nodes ?? [],
      pageInfo: project.items?.pageInfo ?? { hasNextPage: false, endCursor: null },
      totalCount: project.items?.totalCount ?? 0,
    };
  };
};

// ---------------------------------------------------------------------------
// PaginatedProjectItemFetcher
// ---------------------------------------------------------------------------

/**
 * Cursor-based paginated fetcher for GitHub Projects v2 items.
 *
 * Thin wrapper over ExecutionEngine — the engine handles raw cursor iteration;
 * the fetcher interprets the project-items-specific response shape and provides
 * the collect(predicate) convenience API.
 *
 * Public API is unchanged from Phase 1-3 so no consumer code modifications
 * are required (BurndownCalculator, SprintHistoryService, StoryQueryService,
 * ImpedimentService all construct this class with the same (ctx, query) args).
 *
 * @param ctx - GitHubInfraContext carrying config, gh, owner, repo
 * @param query - Pre-built GraphQL query document from ProjectItemsQueryBuilder
 */
export class PaginatedProjectItemFetcher {
  private readonly login: string;
  private readonly projectNumber: number;
  private readonly ownerType: OwnerType;
  private readonly engine: ExecutionEngine;
  private readonly request: PlatformRequest;
  private items: ProjectItem[] = [];
  private _totalCount = 0;
  private _hasFetched = false;

  constructor(
    private readonly ctx: GitHubInfraContext,
    query: string,
  ) {
    const ghConfig = ctx.config.ghConfig;
    this.login = ghConfig.owner;
    this.projectNumber = ghConfig.project_number;
    this.ownerType = ghConfig.owner_type;

    this.engine = new ExecutionEngine(ctx.gh);
    this.request = {
      document: query,
      variables: { login: this.login, number: this.projectNumber },
    };
  }

  /** Get total item count from the first page response. */
  get totalCount(): number {
    return this._totalCount;
  }

  /** Get all fetched items. */
  getAll(): ProjectItem[] {
    return this.items;
  }

  /** Fetch all pages via the execution engine. Called lazily on first access. */
  private async fetchAll(): Promise<void> {
    if (this._hasFetched) return;

    const extractor = projectItemsExtractor(
      this.ownerType,
      this.projectNumber,
      this.login,
    );
    const result = await this.engine.execute(this.request, extractor);

    this.items = result.nodes as ProjectItem[];
    this._totalCount = result.totalCount;
    this._hasFetched = true;
  }

  /**
   * Collect all items matching the predicate, fetching pages via the engine.
   *
   * All pages are fetched in one batch by ExecutionEngine.execute().
   * Client-side filtering (predicate) is applied after all nodes are collected.
   */
  async collect(
    predicate: (item: ProjectItem) => boolean,
  ): Promise<ProjectItem[]> {
    await this.fetchAll();
    return this.items.filter(predicate);
  }
}

// ---------------------------------------------------------------------------
// Backlog item helper
// ---------------------------------------------------------------------------

export const isBacklogItem = (item: ProjectItem, sprintFieldId: string): boolean => {
  return !item.fieldValues.nodes.some((fv) => fv.field?.id === sprintFieldId && fv.iterationId);
};

// Re-export types used by downstream consumers
export type {
  ItemFieldValue,
  ProjectItem,
  ProjectItemDraftContent,
  ProjectItemIssueContent,
  ProjectItemPRContent,
  ProjectV2ItemRef,
};
