// =============================================================================
// src/scrum/get-backlog.ts — getBacklogUseCase
//
// Returns lightweight StoryListing entries and orphan impediments.
// Active-item filter excludes Done stories with no sprint assigned.
// =============================================================================

import type { BacklogPort, ImpedimentListing, StoryListing } from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { Story } from "../domain/types.ts";
import { computeReadinessSummary } from "../domain/rules/readiness.ts";

interface GetBacklogParams {
  search?: string;
  labels?: string[];
  priority?: string;
  epic?: string;
  limit?: number;
}

interface GetBacklogResult {
  stories: StoryListing[];
  total_count: number;
  readiness: { ready: number; partially_ready: number; not_ready: number };
  orphan_impediments: ImpedimentListing[];
}

/** Project a full Story down to its lightweight StoryListing entry. */
const storyToListing = (story: Story): StoryListing => ({
  ref: { id: story.ref.id, key: story.key },
  title: story.title,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  sprint: story.sprint,
  writable: true, // Active backlog items are writable; see Step 7c.2 for future enhancement
});

/**
 * Check if a status string matches the terminal (done) status declared in config.
 *
 * Looks up the canonical key where `terminal: true` in `scrumConfig.scrum.status`,
 * then resolves its display name via `scrumConfig.backends.github.status_display`.
 * Falls back to `"Done"` if no terminal key is found.
 */
const isTerminalStatus = (status: string | null, config: ScrumConfig): boolean => {
  const scrumStatus = config.scrum.status ?? {};
  const terminalKey = Object.entries(scrumStatus).find(([, meta]) => meta.terminal)?.[0];
  if (!terminalKey) return (status?.toLowerCase() ?? "") === "done";

  const ghConfig = config.backends.github as Record<string, unknown>;
  const statusDisplay = (ghConfig.status_display as Record<string, string>) ?? {};
  const displayValue = statusDisplay[terminalKey] ?? "Done";

  return (status?.toLowerCase() ?? "") === displayValue.toLowerCase();
};

/**
 * Active-item definition: exclude items where status is terminal (done)
 * AND sprint is null (no sprint assigned). Stories that are Done inside an open
 * sprint remain visible. Stories that are Done with no sprint assigned are stale
 * and are excluded.
 *
 * Uses config-driven terminal status detection via `isTerminalStatus()`.
 */
const isActiveItem = (story: Story, config: ScrumConfig): boolean => {
  const isDoneStatus = isTerminalStatus(story.status, config);
  const hasNoSprint = story.sprint === null;
  return !(isDoneStatus && hasNoSprint);
};

export const getBacklogUseCase = async (
  backend: BacklogPort,
  scrumConfig: ScrumConfig,
  params: GetBacklogParams,
): Promise<GetBacklogResult> => {
  // Fetch stories and orphan impediments in parallel
  const [allStories, orphanImpediments] = await Promise.all([
    backend.getBacklogStories(),
    backend.getOrphanImpediments(),
  ]);

  // Apply active-item filter before any user-supplied filters to prevent stale data exposure
  let stories = allStories.filter((s) => isActiveItem(s, scrumConfig));

  // Apply optional query filters
  if (params.search) {
    const needle = params.search.toLowerCase();
    stories = stories.filter(
      (s) =>
        s.title.toLowerCase().includes(needle) ||
        s.body.toLowerCase().includes(needle),
    );
  }
  if (params.labels?.length) {
    stories = stories.filter((s) => params.labels!.every((l) => s.labels.includes(l)));
  }
  if (params.priority) {
    stories = stories.filter((s) => s.priority === params.priority);
  }
  if (params.epic) {
    stories = stories.filter((s) => s.epic === params.epic);
  }

  const totalCount = stories.length;
  const limitedStories = stories.slice(0, params.limit ?? 50);

  // Compute readiness from full Story objects (limitedStories is still Story[] at this point)
  const readinessSummary = computeReadinessSummary(
    limitedStories.map((s) => ({ body: s.body, story_points: s.story_points })),
  );

  return {
    stories: limitedStories.map(storyToListing),
    total_count: totalCount,
    readiness: readinessSummary,
    orphan_impediments: orphanImpediments,
  };
};
