// =============================================================================
// src/scrum/get-sprint.ts — getSprintUseCase
//
// Returns SprintSnapshot for single sprint requests, SprintSnapshot[] for "all".
// Receives backend: SprintPort & ImpedimentPort & HistoryPort.
//
// "all" is intentionally excluded from SprintRef because it is a query-mode flag,
// not a sprint reference. Other tools that accept SprintRef will resolve "all"
// to null via resolveSprint(), which is safe for their use case.
// =============================================================================

import type {
  BurndownStoryInput,
  HistoryPort,
  ImpedimentPort,
  SprintPort,
  SprintSnapshot,
  StoryListing,
} from "./ports.ts";
import type { SprintRef, Story } from "../domain/types.ts";
import { toSprintName } from "../domain/types.ts";
import { SprintNotScheduledError } from "../domain/errors.ts";
import { buildSprintMeta } from "./sprint-math.ts";

// ── Private helpers ────────────────────────────────────────────────────────────

/** Project a Story to its lightweight StoryListing entry. */
const storyToListing = (story: Story): StoryListing => ({
  ref: { id: story.ref.id, key: story.key },
  title: story.title,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  sprint: story.sprint,
  writable: true,
  has_dependencies: story.blocked_by.length > 0,
});

/** Project a BurndownStoryInput to a writable StoryListing entry. */
const storyListingFromHistory = (story: BurndownStoryInput): StoryListing => ({
  ref: { id: `<history>`, key: String(story.number) },
  title: story.title,
  status: story.status,
  story_points: story.points,
  priority: null,
  sprint: null,
  writable: false,
  has_dependencies: false,
});

/** Build a SprintSnapshot for a single sprint resolved from a SprintRef. */
const buildSingleSnapshot = async (
  backend: SprintPort & ImpedimentPort,
  sprintRef: SprintRef,
): Promise<SprintSnapshot> => {
  if (sprintRef === null) {
    return {
      sprint: {
        name: "(no sprint)",
        start_date: "",
        end_date: "",
        duration_days: 0,
        days_remaining: 0,
      },
      items: [],
      total_count: 0,
      totals: { by_status: {}, story_points: 0 },
      impediments: [],
    };
  }

  const result = await backend.getSprintStories(sprintRef);
  const { name, startDate, endDate, durationDays } = result.sprintInfo;
  const items = result.stories.map(storyToListing);

  const by_status: Record<string, number> = {};
  for (const item of items) {
    const s = item.status ?? "(none)";
    by_status[s] = (by_status[s] ?? 0) + 1;
  }

  const meta = buildSprintMeta({
    id: "",
    title: name,
    startDate,
    duration: durationDays,
  });

  // Fetch impediments associated with this sprint
  const impediments = await backend.getSprintImpediments(sprintRef);

  return {
    sprint: {
      name,
      start_date: startDate,
      end_date: endDate,
      duration_days: durationDays,
      days_remaining: meta.days_remaining ?? 0,
    },
    items,
    total_count: items.length,
    totals: {
      by_status,
      story_points: items.reduce((s, i) => s + (i.story_points ?? 0), 0),
    },
    impediments,
  };
};

// ── Return types ───────────────────────────────────────────────────────────────

interface SprintSingleResult {
  sprint: SprintSnapshot;
}

interface SprintAllResult {
  sprints: SprintSnapshot[];
  total_count: number;
}

// ── "all" branch ───────────────────────────────────────────────────────────────

/**
 * "all" returns: active sprint + next sprint (if any) + completed sprints up to limit.
 *
 * "all" is intentionally excluded from SprintRef because it is a query-mode flag,
 * not a sprint reference.
 *
 * Current and next fetches catch SprintNotScheduledError (absent sprint is expected)
 * but re-throw any other error so auth failures and network errors are not swallowed.
 */
const buildAllSnapshots = async (
  backend: SprintPort & ImpedimentPort & HistoryPort,
  limit: number,
): Promise<SprintAllResult> => {
  const [currentResult, nextResult, historyEntries] = await Promise.all([
    buildSingleSnapshot(backend, "current").catch((err) => {
      if (err instanceof SprintNotScheduledError) return null;
      throw err;
    }),
    buildSingleSnapshot(backend, "next").catch((err) => {
      if (err instanceof SprintNotScheduledError) return null;
      throw err;
    }),
    backend.getCompletedSprintHistory(limit),
  ]);

  const snapshots: SprintSnapshot[] = [];

  if (currentResult) snapshots.push(currentResult);
  if (nextResult) snapshots.push(nextResult);

  // Remaining slots for completed sprints (limit is total cap, not additional)
  const remainingSlots = Math.max(0, limit - snapshots.length);
  const completedSnapshots = await Promise.all(
    historyEntries.slice(0, remainingSlots).map(async (entry) => {
      const items: StoryListing[] = entry.stories.map(storyListingFromHistory);

      // Set sprint name after projection (history items don't carry it)
      for (const item of items) {
        item.sprint = entry.info.name;
      }

      const by_status: Record<string, number> = {};
      for (const item of items) {
        const st = item.status ?? "(none)";
        by_status[st] = (by_status[st] ?? 0) + 1;
      }

      // Fetch impediments associated with this completed sprint
      const impediments = await backend.getSprintImpediments(toSprintName(entry.info.name));

      return {
        sprint: {
          name: entry.info.name,
          start_date: entry.info.startDate,
          end_date: entry.info.endDate,
          duration_days: entry.info.durationDays,
          days_remaining: 0, // completed sprint — 0 days remaining (not null)
        },
        items,
        total_count: items.length,
        totals: {
          by_status,
          story_points: items.reduce((s, i) => s + (i.story_points ?? 0), 0),
        },
        impediments,
      };
    }),
  );

  snapshots.push(...completedSnapshots);

  return { sprints: snapshots, total_count: snapshots.length };
};

// ── Public use case ────────────────────────────────────────────────────────────

/**
 * Get sprint board data.
 *
 * @param backend — SprintPort & ImpedimentPort & HistoryPort implementation
 * @param sprintRef — sprint reference or "all" for multi-snapshot mode
 * @param limit — max sprints to return when sprintRef is "all"
 * @returns SprintSingleResult for single sprint, SprintAllResult for "all"
 */
export const getSprintUseCase = async (
  backend: SprintPort & ImpedimentPort & HistoryPort,
  sprintRef: SprintRef | "all",
  limit = 50,
): Promise<SprintSingleResult | SprintAllResult> => {
  if (sprintRef === "all") {
    return buildAllSnapshots(backend, limit);
  }
  const snapshot = await buildSingleSnapshot(backend, sprintRef);
  return { sprint: snapshot };
};
