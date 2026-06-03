// =============================================================================
// src/adapters/github/internal/project-items-cache.ts
//
// Session-scoped cache for full-board ProjectItems fetches. One canonical full
// fetch (ItemContent + ItemFieldValues); aggregate views are projected in memory.
// Invalidated on reload().
// =============================================================================

import { PaginatedProjectItemFetcher } from "./pagination.ts";
import { ProjectItemsQueryBuilder } from "./project-items-query-builder.ts";
import { projectItemsToAggregateView } from "./board-item-projection.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { ProjectItem } from "../types.ts";

interface CacheSlot {
  cached: ProjectItem[] | null;
  fetchPromise: Promise<ProjectItem[]> | null;
}

const emptySlot = (): CacheSlot => ({ cached: null, fetchPromise: null });

export class ProjectItemsCache {
  private readonly fullQuery: string;
  private readonly full: CacheSlot = emptySlot();
  private readonly aggregate: CacheSlot = emptySlot();

  constructor(private readonly ctx: GitHubInfraContext) {
    const builder = new ProjectItemsQueryBuilder(this.ctx.ghConfig.owner_type);
    this.fullQuery = builder.buildQuery();
  }

  invalidate(): void {
    this.full.cached = null;
    this.full.fetchPromise = null;
    this.aggregate.cached = null;
    this.aggregate.fetchPromise = null;
  }

  /**
   * All project items with full ItemContent (labels, assignees, dependencies).
   * Used by board health and other Story-shaped aggregations.
   */
  getOrFetchAllItems(): Promise<ProjectItem[]> {
    return this.getOrFetchFull();
  }

  /**
   * Lean aggregate view derived from the canonical full board cache.
   * Avoids a second paginated GraphQL round-trip.
   */
  getOrFetchAggregateItems(): Promise<ProjectItem[]> {
    if (this.aggregate.cached) return Promise.resolve(this.aggregate.cached);

    if (!this.aggregate.fetchPromise) {
      this.aggregate.fetchPromise = this.getOrFetchFull().then((full) => {
        const projected = projectItemsToAggregateView(full);
        this.aggregate.cached = projected;
        this.aggregate.fetchPromise = null;
        return projected;
      });
    }

    return this.aggregate.fetchPromise;
  }

  private getOrFetchFull(): Promise<ProjectItem[]> {
    if (this.full.cached) return Promise.resolve(this.full.cached);

    if (!this.full.fetchPromise) {
      this.full.fetchPromise = this.loadAllFromApi().then((items) => {
        this.full.cached = items;
        this.full.fetchPromise = null;
        return items;
      });
    }

    return this.full.fetchPromise;
  }

  private loadAllFromApi(): Promise<ProjectItem[]> {
    const fetcher = new PaginatedProjectItemFetcher(this.ctx, this.fullQuery);
    return fetcher.collect(() => true);
  }
}
