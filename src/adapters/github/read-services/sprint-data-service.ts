// =============================================================================
// src/adapters/github/read-services/sprint-data-service.ts
//
// Sprint Data Service — resolves a SprintRef to SprintRawData with per-item
// completion timestamps. Delegates to BoardScanCoordinator for aggregate
// board scan and completionsFromBoardItems for issue closedAt extraction.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { BoardScanCoordinator } from "./board-scan-coordinator.ts";
import { buildAggregateFromRaw } from "../mappers.ts";
import { resolveSprint } from "../infra/resolver.ts";
import { computeSprintEndDate } from "../../../scrum/utils/sprint-math.ts";
import { completionsFromBoardItems } from "../infra/completion-timestamps.ts";
import type { GitHubInfraContext } from "../infra/infra-context.ts";
import type { ProjectItem } from "../types.ts";
import type {
  SprintDataQuery,
  SprintInfo,
  SprintRawData,
  SprintRawItem,
} from "../../../scrum/ports.ts";

// ── SprintDataService class ─────────────────────────────────────────────────

/**
 * Resolves a SprintRef to SprintRawData: sprint metadata + flat item array
 * with per-item completion timestamps.
 *
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class SprintDataService {
  constructor(
    private readonly ctx: GitHubInfraContext,
    private readonly boardScan: BoardScanCoordinator,
  ) {}

  /**
   * Return raw sprint data for the given SprintRef.
   *
   * Resolves the SprintRef to an iteration ID, finds the IterationEntry,
   * scans the aggregated board, filters items belonging to the sprint,
   * maps them to SprintRawItem, and attaches completion timestamps.
   */
  async getSprintData(query: SprintDataQuery): Promise<SprintRawData> {
    const sprintRef = query.sprint_ref;

    // Resolve SprintRef → iteration ID (throws for unresolvable refs)
    const iterationId = resolveSprint(sprintRef, this.ctx.config);
    if (iterationId === null) {
      throw new GitHubApiError(
        "Sprint data does not apply to the backlog.",
        {
          code: "NOT_FOUND",
          statusCode: 400,
          recovery: "Sprint data requires an active sprint. " +
            "Use a specific sprint ref ('current', 'next', or sprint name) instead of null.",
          context: { sprintRef: String(sprintRef) },
        },
      );
    }

    // Find the IterationEntry matching the resolved iteration ID
    const iterEntry = this.ctx.config.live.iterations.all.find(
      (i) => i.id === iterationId,
    );
    if (!iterEntry) {
      throw new GitHubApiError(
        `Iteration with ID ${iterationId} not found in configuration.`,
        {
          code: "NOT_FOUND",
          statusCode: 404,
          recovery: "The iteration may have been deleted or the config is stale. " +
            "Call scrum_orient to refresh platform state.",
          context: { iterationId },
        },
      );
    }

    // Compute sprint end date (shared pure function from scrum layer)
    const endDate = computeSprintEndDate(iterEntry.startDate, iterEntry.duration);

    // Build SprintInfo — GitHub Projects API does not expose iteration goals
    const sprint: SprintInfo = {
      id: iterEntry.id,
      name: iterEntry.title,
      goal: null,
      startDate: iterEntry.startDate,
      durationDays: iterEntry.duration,
      endDate,
    };

    // Fetch all board items via the cached aggregate scan
    const allItems = await this.boardScan.fetchAggregateBoard();

    // Filter to items assigned to this sprint iteration
    const sprintItems = this._filterSprintItems(allItems, iterationId);

    // Resolve completion timestamps from issue closedAt dates
    const completions = completionsFromBoardItems(allItems, sprint.startDate, sprint.endDate);

    // Map each ProjectItem → SprintRawItem
    const items: SprintRawItem[] = sprintItems.map((item) =>
      this._mapToSprintRawItem(item, completions)
    );

    return { sprint, items };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Filter board items to only those assigned to the given iteration.
   * Matches on sprint field ID + iteration ID from field value nodes.
   */
  private _filterSprintItems(
    allItems: readonly ProjectItem[],
    iterationId: string,
  ): ProjectItem[] {
    const sprintFieldId = this.ctx.config.live.fields.sprintFieldId;
    return allItems.filter((item) =>
      item.fieldValues.nodes.some(
        (node) => node.field?.id === sprintFieldId && node.iterationId === iterationId,
      )
    );
  }

  /**
   * Map a single ProjectItem to SprintRawItem.
   * Uses buildAggregateFromRaw for field extraction, then projects to
   * SprintRawItem and attaches completion timestamp.
   */
  private _mapToSprintRawItem(
    item: ProjectItem,
    completions: Map<number, string>,
  ): SprintRawItem {
    const agg = buildAggregateFromRaw(item, this.ctx.config);

    return {
      id: agg.id,
      number: agg.issueNumber ?? 0,
      title: agg.title ?? "",
      type: agg.type,
      status: agg.status,
      story_points: agg.storyPoints,
      has_assignee: agg.hasAssignee,
      has_blockers: agg.hasBlockers,
      completed_at: agg.issueNumber !== null ? (completions.get(agg.issueNumber) ?? null) : null,
    };
  }
}
