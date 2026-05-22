// =============================================================================
// src/scrum/get-backlog.ts — getBacklogUseCase
//
// Returns lightweight StoryListing entries and orphan impediments.
// Active-item filter excludes Done stories with no sprint assigned.
// =============================================================================

import type { BacklogPort, EpicPort, ImpedimentListing, StoryListing } from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { EpicListing, Story } from "../domain/types.ts";
import { computeReadinessSummary } from "../domain/rules/readiness.ts";
import { isTerminalStatus } from "../domain/rules/status.ts";
import { resolveTerminalDisplay } from "./config-helpers.ts";

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
  epics: EpicListing[];
}

/** Project a full Story down to its lightweight StoryListing entry. */
const storyToListing = (story: Story): StoryListing => ({
  ref: { id: story.ref.id, key: story.key },
  title: story.title,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  sprint: story.sprint,
  writable: true,
  has_dependencies: story.blocked_by,
});

/**
 * Active-item definition: exclude items where status is terminal (done)
 * AND sprint is null (no sprint assigned). Stories that are Done inside an open
 * sprint remain visible. Stories that are Done with no sprint assigned are stale
 * and are excluded.
 *
 * Uses config-driven terminal status detection via `isTerminalStatus()`.
 */
const isActiveItem = (story: Story, config: ScrumConfig): boolean => {
  const terminalDisplay = resolveTerminalDisplay(config);
  const isDoneStatus = isTerminalStatus(story.status, terminalDisplay);
  const hasNoSprint = story.sprint === null;
  return !(isDoneStatus && hasNoSprint);
};

export const getBacklogUseCase = async (
  backend: BacklogPort & EpicPort,
  scrumConfig: ScrumConfig,
  params: GetBacklogParams,
): Promise<GetBacklogResult> => {
  const [allStories, orphanImpediments, epics] = await Promise.all([
    backend.getBacklogStories(),
    backend.getOrphanImpediments(),
    backend.getEpics(),
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
    stories = stories.filter((s) => s.epic?.name === params.epic);
  }

  const totalCount = stories.length;
  const limitedStories = stories.slice(0, params.limit ?? 50);

  // Compute readiness from full Story objects (limitedStories is still Story[] at this point)
  const readinessSummary = computeReadinessSummary(
    limitedStories.map((s) => ({
      body: s.body,
      story_points: s.story_points,
      has_dependencies: s.blocked_by.length > 0,
    })),
  );

  return {
    stories: limitedStories.map(storyToListing),
    total_count: totalCount,
    readiness: readinessSummary,
    orphan_impediments: orphanImpediments,
    epics,
  };
};
