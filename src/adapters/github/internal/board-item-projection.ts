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
  return items.map((item) => projectItemToAggregateView(item));
};

const projectItemToAggregateView = (item: ProjectItem): ProjectItem => {
  const content = item.content;
  if (!content) return item;

  if (content.__typename === "Issue") {
    return {
      ...item,
      content: {
        __typename: "Issue",
        id: content.id,
        number: content.number,
        title: content.title,
        body: content.body,
        state: content.state,
        closedAt: (content as { closedAt?: string | null }).closedAt ?? null,
        issueType: content.issueType,
      },
    } as unknown as ProjectItem;
  }
  if (content.__typename === "PullRequest") {
    return {
      ...item,
      content: {
        __typename: "PullRequest",
        id: content.id,
        number: content.number,
        title: content.title,
        state: content.state,
      },
    } as unknown as ProjectItem;
  }
  if (content.__typename === "DraftIssue") {
    return {
      ...item,
      content: {
        __typename: "DraftIssue",
        id: content.id,
        title: content.title,
      },
    } as unknown as ProjectItem;
  }
  return item;
};
