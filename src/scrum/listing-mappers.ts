// =============================================================================
// src/scrum/listing-mappers.ts — Shared Story → StoryListing / ItemListing mappers
//
// Eliminates duplication across get-backlog.ts, get-sprint.ts, and
// get-history.ts. Each function produces a StoryListing or ItemListing — a
// lightweight projection used in SprintSnapshot.items and BacklogResult.stories.
//
// StoryListing mappers (backward-compat for legacy use-cases removed in P6):
//   storyToListing — for active sprint / backlog items (Story domain type)
//   historyEntryToListing — for completed sprint history items (BurndownStoryInput)
//
// ItemListing mappers (for new use-cases: find-items.ts):
//   toItemListing — for active sprint / backlog items (Story domain type)
//   historyEntryToItemListing — for completed sprint history items (BurndownStoryInput)
// =============================================================================

import type { BurndownStoryInput } from "./ports.ts";
import type { ItemListing, ResolvedRef, Story } from "../domain/types.ts";

/** Sentinel ref used when an adapter has not yet provided a sprint node ID. */
const EMPTY_SPRINT_REF: ResolvedRef = { id: "" };

// ── ItemListing mappers — for find-items use-case ─────────────────────────────

/**
 * Project a domain Story to its enriched ItemListing entry.
 * Used by find-items.ts for active sprint / backlog items.
 *
 * sprint.ref is hardcoded to { id: "" } — known gap until the adapter
 * provides sprint node IDs (P7).
 */
export const toItemListing = (story: Story): ItemListing => ({
  ref: { id: story.ref.id, key: story.key },
  title: story.title,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  sprint: { name: story.sprint, ref: EMPTY_SPRINT_REF },
  epic: story.kind === "issue" ? story.epic : null,
  writable: true,
  has_dependencies: story.blocked_by,
});

/**
 * Project a BurndownStoryInput (history/burndown story) to a read-only
 * ItemListing entry scoped to the given sprint name.
 *
 * History items are not writable — the returned listing has writable: false,
 * no priority, no epic, and empty has_dependencies.
 */
export const historyEntryToItemListing = (
  story: BurndownStoryInput,
  sprintName: string,
  refIdFallback: string = "<history>",
): ItemListing => ({
  ref: { id: story.ref?.id ?? refIdFallback, key: String(story.number) },
  title: story.title,
  status: story.status,
  story_points: story.points,
  priority: null,
  sprint: { name: sprintName, ref: EMPTY_SPRINT_REF },
  epic: null,
  writable: false,
  has_dependencies: [],
});
