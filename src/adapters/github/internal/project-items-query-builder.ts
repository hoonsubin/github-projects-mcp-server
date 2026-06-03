// =============================================================================
// src/adapters/github/internal/project-items-query-builder.ts
// ProjectItemsQueryBuilder
//
// Builds the GraphQL query document for fetching GitHub Projects v2 items.
// Field selections come from ItemContent / ItemContentAggregate and
// ItemFieldValues fragments in operations.graphql via queries.ts.
// =============================================================================

import type { OwnerType } from "../types.ts";
import { getFragmentSource } from "../queries.ts";
import { ownerRootField } from "./owner-graphql.ts";

export type { ProjectItemsResponse, ProjectV2ItemsPage } from "./project-items-response-types.ts";

/**
 * Builds the GraphQL query document for fetching project items.
 * Pure query construction — no network, no context dependency.
 */
export class ProjectItemsQueryBuilder {
  constructor(private readonly ownerType: OwnerType) {}

  /** Full content + field values — for board health and other Story-shaped consumers. */
  buildQuery(): string {
    return this.buildProjectItemsQuery("ItemContent");
  }

  /**
   * Lean content + field values — for aggregation scans that only need board
   * fields and minimal issue identity (number, title, type, state).
   */
  buildAggregateQuery(): string {
    return this.buildProjectItemsQuery("ItemContentAggregate");
  }

  private buildProjectItemsQuery(contentFragment: "ItemContent" | "ItemContentAggregate"): string {
    const ownerField = ownerRootField(this.ownerType);
    const itemContentSource = getFragmentSource(contentFragment);
    const itemFieldValuesSource = getFragmentSource("ItemFieldValues");

    return `
    query($login: String!, $number: Int!, $cursor: String) {
      ${ownerField}(login: $login) {
        projectV2(number: $number) {
          id
          items(first: 100, after: $cursor, orderBy: { field: POSITION, direction: ASC }) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              id type createdAt updatedAt isArchived
              ...${contentFragment}
              ...ItemFieldValues
            }
          }
        }
      }
    }

${itemContentSource}

${itemFieldValuesSource}
  `;
  }
}
