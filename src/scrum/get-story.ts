// =============================================================================
// src/scrum/get-story.ts — getStoryUseCase
//
// Receives backend: StoryPort.
// Returns ItemDetailResult from domain/types.ts.
// =============================================================================

import type { StoryPort } from "./ports.ts";
import type { ItemDetailResult, StoryRef } from "../domain/types.ts";
import { parseAcceptanceCriteria } from "../domain/rules/acceptance-criteria.ts";

/**
 * Get full details for a single story.
 */
export const getStoryUseCase = async (
  backend: StoryPort,
  ref: StoryRef,
): Promise<ItemDetailResult> => {
  const detail = await backend.getStoryDetail(ref);
  const acceptance_criteria = parseAcceptanceCriteria(detail.story.body);
  return {
    story: detail.story,
    comments: detail.comments,
    linked_artifacts: detail.linked_artifacts,
    acceptance_criteria: acceptance_criteria.map((ac) => ac.text),
  };
};
