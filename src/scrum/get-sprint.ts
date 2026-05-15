// =============================================================================
// src/scrum/get-sprint.ts — getSprintUseCase
//
// Returns SprintSnapshot for single sprint requests, SprintSnapshot[] for "all".
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// Receives backend: ProjectBackend.
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
  writable: true, // active sprint item — safe to mutate
});

/** Project a BurndownStoryInput to a writable StoryListing entry. */
const storyListingFromHistory = (story: BurndownStoryInput): StoryListing => ({
  ref: { id: `<history>`, key: String(story.number) },
  title: story.title,
  status: story.status,
  story_points: story.points,
  priority: null, // BurndownStoryInput does not carry priority
  sprint: null, // set below with sprint name
  writable: false, // history item — not safe to mutate
});

/** Build a SprintSnapshot for a single sprint resolved from a SprintRef. */
const buildSingleSnapshot = async (
  backend: SprintPort & ImpedimentPort,
  sprintRef: SprintRef,
): Promise<SprintSnapshot> => {
  const result = await backend.getSprintStories(sprintRef);

  if (!result.sprintInfo) {
    return {
      sprint: {
        name: "(no sprint)",
        start_date: "",
        end_date: "",
        duration_days: 0,
        days_remaining: null, // null only for "no sprint" case
      },
      items: [],
      total_count: 0,
      totals: { by_status: {}, story_points: 0 },
      impediments: [],
    };
  }

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
      // buildSprintMeta returns days_remaining?: number (undefined for null iterEntry)
      // For valid sprintInfo, it is always defined (Math.max(0, ...)).
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
 * Current and next fetches use .catch(() => null) because one or both
 * may not exist (e.g. no next sprint has been scheduled yet).
 */
const buildAllSnapshots = async (
  backend: SprintPort & ImpedimentPort & HistoryPort,
  limit: number,
): Promise<SprintAllResult> => {
  const [currentResult, nextResult, historyEntries] = await Promise.all([
    buildSingleSnapshot(backend, "current").catch(() => null),
    buildSingleSnapshot(backend, "next").catch(() => null),
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
      const impediments = await backend.getSprintImpediments(entry.info.name);

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
 * @param backend — ProjectBackend implementation
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
