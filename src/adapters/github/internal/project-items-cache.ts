// =============================================================================
// src/adapters/github/internal/project-items-cache.ts
//
// Session-scoped cache for full-board ProjectItems fetches. Maintains separate
// entries for full vs aggregate query profiles. Invalidated on reload().
// =============================================================================

import { PaginatedProjectItemFetcher } from "./pagination.ts";
import { ProjectItemsQueryBuilder } from "./project-items-query-builder.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { ProjectItem } from "../types.ts";

interface CacheSlot {
  cached: ProjectItem[] | null;
  fetchPromise: Promise<ProjectItem[]> | null;
}

const emptySlot = (): CacheSlot => ({ cached: null, fetchPromise: null });

export class ProjectItemsCache {
  private readonly fullQuery: string;
  private readonly aggregateQuery: string;
  private readonly full: CacheSlot = emptySlot();
  private readonly aggregate: CacheSlot = emptySlot();

  constructor(private readonly ctx: GitHubInfraContext) {
    const builder = new ProjectItemsQueryBuilder(this.ctx.ghConfig.owner_type);
    this.fullQuery = builder.buildQuery();
    this.aggregateQuery = builder.buildAggregateQuery();
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
    return this.getOrFetch(this.full, this.fullQuery);
  }

  /**
   * All project items with lean ItemContentAggregate.
   * Used by burndown, history, sprint completion, impediment board cross-ref.
   */
  getOrFetchAggregateItems(): Promise<ProjectItem[]> {
    return this.getOrFetch(this.aggregate, this.aggregateQuery);
  }

  private getOrFetch(slot: CacheSlot, query: string): Promise<ProjectItem[]> {
    if (slot.cached) return Promise.resolve(slot.cached);

    if (!slot.fetchPromise) {
      slot.fetchPromise = this.loadAllFromApi(query).then((items) => {
        slot.cached = items;
        slot.fetchPromise = null;
        return items;
      });
    }

    return slot.fetchPromise;
  }

  private loadAllFromApi(query: string): Promise<ProjectItem[]> {
    const fetcher = new PaginatedProjectItemFetcher(this.ctx, query);
    return fetcher.collect(() => true);
  }
}
