// =============================================================================
// src/adapters/github/internal/burndown-calculator.ts — Burndown Calculation
//
// Calculates the actual vs ideal burndown series for a given sprint.
// Uses PaginatedProjectItemFetcher for item collection and REST timeline
// for completion event detection.
// =============================================================================

import { GitHubClient } from "./http-client.ts";
import { PaginatedProjectItemFetcher } from "./pagination.ts";
import { buildBurndownStoryInput } from "../mappers.ts";
import { resolveSprint } from "./resolver.ts"; // standalone function — not a class method
import type { RuntimeConfig } from "../config-loader.ts";
import type { BurndownInput, BurndownStoryInput, CompletionMap } from "../../../scrum/ports.ts";
import type { SprintRef } from "../../../domain/types.ts";

export class BurndownCalculator {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly gh: GitHubClient,
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  /**
   * Collects all stories belonging to the specified sprint and prepares
   * them for burndown computation.
   */
  async getBurndownInput(sprint: SprintRef): Promise<BurndownInput> {
    const iterationId = resolveSprint(sprint, this.config);

    if (iterationId === null) {
      throw new Error("Burndown does not apply to the backlog.");
    }

    const iterEntry = this.config.iterations.all.find((i) => i.id === iterationId);
    if (!iterEntry) {
      throw new Error(`Iteration with ID ${iterationId} not found in configuration.`);
    }

    const fetcher = new PaginatedProjectItemFetcher(
      this.config,
      { graphql: this.gh.graphql },
      {
        sprintFieldIds: [this.config.fields.sprintFieldId],
        includeIssueContent: true,
      },
    );

    const items = await fetcher.collect((item) => {
      return item.fieldValues.nodes.some(
        (node) =>
          node.field?.id === this.config.fields.sprintFieldId && node.iterationId === iterationId,
      );
    });

    const stories = items
      .map((item) => buildBurndownStoryInput(item, this.config))
      .filter((s): s is BurndownStoryInput => s !== null);

    const endDate = new Date(iterEntry.startDate);
    endDate.setDate(endDate.getDate() + iterEntry.duration);

    return {
      sprint: {
        name: iterEntry.title,
        startDate: iterEntry.startDate,
        endDate: endDate.toISOString(),
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
        const response = await this.gh.rest<{
          event: string;
          created_at: string;
        }[]>(`repos/${this.owner}/${this.repo}/issues/${story.number}/timeline`);

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
        // We log at debug level to avoid cluttering error logs for non-critical failures.
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
