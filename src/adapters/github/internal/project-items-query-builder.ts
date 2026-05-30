// =============================================================================
// src/adapters/github/internal/project-items-query-builder.ts
// ProjectItemsQueryBuilder
//
// Builds the GraphQL query document for fetching GitHub Projects v2 items.
// Extracted from PaginatedProjectItemFetcher (Phase 1 of adapter refactoring)
// so that the fetcher is pure cursor-iteration infrastructure.
// =============================================================================

import type { OwnerType, PageInfoRef, ProjectItem, ProjectV2Ref } from "../types.ts";

// ---------------------------------------------------------------------------
// ItemFetchConfig — controls which field values are fetched
// ---------------------------------------------------------------------------

export interface ItemFetchConfig {
  /** Whether to fetch sprint iteration field values (default: true). */
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
 */
export class ProjectItemsQueryBuilder {
  constructor(
    private readonly ownerType: OwnerType,
    private readonly config: ItemFetchConfig = {},
  ) {}

  /** Build and return the full GraphQL query document for project items. */
  buildQuery(): string {
    const ownerField = this.ownerType === "user" ? "user" : "organization";
    const sprintFragment = this.config.sprint !== false
      ? `
        ... on ProjectV2ItemFieldIterationValue {
          field { ... on ProjectV2FieldCommon { id name } }
          iterationId
          title
          startDate
          duration
        }`
      : "";
    return `
    query($login: String!, $number: Int!, $cursor: String) {
      ${ownerField}(login: $login) {
        projectV2(number: $number) {
          id
          items(first: 100, after: $cursor, orderBy: { field: POSITION, direction: ASC }) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              type
              createdAt
              updatedAt
              isArchived
              content {
                __typename
                ... on Issue {
                  id number title body url state
                  assignees(first: 5) { nodes { login } }
                  labels(first: 10) { nodes { name color } }
                  milestone { id title }
                  repository { name nameWithOwner }
                }
                ... on PullRequest {
                  id number title body url state isDraft
                  assignees(first: 5) { nodes { login } }
                  labels(first: 10) { nodes { name color } }
                  repository { name nameWithOwner }
                }
                ... on DraftIssue {
                  id title body
                  assignees(first: 5) { nodes { login } }
                }
              }
              fieldValues(first: 20) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldTextValue {
                    field { ... on ProjectV2FieldCommon { id name } } text
                  }
                  ... on ProjectV2ItemFieldNumberValue {
                    field { ... on ProjectV2FieldCommon { id name } } number
                  }
                  ... on ProjectV2ItemFieldDateValue {
                    field { ... on ProjectV2FieldCommon { id name } } date
                  }
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    field { ... on ProjectV2FieldCommon { id name } } name color optionId
                  }
                  ... on ProjectV2ItemFieldUserValue {
                    field { ... on ProjectV2FieldCommon { id name } }
                    users(first: 5) { nodes { login } }
                  }
                  ... on ProjectV2ItemFieldLabelValue {
                    field { ... on ProjectV2FieldCommon { id name } }
                    labels(first: 5) { nodes { name color } }
                  }
                  ... on ProjectV2ItemFieldMilestoneValue {
                    field { ... on ProjectV2FieldCommon { id name } }
                    milestone { id title dueOn }
                  }
                  ... on ProjectV2ItemFieldRepositoryValue {
                    field { ... on ProjectV2FieldCommon { id name } }
                    repository { name nameWithOwner }
                  }${sprintFragment}
                }
              }
            }
          }
        }
      }
    }
  `;
  }
}
