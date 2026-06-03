// =============================================================================
// board-item-projection.ts — In-memory projections of cached full board items
// =============================================================================

import type { ProjectItem } from "../types.ts";

/**
 * Project a full-board item (ItemContent + ItemFieldValues) to the lean
 * aggregate shape (ItemContentAggregate + ItemFieldValues) without a second
 * GraphQL round-trip.
 */
export const projectItemsToAggregateView = (
  items: readonly ProjectItem[],
): ProjectItem[] => {
  return items.map((item) => {
    const content = item.content;
    if (!content) return { ...item };

    if (content.__typename === "Issue") {
      return {
        ...item,
        content: {
          __typename: "Issue" as const,
          id: content.id,
          number: content.number,
          title: content.title,
          body: content.body,
          state: content.state,
          issueType: content.issueType,
        },
      };
    }
    if (content.__typename === "PullRequest") {
      return {
        ...item,
        content: {
          __typename: "PullRequest" as const,
          id: content.id,
          number: content.number,
          title: content.title,
          state: content.state,
        },
      };
    }
    if (content.__typename === "DraftIssue") {
      return {
        ...item,
        content: {
          __typename: "DraftIssue" as const,
          id: content.id,
          title: content.title,
        },
      };
    }
    return { ...item };
  });
};
