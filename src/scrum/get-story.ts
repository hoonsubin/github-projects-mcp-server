// =============================================================================
// src/scrum/get-story.ts — getStoryUseCase
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// Receives backend: ProjectBackend.
// =============================================================================

import type { ProjectBackend } from "./ports.ts";
import type { StoryRef } from "../types.ts";
import { parseAcceptanceCriteria } from "../domain/rules/acceptance-criteria.ts";

interface GetStoryResult {
  story: unknown;
  comments: Array<{ author: string; body: string; created_at: string; url: string }>;
  linked_prs: Array<
    { number: number; title: string; url: string; state: string; is_draft: boolean }
  >;
  acceptance_criteria: Array<{ text: string; checked: boolean }>;
}

/**
 * Get full details for a single story.
 */
export const getStoryUseCase = async (
  backend: ProjectBackend,
  ref: StoryRef,
): Promise<GetStoryResult> => {
  const detail = await backend.getStoryDetail(ref);
  const acceptance_criteria = parseAcceptanceCriteria(detail.story.body);
  return {
    story: detail.story,
    comments: detail.comments,
    linked_prs: detail.linkedPrs,
    acceptance_criteria,
  };
};
