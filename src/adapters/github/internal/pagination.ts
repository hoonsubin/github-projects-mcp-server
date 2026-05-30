// =============================================================================
// src/adapters/github/internal/pagination.ts - PaginatedProjectItemFetcher
//
// Cursor-based pagination infrastructure for GitHub Projects v2 items.
// Receives a pre-built GraphQL query (built by ProjectItemsQueryBuilder)
// and does nothing but page through results.
//
// Phase 1 of adapter refactoring — query-building responsibility moved to
// project-items-query-builder.ts. The fetcher is pure cursor iteration.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { ProjectItemsResponse } from "./project-items-query-builder.ts";
import type {
  ItemFieldValue,
  OwnerType,
  PageInfoRef,
  ProjectItem,
  ProjectItemDraftContent,
  ProjectItemIssueContent,
  ProjectItemPRContent,
  ProjectV2ItemRef,
} from "../types.ts";

// ---------------------------------------------------------------------------
// PaginatedProjectItemFetcher
// ---------------------------------------------------------------------------

/**
 * Cursor-based paginated fetcher for GitHub Projects v2 items.
 *
 * Receives a pre-built query (from ProjectItemsQueryBuilder) and pages
 * through results. No query logic lives here — this is pure iteration
 * infrastructure.
 *
 * @param ctx - GitHubInfraContext carrying config, gh, owner, repo
 * @param query - Pre-built GraphQL query document from ProjectItemsQueryBuilder
 */
export class PaginatedProjectItemFetcher {
  private login: string;
  private projectNumber: number;
  private ownerType: OwnerType;
  private query: string;
  private items: ProjectItem[] = [];
  private pageInfo: PageInfoRef | null = null;
  private _totalCount = 0;

  constructor(
    private ctx: GitHubInfraContext,
    query: string,
  ) {
    const ghConfig = ctx.config.ghConfig;
    this.login = ghConfig.owner;
    this.projectNumber = ghConfig.project_number;
    this.ownerType = ghConfig.owner_type;
    this.query = query;
  }

  /** Get total item count from the first page response. */
  get totalCount(): number {
    return this._totalCount;
  }

  /** Get all fetched items. */
  getAll(): ProjectItem[] {
    return this.items;
  }

  /** Fetch the first page. Called lazily by collect() on first invocation. */
  private async fetchFirstPage(): Promise<void> {
    const result = await this.ctx.gh.graphql<ProjectItemsResponse>(this.query, {
      login: this.login,
      number: this.projectNumber,
    });
    const project = this.ownerType === "user"
      ? result.user?.projectV2
      : result.organization?.projectV2;
    if (!project) {
      throw new GitHubApiError(
        `Project #${this.projectNumber} not found for ${this.ownerType} '${this.login}'.`,
        {
          code: "NOT_FOUND",
          recovery: "Verify the project number and owner in backends.github config.",
        },
      );
    }
    this.items = [...(project.items?.nodes ?? [])];
    this.pageInfo = project.items?.pageInfo ?? null;
    this._totalCount = project.items?.totalCount ?? 0;
  }

  /** Fetch all remaining pages. Call after construction to get complete dataset. */
  async fetchRemaining(): Promise<void> {
    while (this.pageInfo?.hasNextPage && this.pageInfo.endCursor) {
      const result = await this.ctx.gh.graphql<ProjectItemsResponse>(this.query, {
        login: this.login,
        number: this.projectNumber,
        cursor: this.pageInfo.endCursor,
      });
      const project = this.ownerType === "user"
        ? result.user?.projectV2
        : result.organization?.projectV2;
      const moreItems = project?.items?.nodes ?? [];
      this.items.push(...moreItems);
      this.pageInfo = project?.items?.pageInfo ?? null;
    }
  }

  /**
   * Collect all items matching the predicate, fetching additional pages as needed.
   */
  async collect(
    predicate: (item: ProjectItem) => boolean,
  ): Promise<ProjectItem[]> {
    if (this.pageInfo === null) await this.fetchFirstPage();
    const results: ProjectItem[] = [];
    for (const item of this.items) {
      if (predicate(item)) results.push(item);
    }
    while (this.pageInfo?.hasNextPage && this.pageInfo.endCursor) {
      const result = await this.ctx.gh.graphql<ProjectItemsResponse>(this.query, {
        login: this.login,
        number: this.projectNumber,
        cursor: this.pageInfo.endCursor,
      });
      const project = this.ownerType === "user"
        ? result.user?.projectV2
        : result.organization?.projectV2;
      const moreItems = project?.items?.nodes ?? [];
      for (const item of moreItems) {
        if (predicate(item)) results.push(item);
        this.items.push(item);
      }
      this.pageInfo = project?.items?.pageInfo ?? null;
    }
    return results;
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
