// =============================================================================
// src/scrum/get-story.ts — getStoryUseCase
//
// Receives backend: ProjectBackend.
// =============================================================================

import type { StoryPort } from "./ports.ts";
import type { Story, StoryRef } from "../domain/types.ts";
import { parseAcceptanceCriteria } from "../domain/rules/acceptance-criteria.ts";

// todo: the results should be a composition of the types declared in `ports.ts`
interface GetStoryResult {
  story: Story;
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
  backend: StoryPort,
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
