// =============================================================================
// src/adapters/github/internal/burndown-calculator.ts - Burndown Calculation
//
// Calculates the actual vs ideal burndown series for a given sprint.
// Uses PaginatedProjectItemFetcher for item collection and REST timeline
// for completion event detection.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { ProjectItemsCache } from "./project-items-cache.ts";
import { buildBurndownStoryInput } from "../mappers.ts";
import { resolveSprint } from "./resolver.ts"; // standalone function - not a class method
import { computeSprintEndDate } from "../../../scrum/sprint-math.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { ProjectItem } from "../types.ts";
import type { BurndownInput, BurndownStoryInput, CompletionMap } from "../../../scrum/ports.ts";
import type { SprintRef } from "../../../domain/types.ts";
import { log } from "../../../services/logger.ts";

export class BurndownCalculator {
  constructor(
    private readonly ctx: GitHubInfraContext,
    private readonly projectItemsCache: ProjectItemsCache,
  ) {}

  /**
   * Collects all stories belonging to the specified sprint and prepares
   * them for burndown computation.
   */
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
          recovery: "The iteration may have been deleted or the config is stale. " +
            "Call scrum_orient to refresh platform state.",
          context: { iterationId },
        },
      );
    }

    const allItems = preloadedItems ?? await this.projectItemsCache.getOrFetchAllItems();
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
        goal: null, // NOT_IMPLEMENTED: GitHub Projects API does not expose iteration goals
        durationDays: iterEntry.duration,
      },
      stories,
    };
  }

  /**
   * Resolves completion timestamps for stories by querying the GitHub
   * REST API issue timeline.
   */
  async resolveCompletionTimestamps(input: BurndownInput): Promise<CompletionMap> {
    const completions = new Map<number, string>();
    const start = new Date(input.sprint.startDate).getTime();
    const end = new Date(input.sprint.endDate).getTime();

    for (const story of input.stories) {
      if (story.number === null) continue;

      try {
        const response = await this.ctx.gh.rest<{
          event: string;
          created_at: string;
        }[]>(`repos/${this.ctx.owner}/${this.ctx.repo}/issues/${story.number}/timeline`);

        const lastClosedAt = response.data
          .filter((e) => e.event === "closed")
          .map((e) => new Date(e.created_at).getTime())
          .filter((t) => t >= start && t <= end)
          .sort((a, b) => b - a)[0];

        if (lastClosedAt) {
          completions.set(story.number, new Date(lastClosedAt).toISOString());
        }
      } catch (err) {
        // Individual timeline fetch errors should not abort the whole burndown.
        log.debug(`burndown: timeline fetch failed for #${story.number}`, err);
        continue;
      }
    }

    return {
      completions,
      dataSource: "issue_close_proxy",
      warning: "Completion timestamps are inferred from GitHub issue close events.",
    };
  }
}
