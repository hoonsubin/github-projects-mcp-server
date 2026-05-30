// =============================================================================
// src/adapters/github/internal/project-items-query-builder.ts
// ProjectItemsQueryBuilder
//
// Builds the GraphQL query document for fetching GitHub Projects v2 items.
// Extracted from PaginatedProjectItemFetcher (Phase 1 of adapter refactoring)
// so that the fetcher is pure cursor-iteration infrastructure.
//
// Phase 2: Uses fragment spreads (...ItemContent, ...ItemFieldValues) sourced
// from the fragment registry in queries.ts. No inline GraphQL field selections.
// =============================================================================

import type { OwnerType, PageInfoRef, ProjectItem, ProjectV2Ref } from "../types.ts";
import { getFragmentSource } from "../queries.ts";

// ---------------------------------------------------------------------------
// ItemFetchConfig — controls which field values are fetched
// ---------------------------------------------------------------------------

export interface ItemFetchConfig {
  /** Whether to fetch sprint iteration field values (default: true).
   *  NOTE: As of Phase 2, this option is a no-op — the ItemFieldValues
   *  fragment always includes iteration values. The field is retained for
   *  backward compatibility but no longer affects query construction. */
  sprint?: boolean;
}

// ---------------------------------------------------------------------------
// Response types shared with PaginatedProjectItemFetcher
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ProjectItemsQueryBuilder
// ---------------------------------------------------------------------------

/**
 * Builds the GraphQL query document for fetching project items.
 *
 * Pure query construction — no network, no context dependency.
 * Callers pass ownerType and ItemFetchConfig; the builder returns
 * the query string to hand to PaginatedProjectItemFetcher.
 *
 * Field selections come from the ItemContent and ItemFieldValues
 * fragments defined in operations.graphql, loaded via the fragment
 * registry in queries.ts. A field addition in operations.graphml
 * propagates automatically to every query produced by this builder.
 */
export class ProjectItemsQueryBuilder {
  constructor(
    private readonly ownerType: OwnerType,
    private readonly _config: ItemFetchConfig = {},
  ) {}

  /** Build and return the full GraphQL query document for project items. */
  buildQuery(): string {
    const ownerField = this.ownerType === "user" ? "user" : "organization";

    // Load fragment source text from the fragment registry.
    // These are the canonical field selections; any addition to
    // operations.graphql propagates here automatically.
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
