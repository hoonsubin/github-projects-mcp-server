// =============================================================================
// src/adapters/github/internal/pagination.ts - PaginatedProjectItemFetcher
//
// Reusable abstraction for fetching GitHub Projects v2 items with cursor-based
// pagination. Optimized for minimal payload by allowing callers to specify
// which field values to include.
//
// Used by:
//   - Story 7 (scrum_find_items) - fetch all items, filter by null sprint
//   - Story 8 (scrum_get_sprint) - fetch items for a specific sprint
//   - Story 10 (scrum_get_burndown) - fetch items across sprints for velocity
//   - Future tools - any tool needing project item access
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type { GitHubBootState } from "../bootstrap.ts";
import type {
  ItemFieldValue,
  OwnerType,
  PageInfoRef,
  ProjectItem,
  ProjectItemDraftContent,
  ProjectItemIssueContent,
  ProjectItemPRContent,
  ProjectV2ItemRef,
  ProjectV2Ref,
} from "../types.ts";

// ---------------------------------------------------------------------------
// ItemFetchConfig — controls which field values are fetched
// ---------------------------------------------------------------------------

export interface ItemFetchConfig {
  /** Whether to fetch sprint iteration field values (default: true). */
  sprint?: boolean;
}

// ---------------------------------------------------------------------------
// PaginatedProjectItemFetcher
// ---------------------------------------------------------------------------

/**
 * Cursor-based paginated fetcher for GitHub Projects v2 items.
 *
 * Automatically fetches the first page on construction.
 *
 * @param config - GitHubBootState with project identity and field metadata
 * @param github - GraphQL client
 * @param options - Fetch configuration controlling payload size
 */
export class PaginatedProjectItemFetcher {
  private login: string;
  private projectNumber: number;
  private ownerType: OwnerType;
  private query: string;
  private items: ProjectItem[] = [];
  private pageInfo: PageInfoRef | null = null;
  private _totalCount = 0;

  constructor(
    private config: GitHubBootState,
    private github: { graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> },
    private options: ItemFetchConfig = {},
  ) {
    const ghConfig = config.ghConfig;
    this.login = ghConfig.owner;
    this.projectNumber = ghConfig.project_number;
    this.ownerType = ghConfig.owner_type;
    this.query = buildItemsQuery(this.ownerType, this.options);
  }

  /** Get total item count from the first page response. */
  get totalCount(): number {
    return this._totalCount;
  }

  /** Get all fetched items. */
  getAll(): ProjectItem[] {
    return this.items;
  }

  /** Fetch the first page. Called lazily by collect() on first invocation. */
  private async fetchFirstPage(): Promise<void> {
    const result = await this.github.graphql<ProjectItemsResponse>(this.query, {
      login: this.login,
      number: this.projectNumber,
    });
    const project = this.ownerType === "user"
      ? result.user?.projectV2
      : result.organization?.projectV2;
    if (!project) {
      throw new GitHubApiError(
        `Project #${this.projectNumber} not found for ${this.ownerType} '${this.login}'.`,
        {
          code: "NOT_FOUND",
          recovery: "Verify the project number and owner in backends.github config.",
        },
      );
    }
    this.items = [...(project.items?.nodes ?? [])];
    this.pageInfo = project.items?.pageInfo ?? null;
    this._totalCount = project.items?.totalCount ?? 0;
  }

  /** Fetch all remaining pages. Call after construction to get complete dataset. */
  async fetchRemaining(): Promise<void> {
    while (this.pageInfo?.hasNextPage && this.pageInfo.endCursor) {
      const result = await this.github.graphql<ProjectItemsResponse>(this.query, {
        login: this.login,
        number: this.projectNumber,
        cursor: this.pageInfo.endCursor,
      });
      const project = this.ownerType === "user"
        ? result.user?.projectV2
        : result.organization?.projectV2;
      const moreItems = project?.items?.nodes ?? [];
      this.items.push(...moreItems);
      this.pageInfo = project?.items?.pageInfo ?? null;
    }
  }

  /**
   * Collect all items matching the predicate, fetching additional pages as needed.
   */
  async collect(
    predicate: (item: ProjectItem) => boolean,
  ): Promise<ProjectItem[]> {
    if (this.pageInfo === null) await this.fetchFirstPage();
    const results: ProjectItem[] = [];
    for (const item of this.items) {
      if (predicate(item)) results.push(item);
    }
    while (this.pageInfo?.hasNextPage && this.pageInfo.endCursor) {
      const result = await this.github.graphql<ProjectItemsResponse>(this.query, {
        login: this.login,
        number: this.projectNumber,
        cursor: this.pageInfo.endCursor,
      });
      const project = this.ownerType === "user"
        ? result.user?.projectV2
        : result.organization?.projectV2;
      const moreItems = project?.items?.nodes ?? [];
      for (const item of moreItems) {
        if (predicate(item)) results.push(item);
        this.items.push(item);
      }
      this.pageInfo = project?.items?.pageInfo ?? null;
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Backlog item helper
// ---------------------------------------------------------------------------

export const isBacklogItem = (item: ProjectItem, sprintFieldId: string): boolean => {
  return !item.fieldValues.nodes.some((fv) => fv.field?.id === sprintFieldId && fv.iterationId);
};

// ---------------------------------------------------------------------------
// Query builders (private helpers)
// ---------------------------------------------------------------------------

interface ProjectItemsResponse {
  user?: { projectV2: ProjectV2ItemsPage | null } | null;
  organization?: { projectV2: ProjectV2ItemsPage | null } | null;
}

interface ProjectV2ItemsPage extends ProjectV2Ref {
  items: {
    totalCount: number;
    pageInfo: PageInfoRef;
    nodes: ProjectItem[];
  };
}

const buildItemsQuery = (ownerType: OwnerType, opts: ItemFetchConfig): string => {
  const ownerField = ownerType === "user" ? "user" : "organization";
  const sprintFragment = opts.sprint !== false
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
};

// Re-export types used by downstream consumers
export type {
  ItemFieldValue,
  ProjectItem,
  ProjectItemDraftContent,
  ProjectItemIssueContent,
  ProjectItemPRContent,
  ProjectV2ItemRef,
};
