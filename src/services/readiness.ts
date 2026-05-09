// =============================================================================
// src/services/readiness.ts — Definition of Ready heuristics for GitHub API
//
// Computes readiness assessment for backlog stories against the team's
// Definition of Ready criteria.
//
// Definition of Ready (from config.yml):
//   - Written as a user story (who / what / why)
//   - Acceptance criteria defined and agreed by the team
//   - Estimated in story points
//   - Dependencies identified and de-risked
//   - Completable within one sprint
// =============================================================================

import type { StoryReadiness } from "../types.ts";

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

/**
 * Check if body matches user story format.
 * Pattern: "As a <role>, I want <goal>, so <benefit>"
 * Also matches: "As an <role>...", "As <role>..."
 * Supports multi-word roles (e.g., "As a team member", "As an end user").
 */
const hasUserStoryFormat = (body: string): boolean =>
  /As\s+(?:a|an)\s+(.+?),\s+I\s+(?:want|need|expect)\s+/i.test(body);

/**
 * Check if body contains acceptance criteria (markdown checkboxes).
 * Pattern: "- [ ]" or "- [x]" or "* [ ]" or "* [x]"
 */
const hasAcceptanceCriteria = (body: string): boolean => /[-*]\s+\[[\s xX]\]/.test(body);

/**
 * Check if body contains dependency references.
 * Patterns: "Depends on #123", "Blocked by #456", "Related to #789"
 */
const hasDependencies = (body: string): boolean =>
  /(?:Depends\s+on|Blocked\s+by|Related\s+to|Blocks)\s+#\d+/i.test(body);

/**
 * Check if body indicates the story is too large for one sprint.
 * Patterns: "Larger than a sprint", "Split into", "Part of epic", "Sub-task of"
 * Uses word boundaries to prevent false positives (e.g., "Repart of epic").
 */
const isTooLarge = (body: string): boolean =>
  /\b(?:Larger\s+than\s+(?:a\s+)?sprint|Split\s+into|Part\s+of\s+epic|Sub-task\s+of)\b/i.test(
    body,
  );

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Compute readiness for a single story against Definition of Ready criteria.
 *
 * Scoring:
 *   - 4+ criteria met AND not too large → ready (has_estimation_and_ac = true)
 *   - 2-3 criteria met → partially_ready
 *   - 0-1 criteria met → not_ready
 *
 * @param body - Story body markdown
 * @param storyPoints - Assigned story points (null = unestimated)
 * @returns StoryReadiness assessment
 */
export const computeStoryReadiness = (
  body: string,
  storyPoints: number | null,
): StoryReadiness => {
  const criteria = [
    hasUserStoryFormat(body),
    hasAcceptanceCriteria(body),
    (storyPoints ?? 0) > 0,
    hasDependencies(body),
  ];

  const score = criteria.filter(Boolean).length;
  const tooLarge = isTooLarge(body);

  if (score >= 4 && !tooLarge) {
    return { has_estimation_and_ac: true, partially_ready: false, not_ready: false };
  }

  if (score >= 2) {
    return { has_estimation_and_ac: false, partially_ready: true, not_ready: false };
  }

  return { has_estimation_and_ac: false, partially_ready: false, not_ready: true };
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
    if (readiness.has_estimation_and_ac) ready++;
    else if (readiness.partially_ready) partiallyReady++;
    else notReady++;
  }

  return { ready, partially_ready: partiallyReady, not_ready: notReady };
};
