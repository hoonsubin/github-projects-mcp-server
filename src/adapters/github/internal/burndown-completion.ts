// =============================================================================
// burndown-completion.ts - Derive burndown completion times from board items
// =============================================================================

import type { ProjectItem } from "../types.ts";

/** Extract issue closedAt when present on board item content. */
export const issueClosedAtFromItem = (item: ProjectItem): string | null => {
  const content = item.content;
  if (content?.__typename !== "Issue") return null;
  const closedAt = (content as { closedAt?: string | null }).closedAt;
  return typeof closedAt === "string" ? closedAt : null;
};

/**
 * Build completion timestamps from preloaded board items using issue closedAt.
 * Only includes closes within [sprintStart, sprintEnd] (inclusive, UTC dates).
 */
export const completionsFromBoardItems = (
  items: readonly ProjectItem[],
  sprintStart: string,
  sprintEnd: string,
): Map<number, string> => {
  const startMs = new Date(`${sprintStart}T00:00:00Z`).getTime();
  const endMs = new Date(`${sprintEnd}T23:59:59.999Z`).getTime();
  const completions = new Map<number, string>();

  for (const item of items) {
    const content = item.content;
    if (content?.__typename !== "Issue" || content.number === null) continue;
    const closedAt = issueClosedAtFromItem(item);
    if (!closedAt) continue;
    const t = new Date(closedAt).getTime();
    if (t >= startMs && t <= endMs) {
      completions.set(content.number, closedAt);
    }
  }

  return completions;
};
