// =============================================================================
// src/scrum/get-story.ts - getStoryUseCase
//
// Receives backend: StoryPort.
// Returns UseCaseResult<ItemDetailResult | null>.
// =============================================================================

import type { StoryPort } from "./ports.ts";
import type { ItemDetailResult, StoryRef, UseCaseResult } from "../domain/types.ts";
import { parseAcceptanceCriteria } from "../domain/rules/acceptance-criteria.ts";

/**
 * Get full details for a single story.
 *
 * backend.getStoryDetail() returns a BackendCallResult - partial data already
 * assembled with any sub-query failures captured as warnings. If the story
 * itself is unavailable the adapter throws, propagating to the framework layer.
 */
export const getStoryUseCase = async (
  backend: StoryPort,
  ref: StoryRef,
): Promise<UseCaseResult<ItemDetailResult>> => {
  const { value: detail, warnings } = await backend.getStoryDetail(ref);
  if (!detail) {
    // getStoryDetail throws on missing story - null here would be a bug
    throw new Error("getStoryDetail returned null value without throwing");
  }

  const acceptance_criteria = parseAcceptanceCriteria(detail.story.body);
  return {
    data: {
      story: detail.story,
      comments: detail.comments,
      linked_artifacts: detail.linked_artifacts,
      acceptance_criteria: acceptance_criteria.map((ac) => ac.text),
    },
    warnings,
  };
};
