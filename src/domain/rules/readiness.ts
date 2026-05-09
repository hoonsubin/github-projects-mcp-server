// =============================================================================
// src/domain/rules/readiness.ts — Pure domain rule: Definition of Ready
//
// Extracted from services/readiness.ts as part of Story B (Phase 5).
// Replaces StoryReadiness interface with ReadinessLevel type.
// This module has no imports outside the standard library.
// =============================================================================

/**
 * Readiness level for a story against Definition of Ready criteria.
 * Replaces the awkward three-boolean StoryReadiness interface.
 */
export type ReadinessLevel = "ready" | "partially_ready" | "not_ready";

/**
 * Check if body matches user story format.
 * Pattern: "As a <role>, I want <goal>, so <benefit>"
 */
const hasUserStoryFormat = (body: string): boolean =>
  /As\s+(?:a|an)\s+(.+?),\s+I\s+(?:want|need|expect)\s+/i.test(body);

/**
 * Check if body contains acceptance criteria (markdown checkboxes).
 */
const hasAcceptanceCriteria = (body: string): boolean => /[-*]\s+\[[\s xX]\]/.test(body);

/**
 * Check if body contains dependency references.
 */
const hasDependencies = (body: string): boolean =>
  /(?:Depends\s+on|Blocked\s+by|Related\s+to|Blocks)\s+#\d+/i.test(body);

/**
 * Check if body indicates the story is too large for one sprint.
 */
const isTooLarge = (body: string): boolean =>
  /\b(?:Larger\s+than\s+(?:a\s+)?sprint|Split\s+into|Part\s+of\s+epic|Sub-task\s+of)\b/i.test(
    body,
  );

/**
 * Compute readiness for a single story against Definition of Ready criteria.
 *
 * Scoring:
 *   - 4+ criteria met AND not too large → "ready"
 *   - 2-3 criteria met → "partially_ready"
 *   - 0-1 criteria met → "not_ready"
 *
 * @param body - Story body markdown
 * @param storyPoints - Assigned story points (null = unestimated)
 * @returns ReadinessLevel assessment
 */
export const computeStoryReadiness = (
  body: string,
  storyPoints: number | null,
): ReadinessLevel => {
  const criteria = [
    hasUserStoryFormat(body),
    hasAcceptanceCriteria(body),
    (storyPoints ?? 0) > 0,
    hasDependencies(body),
  ];

  const score = criteria.filter(Boolean).length;
  const tooLarge = isTooLarge(body);

  if (score >= 4 && !tooLarge) {
    return "ready";
  }

  if (score >= 2) {
    return "partially_ready";
  }

  return "not_ready";
};

/**
 * Compute readiness summary across multiple stories.
 *
 * @param stories - Array of { body, story_points } tuples
 * @returns Readiness counts { ready, partially_ready, not_ready }
 */
export const computeReadinessSummary = (
  stories: Array<{ body: string; story_points: number | null }>,
): { ready: number; partially_ready: number; not_ready: number } => {
  let ready = 0;
  let partiallyReady = 0;
  let notReady = 0;

  for (const story of stories) {
    const readiness = computeStoryReadiness(story.body, story.story_points);
    if (readiness === "ready") ready++;
    else if (readiness === "partially_ready") partiallyReady++;
    else notReady++;
  }

  return { ready, partially_ready: partiallyReady, not_ready: notReady };
};
