// =============================================================================
// src/adapters/github/internal/sprint-history-service.ts — Sprint History
//
// Single responsibility: fetch and project completed sprint history.
// Extracted from GitHubProjectBackend as part of Phase F (Adapter refactor).
// Injected into GitHubProjectBackend via constructor (DIP).
// =============================================================================

import type { GitHubClient } from "./http-client.ts";
import { PaginatedProjectItemFetcher } from "./pagination.ts";
import type { RuntimeConfig } from "../config-loader.ts";
import type { SprintHistoryEntry } from "../../../scrum/ports.ts";
import type { ProjectItemIssueContent, ProjectItemPRContent } from "../types.ts";

// ── SprintHistoryService class ───────────────────────────────────────────────

/**
 * Fetches and projects completed sprint history.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class SprintHistoryService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly gh: GitHubClient,
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  async getCompletedSprintHistory(window: number): Promise<SprintHistoryEntry[]> {
    const completedSorted = [...this.config.iterations.completed].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );
    const windowSlice = completedSorted.slice(0, window);
    if (windowSlice.length === 0) return [];

    const allItems = await this.fetchAllItems();
    const { sprintFieldId, statusFieldId, storyPointsFieldId } = this.config.fields;

    return windowSlice.map((iter) => {
      const iterItems = allItems.filter((item) => {
        const fv = item.fieldValues.nodes.find((v) => v.field?.id === sprintFieldId);
        return fv?.iterationId === iter.id;
      });

      const stories = iterItems
        .filter((item) => item.content !== null && item.content.__typename !== "DraftIssue")
        .map((item) => {
          const content = item.content as ProjectItemIssueContent | ProjectItemPRContent;
          const ptsFv = storyPointsFieldId
            ? item.fieldValues.nodes.find((v) => v.field?.id === storyPointsFieldId)
            : null;
          const statusFv = item.fieldValues.nodes.find((v) => v.field?.id === statusFieldId);
          return {
            number: content.number,
            title: content.title,
            points: ptsFv?.number ?? 0,
            status: statusFv?.name ?? null,
          };
        });

      const endDate = new Date(iter.startDate);
      endDate.setDate(endDate.getDate() + iter.duration);

      return {
        info: {
          name: iter.title,
          startDate: iter.startDate,
          durationDays: iter.duration,
          endDate: endDate.toISOString().slice(0, 10),
        },
        stories,
      };
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Fetch all project items (issues, PRs, drafts) for cross-sprint analysis.
   * DraftIssues are included so the filter in getCompletedSprintHistory can
   * exclude them explicitly, preserving the original query shape from the paginator.
   */
  private fetchAllItems() {
    const fetcher = new PaginatedProjectItemFetcher(
      this.config,
      { graphql: this.gh.graphql },
      {
        includeIssueContent: true,
        includePRContent: true,
        includeDraftIssueContent: true,
        pageSize: 100,
      },
    );
    return fetcher.collect();
  }
}
