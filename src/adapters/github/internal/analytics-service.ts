// =============================================================================
// src/adapters/github/internal/analytics-service.ts — Unified Sprint Analytics
//
// Merges SprintHistoryService + BurndownCalculator behind the AnalyticsPort
// interface. Called by GitHubProjectBackend.getAnalytics() (P7d).
// =============================================================================

import { SprintHistoryService } from "./sprint-history-service.ts";
import { BurndownCalculator } from "./burndown-calculator.ts";
import { resolveSprint } from "./resolver.ts";
import { computeSprintEndDate as _computeSprintEndDate } from "../../../scrum/sprint-math.ts";
import { buildDaySeries, buildIdealLine, buildSprintWindow } from "../../../scrum/sprint-math.ts";
import { historyEntryToItemListing } from "../../../scrum/listing-mappers.ts";
import type { RuntimeConfig } from "../config-loader.ts";
import type { AnalyticsQuery } from "../../../scrum/ports.ts";
import type {
  AnalyticsResult,
  BurndownDayPoint,
  BurndownResponse,
  BurndownSprintMeta,
  BurndownStory,
  IdealDayPoint,
  SprintRef,
  SprintSnapshot,
  SprintTotals,
} from "../../../domain/types.ts";

// ── AnalyticsService class ────────────────────────────────────────────────────

/**
 * Unified sprint analytics: burndown + history.
 * Wraps SprintHistoryService and BurndownCalculator behind a single method.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class AnalyticsService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly sprintHistoryService: SprintHistoryService,
    private readonly burndownCalculator: BurndownCalculator,
  ) {}

  /**
   * Return unified sprint analytics for the given query.
   *
   * - view "history"  → sprint velocity snapshots only
   * - view "burndown" → burndown chart for target sprint only
   * - view "both"     → burndown + history merged into one response
   */
  async getAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult> {
    const view = query.view ?? "both";
    const window = query.history_window ?? 5;

    if (view === "history") {
      const history = await this.buildHistory(window);
      return { burndown: null, history, window };
    }

    if (view === "burndown") {
      const burndown = await this.buildBurndown(query.sprint_ref ?? "current");
      return { burndown, history: null, window: 0 };
    }

    // both: run both in parallel
    const [burndown, history] = await Promise.all([
      this.buildBurndown(query.sprint_ref ?? "current"),
      this.buildHistory(window),
    ]);
    return { burndown, history, window };
  }

  // ── History builder ───────────────────────────────────────────────────────

  /**
   * Build SprintSnapshot[] from completed sprint history.
   * Transforms SprintHistoryService output into domain SprintSnapshot
   * with ItemListing items.
   */
  private async buildHistory(window: number): Promise<SprintSnapshot[]> {
    const entries = await this.sprintHistoryService.getCompletedSprintHistory(
      window,
    );
    if (entries.length === 0) return [];

    return entries.map((entry) => {
      const items = entry.stories.map((story) => historyEntryToItemListing(story, entry.info.name));

      const by_status: Record<string, number> = {};
      let totalPoints = 0;
      for (const story of entry.stories) {
        const status = story.status ?? "(No Status)";
        if (!by_status[status]) by_status[status] = 0;
        by_status[status]++;
        totalPoints += story.points;
      }

      // Count completed points: stories with "done" status (case-insensitive)
      const completedPoints = entry.stories
        .filter((s) => s.status?.toLowerCase() === "done")
        .reduce((acc, s) => acc + s.points, 0);

      const totals: SprintTotals = {
        kind: "completed",
        by_status,
        story_points: totalPoints,
        committed_points: totalPoints,
        completed_points: completedPoints,
      };

      return {
        sprint: {
          name: entry.info.name,
          start_date: entry.info.startDate,
          end_date: entry.info.endDate,
          duration_days: entry.info.durationDays,
          days_remaining: 0, // completed sprint — always 0
        },
        items,
        total_count: items.length,
        totals,
      };
    });
  }

  // ── Burndown builder ───────────────────────────────────────────────────────

  /**
   * Build a BurndownResponse for the specified sprint.
   * Uses BurndownCalculator for data collection and sprint-math for series
   * computation.
   */
  private async buildBurndown(
    sprintRef: string,
  ): Promise<BurndownResponse | null> {
    const sprint = resolveSprint(sprintRef, this.config);
    if (sprint === null) return null;

    const input = await this.burndownCalculator.getBurndownInput(
      sprintRef as SprintRef,
    );

    const iterEntry = this.config.iterations.all.find((i) => i.id === sprint);
    if (!iterEntry) return null;

    const window = buildSprintWindow(iterEntry);

    // Compute total committed points
    const committedPoints = input.stories.reduce(
      (acc, s) => acc + s.points,
      0,
    );

    // Resolve completion timestamps
    const { completions, dataSource, warning } = await this.burndownCalculator
      .resolveCompletionTimestamps(input);

    // Build burndown series using pure sprint-math helpers
    const ideal: IdealDayPoint[] = buildIdealLine(window, committedPoints);
    const series: BurndownDayPoint[] = buildDaySeries(
      input.stories,
      completions,
      window,
      committedPoints,
    );

    // Build per-story output for the response
    const stories: BurndownStory[] = input.stories.map((s) => ({
      number: s.number,
      title: s.title,
      points: s.points,
      status: s.status,
      completed_at: completions.get(s.number) ?? null,
    }));

    const meta: BurndownSprintMeta = {
      name: input.sprint.name,
      start_date: input.sprint.startDate,
      end_date: input.sprint.endDate,
      duration_days: input.sprint.durationDays,
      days_remaining: window.daysRemaining,
    };

    return {
      sprint: meta,
      data_source: dataSource,
      warning,
      series,
      ideal,
      stories,
    };
  }
}
