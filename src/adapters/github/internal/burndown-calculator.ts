// =============================================================================
// src/adapters/github/internal/burndown-calculator.ts - Burndown Calculation
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { BoardScanCoordinator } from "./board-scan-coordinator.ts";
import { buildBurndownStoryInput } from "../mappers.ts";
import { resolveSprint } from "./resolver.ts";
import { computeSprintEndDate } from "../../../scrum/sprint-math.ts";
import { completionsFromBoardItems } from "./infra/burndown-completion.ts";
import { mapWithConcurrency } from "./concurrent.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { ProjectItem } from "../types.ts";
import type { BurndownInput, BurndownStoryInput, CompletionMap } from "../../../scrum/ports.ts";
import type { SprintRef } from "../../../domain/types.ts";
import { log } from "../../../services/logger.ts";

const TIMELINE_CONCURRENCY = 5;

export class BurndownCalculator {
  constructor(
    private readonly ctx: GitHubInfraContext,
    private readonly boardScan: BoardScanCoordinator,
  ) {}

  async getBurndownInput(
    sprint: SprintRef,
    preloadedItems?: readonly ProjectItem[],
  ): Promise<BurndownInput> {
    const iterationId = resolveSprint(sprint, this.ctx.config);

    if (iterationId === null) {
      throw new GitHubApiError(
        "Burndown does not apply to the backlog.",
        {
          code: "NOT_FOUND",
          statusCode: 400,
          recovery: "Burndown requires an active sprint. " +
            "Use a specific sprint ref ('current', 'next', or sprint name) instead of null.",
          context: { sprint },
        },
      );
    }

    const iterEntry = this.ctx.config.live.iterations.all.find((i) => i.id === iterationId);
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

    const allItems = preloadedItems ?? await this.boardScan.fetchAggregateBoard();
    const sprintFieldId = this.ctx.config.live.fields.sprintFieldId;
    const items = allItems.filter((item) =>
      item.fieldValues.nodes.some(
        (node) => node.field?.id === sprintFieldId && node.iterationId === iterationId,
      )
    );

    const stories = items
      .map((item) => buildBurndownStoryInput(item, this.ctx.config))
      .filter((s): s is BurndownStoryInput => s !== null);

    const endDate = computeSprintEndDate(iterEntry.startDate, iterEntry.duration);

    return {
      sprint: {
        id: iterEntry.id,
        name: iterEntry.title,
        startDate: iterEntry.startDate,
        endDate: endDate,
        goal: null,
        durationDays: iterEntry.duration,
      },
      stories,
    };
  }

  /**
   * Resolves completion timestamps: prefers issue closedAt from board items,
   * then REST timeline for remaining stories (bounded concurrency).
   */
  async resolveCompletionTimestamps(
    input: BurndownInput,
    preloadedItems?: readonly ProjectItem[],
  ): Promise<CompletionMap> {
    const start = input.sprint.startDate;
    const end = input.sprint.endDate;

    const boardItems = preloadedItems ?? await this.boardScan.fetchAggregateBoard();
    const completions = completionsFromBoardItems(boardItems, start, end);

    const needsTimeline = input.stories.filter(
      (s) => s.number !== null && !completions.has(s.number),
    );

    await mapWithConcurrency(needsTimeline, TIMELINE_CONCURRENCY, async (story) => {
      if (story.number === null) return;
      try {
        const response = await this.ctx.gh.rest<{
          event: string;
          created_at: string;
        }[]>(`repos/${this.ctx.owner}/${this.ctx.repo}/issues/${story.number}/timeline`);

        const startMs = new Date(`${start}T00:00:00Z`).getTime();
        const endMs = new Date(`${end}T23:59:59.999Z`).getTime();

        const lastClosedAt = response.data
          .filter((e) => e.event === "closed")
          .map((e) => new Date(e.created_at).getTime())
          .filter((t) => t >= startMs && t <= endMs)
          .sort((a, b) => b - a)[0];

        if (lastClosedAt) {
          completions.set(story.number, new Date(lastClosedAt).toISOString());
        }
      } catch (err) {
        log.debug(`burndown: timeline fetch failed for #${story.number}`, err);
      }
    });

    const usedBoard = completions.size > 0;
    const usedTimeline = needsTimeline.length > 0;

    return {
      completions,
      dataSource: usedBoard && !usedTimeline
        ? "issue_closed_at"
        : usedBoard
        ? "issue_closed_at_and_timeline"
        : "issue_close_proxy",
      warning: usedTimeline
        ? "Some completion timestamps were inferred from GitHub issue close events via the REST timeline API."
        : "Completion timestamps use GitHub issue closedAt from the project board.",
    };
  }
}
