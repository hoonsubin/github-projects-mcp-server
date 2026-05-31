// =============================================================================
// src/adapters/github/internal/project-items-query-builder.ts
// ProjectItemsQueryBuilder
//
// Builds the GraphQL query document for fetching GitHub Projects v2 items.
// Field selections come from ItemContent and ItemFieldValues fragments in
// operations.graphql via the fragment registry in queries.ts.
// =============================================================================

import type { OwnerType, PageInfoRef, ProjectItem, ProjectV2Ref } from "../types.ts";
import { getFragmentSource } from "../queries.ts";

export interface ProjectV2ItemsPage extends ProjectV2Ref {
  items: {
    totalCount: number;
    pageInfo: PageInfoRef;
    nodes: ProjectItem[];
  };
}

export interface ProjectItemsResponse {
  user?: { projectV2: ProjectV2ItemsPage | null } | null;
  organization?: { projectV2: ProjectV2ItemsPage | null } | null;
}

/**
 * Builds the GraphQL query document for fetching project items.
 * Pure query construction — no network, no context dependency.
 */
export class ProjectItemsQueryBuilder {
  constructor(private readonly ownerType: OwnerType) {}

  buildQuery(): string {
    const ownerField = this.ownerType === "user" ? "user" : "organization";
    const itemContentSource = getFragmentSource("ItemContent");
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
              ...ItemContent
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
