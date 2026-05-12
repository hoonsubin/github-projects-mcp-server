// =============================================================================
// src/domain/rules/labels.ts — Pure domain rule: label classification
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// This module has no imports outside the standard library.
// =============================================================================

/**
 * The set of story type labels recognized by the domain.
 * Centralized here so consumers do not hard-code or repeat the values.
 */
const STORY_TYPE_LABELS = ["feature", "bug", "tech_debt", "spike"] as const;

/** A story type value — derived from STORY_TYPE_LABELS for type safety. */
export type StoryTypeLabel = (typeof STORY_TYPE_LABELS)[number];

/**
 * Classify labels into a story type and remaining labels.
 * The first label matching STORY_TYPE_LABELS becomes the type;
 * all matching labels are removed from the labels array.
 *
 * @param allLabels - Raw label names from the backend
 * @returns { type, labels } — type is null when no type label is present
 */
export const classifyLabels = (
  allLabels: string[],
): { type: StoryTypeLabel | null; labels: string[] } => {
  const typeSet = new Set(STORY_TYPE_LABELS);
  let found: StoryTypeLabel | null = null;
  for (const l of allLabels) {
    if (typeSet.has(l as StoryTypeLabel)) {
      found = l as StoryTypeLabel;
      break;
    }
  }
  return {
    type: found,
    labels: allLabels.filter((l) => !typeSet.has(l as StoryTypeLabel)),
  };
};
