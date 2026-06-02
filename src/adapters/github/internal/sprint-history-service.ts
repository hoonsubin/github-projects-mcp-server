// =============================================================================
// src/adapters/github/internal/sprint-history-service.ts - Sprint History
//
// Single responsibility: fetch and project completed sprint history.
// Injected into GitHubProjectBackend via constructor (DIP).
// =============================================================================

import { BoardScanCoordinator } from "./board-scan-coordinator.ts";
import { aggregateToBurndownInput, buildAggregateFromRaw } from "../mappers.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { SprintHistoryEntry } from "../../../scrum/ports.ts";
import type { ProjectItem } from "../types.ts";

// ── SprintHistoryService class ───────────────────────────────────────────────

/**
 * Fetches and projects completed sprint history.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class SprintHistoryService {
  constructor(
    private readonly ctx: GitHubInfraContext,
    private readonly boardScan: BoardScanCoordinator,
  ) {}

  async getCompletedSprintHistory(
    window: number,
    preloadedItems?: readonly ProjectItem[],
  ): Promise<SprintHistoryEntry[]> {
    const completedSorted = [...this.ctx.config.live.iterations.completed].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );
    const windowSlice = completedSorted.slice(0, window);
    if (windowSlice.length === 0) return [];

    const allItems = preloadedItems ?? await this.boardScan.fetchAggregateBoard();

    return windowSlice.map((iter) => {
      const stories = allItems
        .map((item) => buildAggregateFromRaw(item, this.ctx.config))
        .filter((agg) => agg.sprintId === iter.id)
        .map((agg) => aggregateToBurndownInput(agg))
        .filter((row): row is NonNullable<typeof row> => row !== null);

      const endDate = new Date(iter.startDate);
      endDate.setDate(endDate.getDate() + iter.duration);

      return {
        info: {
          id: iter.id,
          name: iter.title,
          goal: null, // GitHub API does not expose iteration descriptions
          startDate: iter.startDate,
          durationDays: iter.duration,
          endDate: endDate.toISOString().slice(0, 10),
        },
        stories,
      };
    });
  }
}
