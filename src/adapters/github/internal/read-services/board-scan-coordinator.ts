// =============================================================================
// src/adapters/github/internal/board-scan-coordinator.ts
//
// Single entry point for session-scoped full-board scans (aggregate vs full
// query profiles). Wraps ProjectItemsCache for Steps 2–3 / getAggregates prep.
// =============================================================================

import { ProjectItemsCache } from "../query-pipeline/project-items-cache.ts";
import type { GitHubInfraContext } from "../infra/infra-context.ts";
import type { ProjectItem } from "../../types.ts";

export class BoardScanCoordinator {
  private readonly cache: ProjectItemsCache;

  constructor(ctx: GitHubInfraContext) {
    this.cache = new ProjectItemsCache(ctx);
  }

  invalidate(): void {
    this.cache.invalidate();
  }

  /** Lean ItemContentAggregate scan (burndown, history, sprint completion, impediments). */
  fetchAggregateBoard(): Promise<ProjectItem[]> {
    return this.cache.getOrFetchAggregateItems();
  }

  /** Full ItemContent scan (board health / Story-shaped aggregations). */
  fetchFullBoard(): Promise<ProjectItem[]> {
    return this.cache.getOrFetchAllItems();
  }
}
