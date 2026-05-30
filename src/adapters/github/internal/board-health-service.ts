// =============================================================================
// src/adapters/github/internal/board-health-service.ts - Board Health Dashboard
//
// Computes aggregate board health metrics without returning individual story data.
// Called by GitHubProjectBackend.getBoardHealth() (P7d).
// =============================================================================

import { StoryQueryService } from "./story-query-service.ts";
import { ImpedimentService } from "./impediment-service.ts";
import { resolveSprint } from "./resolver.ts";
import { buildStoryFromRaw } from "../mappers.ts";
import { computeReadinessSummary } from "../../../domain/rules/readiness.ts";
import { ITEM_TYPES } from "../../../domain/types.ts";
import type { ReadinessBreakdown } from "../../../domain/types.ts";
import type { GitHubBootState } from "../bootstrap.ts";
import type { GitHubBackendConfig } from "../types.ts";
import type { ImpedimentListing } from "../../../scrum/ports.ts";
import type { BacklogHealth, SprintRef, SprintRisk, Story } from "../../../domain/types.ts";

// ── BoardHealthService class ──────────────────────────────────────────────────

/**
 * Board health dashboard - aggregated metrics without item lists.
 * Uses existing StoryQueryService and ImpedimentService; no new API queries.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class BoardHealthService {
  constructor(
    private readonly config: GitHubBootState,
    private readonly ghConfig: GitHubBackendConfig,
    private readonly storyQueryService: StoryQueryService,
    private readonly impedimentService: ImpedimentService,
  ) {}

  /**
   * Return board health metrics for the given sprint scope.
   *
   * @param sprintScope - "current" | "next" | "<name>" | "all"
   */
  async getBoardHealth(sprintScope: string): Promise<BacklogHealth> {
    const stories = await this.fetchStoriesForScope(sprintScope);

    // Exclude Done items from all active-work metrics - they're already resolved
    // and inflate risk counts and readiness percentages when included.
    const statusDisplay = this.ghConfig.status_display ?? {};
    const doneDisplayName = statusDisplay["done"] ?? "Done";
    const activeStories = stories.filter((s) => s.status !== doneDisplayName);

    // ── Readiness by type ─────────────────────────────────────────────────
    const readiness = this.computeReadinessByType(activeStories);

    // ── Sprint risk (count-based) ─────────────────────────────────────────
    const sprintRisk = this.computeSprintRiskCounts(sprintScope, activeStories);

    // ── Impediments ───────────────────────────────────────────────────────
    const impedimentCounts = await this.computeImpedimentCounts(sprintScope);

    // ── Ungroomed count ───────────────────────────────────────────────────
    const ungroomedCount = activeStories.filter((story) => {
      const missingType = !story.type;
      const missingEstimate = (story.story_points ?? 0) === 0;
      const missingAc = !/[-*]\s+\[[\s xX]\]/.test(story.body);
      return missingType || missingEstimate || missingAc;
    }).length;

    return {
      readiness: {
        by_type: readiness.by_type,
        overall_pct: readiness.overall_pct,
      },
      sprint_risk: sprintRisk,
      impediments: impedimentCounts,
      ungroomed_count: ungroomedCount,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Compute readiness-by-type breakdown and overall percentage.
   */
  private computeReadinessByType(
    stories: readonly Story[],
  ): {
    by_type: Record<string, ReadinessBreakdown>;
    overall_pct: number;
  } {
    const readinessByType: Record<string, ReadinessBreakdown> = {};
    let totalReady = 0;
    let totalNotReady = 0;

    for (const type of ITEM_TYPES) {
      readinessByType[type] = { ready: 0, not_ready: 0, total: 0 };
    }

    for (const story of stories) {
      const type = story.type ?? "untyped";
      if (!readinessByType[type]) {
        readinessByType[type] = { ready: 0, not_ready: 0, total: 0 };
      }
      readinessByType[type].total++;

      const { ready } = computeReadinessSummary([{
        body: story.body,
        story_points: story.story_points,
        has_dependencies: story.blocked_by.length > 0,
      }]);
      if (ready > 0) {
        readinessByType[type].ready++;
        totalReady++;
      } else {
        readinessByType[type].not_ready++;
        totalNotReady++;
      }
    }

    const overallPct = (totalReady + totalNotReady) > 0
      ? Math.round((totalReady / (totalReady + totalNotReady)) * 100)
      : 0;

    return { by_type: readinessByType, overall_pct: overallPct };
  }

  /**
   * Fetch all items and filter by sprint scope, returning domain Story objects.
   */
  private async fetchStoriesForScope(sprintScope: string): Promise<Story[]> {
    const allItems = await this.storyQueryService.fetchAllItems();

    if (sprintScope === "all") {
      return allItems
        .map((item) => buildStoryFromRaw(item, this.config))
        .filter((s): s is Story => s !== null);
    }

    // Resolve sprint scope to iteration ID
    const iterationId = resolveSprint(sprintScope, this.config);

    if (iterationId === null) return [];

    return allItems
      .filter((item) => {
        const sprintFv = item.fieldValues.nodes.find(
          (v) => v.field?.id === this.config.live.fields.sprintFieldId,
        );
        return sprintFv?.iterationId === iterationId;
      })
      .map((item) => buildStoryFromRaw(item, this.config))
      .filter((s): s is Story => s !== null);
  }

  /**
   * Compute sprint risk counts for the given sprint scope.
   * Returns null when no active/resolved sprint is available.
   */
  private computeSprintRiskCounts(
    sprintScope: string,
    stories: readonly Story[],
  ): SprintRisk | null {
    const iterationId = resolveSprint(sprintScope, this.config);
    if (iterationId === null) return null;

    // statusOptions maps display names → option IDs. Find the display name from
    // config's status_display map, then compare against story.status (also display name).
    const ghConfig = this.config.scrumConfig.backends.github as Record<string, unknown>;
    const statusDisplay = (ghConfig?.status_display ?? {}) as Record<string, string>;
    const blockedDisplayName = Object.entries(statusDisplay)
      .find(([canonical]) => canonical === "blocked")?.[1] ?? "Blocked";
    const unestimated = stories.filter((s) => (s.story_points ?? 0) === 0).length;
    const blocked = stories.filter((s) => s.status === blockedDisplayName).length;
    const noAssignee = stories.filter((s) => s.assignees.length === 0).length;

    return {
      unestimated_count: unestimated,
      blocked_count: blocked,
      no_assignee_count: noAssignee,
    };
  }

  /**
   * Count orphan and open impediments for the sprint scope.
   */
  private async computeImpedimentCounts(
    sprintScope: string,
  ): Promise<{ orphan_count: number; open_count: number }> {
    const orphans = await this.impedimentService.getOrphanImpediments();
    const orphanCount = orphans.filter(
      (i) => i.status === "open" || i.status === "in_progress",
    ).length;

    let sprintImpediments: ImpedimentListing[] = [];
    if (sprintScope !== "all") {
      const iterationId = resolveSprint(sprintScope, this.config);
      if (iterationId !== null) {
        sprintImpediments = await this.impedimentService.getSprintImpediments(
          sprintScope as SprintRef,
        );
      }
    } else {
      const sprint = resolveSprint("current", this.config);
      if (sprint !== null) {
        sprintImpediments = await this.impedimentService.getSprintImpediments("current");
      }
    }

    // Merge and deduplicate by ref.id using O(n) set lookup
    const seen = new Set(orphans.map((i) => i.ref.id));
    const allImpediments = [
      ...orphans,
      ...sprintImpediments.filter((i) => {
        if (seen.has(i.ref.id)) return false;
        seen.add(i.ref.id);
        return true;
      }),
    ];

    const openCount = allImpediments.filter(
      (i) => i.status === "open" || i.status === "in_progress",
    ).length;

    return { orphan_count: orphanCount, open_count: openCount };
  }
}
