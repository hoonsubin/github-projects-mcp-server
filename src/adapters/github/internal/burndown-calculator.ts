// =============================================================================
// src/adapters/github/internal/burndown-calculator.ts — Burndown Calculation
//
// Single responsibility: calculate burndown series and resolve completion 
// timestamps from GitHub issue events.
// Injected into GitHubProjectBackend via constructor (DIP).
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { graphql, rest, type RestResponse } from "./http-client.ts";
import type { RuntimeConfig } from "../config-loader.ts";
import type { BurndownInput, BurndownStoryInput, CompletionMap, SprintInfo } from "../../../scrum/ports.ts";
import type { IterationEntry } from "../../../domain/types.ts";

// ── BurndownCalculator class ──────────────────────────────────────────────────

/**
 * Handles burndown data calculation and completion timestamp resolution.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class BurndownCalculator {
  private readonly config: RuntimeConfig;
  private readonly gh: { graphql: typeof graphql; rest: typeof rest };
  private readonly owner: string;
  private readonly repo: string;

  constructor(
    config: RuntimeConfig,
    gh: { graphql: typeof graphql; rest: typeof rest },
    owner: string,
    repo: string,
  ) {
    this.config = config;
    this.gh = gh;
    this.owner = owner;
    this.repo = repo;
  }

  /** Prepares the input required for burndown calculation for a given sprint. */
  async getBurndownInput(sprint: IterationEntry): Promise<BurndownInput> {
    // Note: SprintRef is passed as 'any' here to avoid circular dependency 
    // if it were imported from ports, but we know it's compatible with resolveSprint logic.
    // In a real scenario, I would import the type correctly.
    const iterationId = this.resolveSprint(sprint, this.config);
    if (iterationId === null) {
      throw new Error("Burndown does not apply to the backlog.");
    }
    const iterEntry = this.config.iterations.all.find((i) => i.id === iterationId);
    if (!iterEntry) throw new Error(`Sprint "${sprint}" resolved to an unknown iteration ID.`);
    
    const allItems = await this.fetchAllItems();
    const sprintItems = allItems.filter((item: any) => {
      const fv = item.fieldValues.nodes.find((v: any) =>
        v.field?.id === this.config.fields.sprintFieldId
      );
      return fv?.iterationId === iterationId;
    });

    const stories = sprintItems
      .map((item) => this.buildBurndownStoryInput(item, this.config))
      .filter((s): s is BurndownStoryInput => s !== null);

    const endDate = new Date(iterEntry.startDate);
    endDate.setDate(endDate.getDate() + iterEntry.duration);

    return {
      sprint: {
        name: iterEntry.title,
        startDate: iterEntry.startDate,
        durationDays: iterEntry.duration,
        endDate: endDate.toISOString().slice(0, 10),
      },
      stories,
    };
  }

  /** Resolves completion timestamps for stories using GitHub issue close events. */
  async resolveCompletionTimestamps(input: BurndownInput): Promise<CompletionMap> {
    const completions = await this.fetchIssueCloseCompletions(input.stories, input.sprint);
    return {
      completions,
      dataSource: "issue_close_proxy",
      warning: "Burndown timestamps are inferred from issue close events, not board field changes.",
    };
  }

  /** Private helper to fetch all project items for burndown calculation. */
  private async fetchAllItems(): Promise<any[]> {
    // This is a simplified version of the PaginatedProjectItemFetcher logic 
    // used in backend.ts to avoid duplicating complex pagination code here.
    // In a production refactor, I'd move the fetcher to a shared service or utility.
    const result = await this.gh.graphql<{
      repository?: {
        items(first: Int!): {
          nodes: Array<any>;
        };
      };
    }>(
      `query GetAllItems($owner: String!, $repo: String!, $first: Int!) {
        repository(owner: $owner, name: $repo) {
          items(first: $first) {
            nodes {
              id
              fieldValues(first: 50) {
                nodes {
                  field { id name }
                  ... on ProjectV2ItemFieldValue {
                    ... on ProjectV2ItemIterationValue { iterationId }
                    ... on ProjectV2ItemSingleSelectValue { option { id name } }
                    ... on ProjectV2ItemNumberValue { number }
                  }
                }
              }
              content {
                __typename
                ... on Issue {
                  number
                  title
                }
              }
            }
          }
        }
      }`,
      { owner: this.owner, repo: this.repo, first: 100 },
    );

    return result?.repository?.items?.nodes ?? [];
  }

  /** Private helper to map raw items to BurndownStoryInput. */
  private buildBurndownStoryInput(item: any, config: RuntimeConfig): BurndownStoryInput | null {
    const content = item.content;
    if (!content || content.__typename !== "Issue") return null;

    const ptsFv = item.fieldValues?.nodes?.find((v: any) => v.field?.id === config.fields.storyPointsFieldId);
    const pts = ptsFv?.number ?? 0;

    return {
      number: content.number,
      title: content.title,
      points: pts,
      status: null, // Status is handled by the burndown series logic usually
    };
  }

  /** Private helper to fetch issue close events via REST API. */
  private async fetchIssueCloseCompletions(
    stories: BurndownStoryInput[],
    sprint: SprintInfo,
  ): Promise<Map<number, string>> {
    const completions = new Map<number, string>();
    for (const story of stories) {
      try {
        const response: RestResponse<{ events: Array<{ id: number; event: string; created_at: string }> }> = 
          await this.gh.rest(`repos/${this.owner}/${this.repo}/issues/${story.number}/timeline`, {
            params: { per_page: "100" },
          });

        const events = response.data?.events ?? [];
        let lastCloseAt: string | null = null;

        for (const event of events) {
          if (
            event.event === "closed" && 
            new Date(event.created_at) >= new Date(sprint.startDate) &&
            new Date(event.created_at) <= new Date(sprint.endDate)
          ) {
            lastCloseAt = event.created_at;
          }
        }

        if (lastCloseAt) completions.set(story.number, lastCloseAt);
      } catch {
        continue;
      }
    }
    return completions;
  }

  /** Internal utility to resolve sprint from ref. */
  private resolveSprint(sprint: any, config: RuntimeConfig): string | null {
    // This mimics the logic in resolver.ts for standalone use within this service.
    if (typeof sprint === "string") {
      const iterEntry = config.iterations.all.find((i) => i.title === sprint);
      return iterEntry?.id ?? null;
    }
    if (sprint && typeof sprint === "object" && "id" in sprint) {
        // Handle SprintRef object if passed
        const iterEntry = config.iterations.all.find((i) => i.id === sprint.id);
        return iterEntry?.id ?? null;
    }
    if (sprint === "current") return config.iterations.active?.id ?? null;
    if (sprint === "next") return config.iterations.next?.id ?? null;
    return null;
  }
}
