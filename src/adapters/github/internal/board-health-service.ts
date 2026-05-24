// =============================================================================
// src/adapters/github/internal/board-health-service.ts — Board Health Dashboard
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
import type { RuntimeConfig } from "../config-loader.ts";
import type { ImpedimentListing } from "../../../scrum/ports.ts";
import type { BacklogHealth, SprintRef, SprintRiskStance, Story } from "../../../domain/types.ts";

// ── BoardHealthService class ──────────────────────────────────────────────────

/**
 * Board health dashboard — aggregated metrics without item lists.
 * Uses existing StoryQueryService and ImpedimentService; no new API queries.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class BoardHealthService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly storyQueryService: StoryQueryService,
    private readonly impedimentService: ImpedimentService,
  ) {}

  /**
   * Return board health metrics for the given sprint scope.
   *
   * @param sprintScope — "current" | "next" | "<name>" | "all"
   */
  async getBoardHealth(sprintScope: string): Promise<BacklogHealth> {
    const stories = await this.fetchStoriesForScope(sprintScope);

    // ── Status breakdown ──────────────────────────────────────────────────
    const by_status: Record<string, number> = {};
    for (const story of stories) {
      const status = story.status ?? "(No Status)";
      by_status[status] = (by_status[status] ?? 0) + 1;
    }

    // ── Type breakdown ────────────────────────────────────────────────────
    const by_type: Partial<Record<typeof ITEM_TYPES[number], number>> = {};
    for (const story of stories) {
      const type = story.type;
      if (type && ITEM_TYPES.includes(type as typeof ITEM_TYPES[number])) {
        by_type[type as typeof ITEM_TYPES[number]] =
          (by_type[type as typeof ITEM_TYPES[number]] ?? 0) + 1;
      }
    }

    // ── Sprint risk ───────────────────────────────────────────────────────
    const sprintRisk = this.computeSprintRisk(sprintScope);

    // ── Impediments ───────────────────────────────────────────────────────
    const impedimentCounts = await this.computeImpedimentCounts(sprintScope);

    // ── Readiness ─────────────────────────────────────────────────────────
    const readiness = computeReadinessSummary(
      stories.map((story) => ({
        body: story.body,
        story_points: story.story_points,
        has_dependencies: story.blocked_by.length > 0,
      })),
    );

    return {
      total_stories: stories.length,
      by_status,
      by_type,
      sprint_risk: sprintRisk,
      impediments: impedimentCounts,
      readiness,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

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
    const sprintRef = sprintScope === "current" || sprintScope === "next"
      ? sprintScope as "current" | "next"
      : sprintScope as never;
    const iterationId = resolveSprint(sprintRef, this.config);

    if (iterationId === null) return [];

    return allItems
      .filter((item) => {
        const sprintFv = item.fieldValues.nodes.find(
          (v) => v.field?.id === this.config.fields.sprintFieldId,
        );
        return sprintFv?.iterationId === iterationId;
      })
      .map((item) => buildStoryFromRaw(item, this.config))
      .filter((s): s is Story => s !== null);
  }

  /**
   * Compute sprint risk stance based on time elapsed.
   */
  private computeSprintRisk(sprintScope: string): SprintRiskStance | null {
    const sprint = sprintScope === "current" || sprintScope === "next"
      ? sprintScope as "current" | "next"
      : sprintScope as never;
    const iterationId = resolveSprint(sprint, this.config);
    if (iterationId === null) return null;

    const iterEntry = this.config.iterations.all.find((i) => i.id === iterationId);
    if (!iterEntry) return null;

    const start = new Date(iterEntry.startDate);
    start.setUTCHours(0, 0, 0, 0);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const daysTotal = iterEntry.duration;
    const daysElapsed = Math.max(
      0,
      Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
    );

    if (daysTotal <= 0) return null;
    const pct = daysElapsed / daysTotal;

    if (pct > 0.8) return "elevated";
    if (pct > 0.5) return "monitor";
    return "normal";
  }

  /**
   * Count open and in-progress impediments for the sprint scope.
   */
  private async computeImpedimentCounts(
    sprintScope: string,
  ): Promise<{ open: number; in_progress: number }> {
    let impediments: ImpedimentListing[] = [];

    if (sprintScope === "all") {
      const sprint = resolveSprint("current", this.config);
      if (sprint !== null) {
        impediments = await this.impedimentService.getSprintImpediments("current");
      }
      const orphans = await this.impedimentService.getOrphanImpediments();
      // Merge and deduplicate by ref.id
      const seen = new Set(impediments.map((i) => i.ref.id));
      for (const orphan of orphans) {
        if (!seen.has(orphan.ref.id)) {
          impediments.push(orphan);
          seen.add(orphan.ref.id);
        }
      }
    } else {
      const iterationId = resolveSprint(sprintScope as never, this.config);
      if (iterationId !== null) {
        impediments = await this.impedimentService.getSprintImpediments(
          sprintScope as SprintRef,
        );
      }
    }

    const open = impediments.filter((i) => i.status === "open").length;
    const inProgress = impediments.filter((i) => i.status === "in_progress").length;
    return { open, in_progress: inProgress };
  }
}
