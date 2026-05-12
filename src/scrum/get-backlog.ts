// =============================================================================
// src/scrum/get-backlog.ts — getBacklogUseCase
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// Receives backend: ProjectBackend and scrumConfig: ScrumConfig.
// =============================================================================

import type { ProjectBackend } from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import { computeReadinessSummary } from "../domain/rules/readiness.ts";

interface GetBacklogParams {
  search?: string;
  labels?: string[];
  priority?: string;
  epic?: string;
  limit?: number;
}

interface GetBacklogResult {
  stories: unknown[];
  total_count: number;
  readiness: { ready: number; partially_ready: number; not_ready: number };
}

/**
 * Get the product backlog: stories not assigned to any sprint.
 */
export const getBacklogUseCase = async (
  backend: ProjectBackend,
  _scrumConfig: ScrumConfig,
  params: GetBacklogParams,
): Promise<GetBacklogResult> => {
  const allStories = await backend.getBacklogStories();

  let stories = allStories;

  if (params.search) {
    const needle = params.search.toLowerCase();
    stories = stories.filter(
      (s) =>
        s.title.toLowerCase().includes(needle) ||
        s.body.toLowerCase().includes(needle),
    );
  }
  if (params.labels && params.labels.length > 0) {
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

  const readinessSummary = computeReadinessSummary(
    limitedStories.map((story) => ({
      body: story.body,
      story_points: story.story_points,
    })),
  );

  return {
    stories: limitedStories,
    total_count: totalCount,
    readiness: readinessSummary,
  };
};
