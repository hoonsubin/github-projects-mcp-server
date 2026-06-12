// =============================================================================
// src/scrum/utils/listing-mappers.ts - Shared Story → BacklogItemListing mappers
//
// Eliminates duplication across find-items use-cases. Each function produces a
// BacklogItemListing - a lightweight projection used in ItemSearchResult.items.
// =============================================================================

import type { BacklogItemListing, EntityRef, Story } from "../../domain/types.ts";

/** Sentinel ref used when an adapter has not yet provided a sprint node ID. */
const EMPTY_SPRINT_REF: EntityRef = { id: "" };

/**
 * Project a domain Story to its enriched ItemListing entry.
 * Used by find-items.ts for active sprint / backlog items.
 *
 * sprint.ref is hardcoded to { id: "" } - known gap until the adapter
 * provides sprint node IDs (P7).
 */
export const toItemListing = (story: Story): BacklogItemListing => ({
  ref: { id: story.ref.id, key: story.key ?? story.ref.id },
  title: story.title,
  type: story.type,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  assignees: [...story.assignees],
  labels: [...story.labels],
  sprint: { name: story.sprint, ref: EMPTY_SPRINT_REF },
  epic: story.kind === "issue" ? story.epic : null,
  blocked_by: [...story.blocked_by],
  blocks: [],
  custom_fields: {},
});
