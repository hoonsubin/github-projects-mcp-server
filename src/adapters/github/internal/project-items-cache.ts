// =============================================================================
// src/adapters/github/internal/project-items-cache.ts
//
// Session-scoped cache for full-board ProjectItems fetches. Deduplicates
// concurrent and repeated getOrFetchAllItems() calls within one backend instance.
// Invalidated on reload() when live project metadata changes.
// =============================================================================

import { PaginatedProjectItemFetcher } from "./pagination.ts";
import { ProjectItemsQueryBuilder } from "./project-items-query-builder.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { ProjectItem } from "../types.ts";

export class ProjectItemsCache {
  private cached: ProjectItem[] | null = null;
  private fetchPromise: Promise<ProjectItem[]> | null = null;
  private readonly query: string;

  constructor(private readonly ctx: GitHubInfraContext) {
    this.query = new ProjectItemsQueryBuilder(this.ctx.ghConfig.owner_type).buildQuery();
  }

  invalidate(): void {
    this.cached = null;
    this.fetchPromise = null;
  }

  /** All project items (full board scan, cached for the session). */
  getOrFetchAllItems(): Promise<ProjectItem[]> {
    if (this.cached) return Promise.resolve(this.cached);

    if (!this.fetchPromise) {
      this.fetchPromise = this.loadAllFromApi().then((items) => {
        this.cached = items;
        this.fetchPromise = null;
        return items;
      });
    }

    return this.fetchPromise;
  }

  private loadAllFromApi(): Promise<ProjectItem[]> {
    const fetcher = new PaginatedProjectItemFetcher(this.ctx, this.query);
    return fetcher.collect(() => true);
  }
}
