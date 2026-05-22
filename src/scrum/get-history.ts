// src/scrum/get-history.ts — getHistoryUseCase
//
// Aligned with SprintSnapshot from ports.ts.
// Adds velocity statistics (average_completed_points).

import type {
  HistoryPort,
  ImpedimentPort,
  SprintHistoryEntry,
  SprintSnapshot,
  StoryListing,
} from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import { toSprintName } from "../domain/types.ts";
import { isTerminalStatus } from "../domain/rules/status.ts";
import { resolveTerminalDisplay } from "./config-helpers.ts";

// ── Return type ────────────────────────────────────────────────────────────────
// todo: the results should be a composition of the types declared in `ports.ts`
interface GetHistoryResult {
  sprints: SprintSnapshot[];
  window: number;
  average_completed_points: number;
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * Project BurndownStoryInput[] to StoryListing[] for history items.
 * All history items are marked writable: false (read-only).
 */
const projectStoriesToListings = (
  stories: SprintHistoryEntry["stories"],
  sprintName: string,
): StoryListing[] =>
  stories.map((s) => ({
    ref: { id: s.ref?.id ?? "", key: String(s.number) },
    title: s.title,
    status: s.status,
    story_points: s.points,
    priority: null, // BurndownStoryInput does not carry priority
    sprint: sprintName,
    writable: false, // history item — not safe to mutate
    has_dependencies: [], // history items have no body; dependencies not persisted in BurndownStoryInput
  }));

/**
 * Compute totals for a sprint's stories.
 * Uses config-driven terminal status detection via `isTerminalStatus()`.
 */
const computeTotals = (
  stories: SprintHistoryEntry["stories"],
  config: ScrumConfig,
): {
  by_status: Record<string, number>;
  committed_points: number;
  completed_points: number;
} => {
  const by_status: Record<string, number> = {};
  const terminalDisplay = resolveTerminalDisplay(config);
  for (const s of stories) {
    const key = s.status ?? "(none)";
    by_status[key] = (by_status[key] ?? 0) + 1;
  }
  const committed_points = stories.reduce((sum, s) => sum + s.points, 0);
  const completed_points = stories
    .filter((s) => isTerminalStatus(s.status, terminalDisplay))
    .reduce((sum, s) => sum + s.points, 0);
  return { by_status, committed_points, completed_points };
};

/**
 * Convert a completed SprintHistoryEntry to the canonical SprintSnapshot shape.
 */
const entryToSnapshot = async (
  entry: SprintHistoryEntry,
  backend: ImpedimentPort,
  scrumConfig: ScrumConfig,
): Promise<SprintSnapshot> => {
  const items = projectStoriesToListings(entry.stories, entry.info.name);
  const { by_status, committed_points, completed_points } = computeTotals(
    entry.stories,
    scrumConfig,
  );

  // Fetch impediments associated with this sprint
  const impediments = await backend.getSprintImpediments(toSprintName(entry.info.name));

  // todo: this should be a composition of the types declared ion `ports.ts`
  return {
    sprint: {
      name: entry.info.name,
      start_date: entry.info.startDate,
      end_date: entry.info.endDate,
      duration_days: entry.info.durationDays,
      days_remaining: 0, // completed sprint
    },
    items,
    total_count: items.length,
    totals: {
      by_status,
      story_points: committed_points,
      committed_points,
      completed_points,
    },
    impediments,
  };
};

// ── Public use case ────────────────────────────────────────────────────────────

export const getHistoryUseCase = async (
  backend: HistoryPort & ImpedimentPort,
  scrumConfig: ScrumConfig,
  window: number,
): Promise<GetHistoryResult> => {
  const entries = await backend.getCompletedSprintHistory(window);

  if (entries.length === 0) {
    return { sprints: [], window, average_completed_points: 0 };
  }

  const sprints = await Promise.all(
    entries.map((entry) => entryToSnapshot(entry, backend, scrumConfig)),
  );

  const totalCompleted = sprints.reduce(
    (sum, s) => sum + ("committed_points" in s.totals ? (s.totals.completed_points ?? 0) : 0),
    0,
  );
  const average_completed_points = Math.round((totalCompleted / sprints.length) * 100) / 100;

  return { sprints, window, average_completed_points };
};
