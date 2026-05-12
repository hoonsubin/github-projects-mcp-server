// =============================================================================
// src/services/pagination.ts — PaginatedProjectItemFetcher
//
// Reusable abstraction for fetching GitHub Projects v2 items with cursor-based
// pagination. Optimized for minimal payload by allowing callers to specify
// which field values to include.
//
// Used by:
//   - Story 7 (scrum_get_backlog) — fetch all items, filter by null sprint
//   - Story 8 (scrum_get_sprint) — fetch items for a specific sprint
//   - Story 10 (scrum_get_burndown) — fetch items across sprints for velocity
//   - Future tools — any tool needing project item access
// =============================================================================

import type { RuntimeConfig } from "../adapters/github/config-loader.ts";
import type {
  GitHubBackendConfig,
  ItemContentType,
  ProjectItem,
  ProjectItemDraftContent,
  ProjectItemIssueContent,
  ProjectItemPRContent,
} from "../adapters/github/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for what data to fetch per project item.
 * Controls the GraphQL payload to minimize bandwidth.
 */
interface ItemFetchConfig {
  /** Which sprint field IDs to include in fieldValues (for backlog filtering). */
  sprintFieldIds?: string[];
  /** Whether to fetch Issue content (default true) */
  includeIssueContent?: boolean;
  /** Whether to fetch PR content (default false for backlog) */
  includePRContent?: boolean;
  /** Whether to fetch DraftIssue content (default false) */
  includeDraftIssueContent?: boolean;
  /** Page size (default 100, max per GitHub API) */
  pageSize?: number;
}

/** Internal GraphQL response shape for project items. */
interface ProjectItemsResponse {
  user?: {
    projectV2: {
      id: string;
      items: {
        totalCount: number;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RawProjectItem[];
      };
    };
  };
  organization?: {
    projectV2: {
      id: string;
      items: {
        totalCount: number;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RawProjectItem[];
      };
    };
  };
}

/** Raw item from GraphQL — mapped to ProjectItem by the fetcher. */
interface RawProjectItem {
  id: string;
  type: ItemContentType;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  content: RawContent;
  fieldValues: {
    nodes: RawFieldValue[];
  };
}

type RawContent =
  | { __typename: "Issue" } & Omit<ProjectItemIssueContent, "__typename">
  | { __typename: "PullRequest" } & Omit<ProjectItemPRContent, "__typename">
  | { __typename: "DraftIssue" } & Omit<ProjectItemDraftContent, "__typename">
  | null;

interface RawFieldValue {
  __typename: string;
  field?: { id: string; name: string };
  // Iteration
  iterationId?: string | null;
  title?: string;
  startDate?: string;
  duration?: number;
  // Text
  text?: string;
  // Number
  number?: number;
  // Date
  date?: string;
  // Single-select
  name?: string;
  color?: string;
  optionId?: string;
  // User
  users?: { nodes: Array<{ login: string }> };
  // Label
  labels?: { nodes: Array<{ name: string; color: string }> };
  // Milestone
  milestone?: { title: string; dueOn: string | null };
  // Repository
  repository?: { name: string; nameWithOwner: string };
}

// ---------------------------------------------------------------------------
// GraphQL Queries
// ---------------------------------------------------------------------------

/**
 * Build a minimal GraphQL query for project items.
 * Only includes content types and field values the caller needs.
 */
const buildItemsQuery = (
  ownerType: "user" | "org",
  config: ItemFetchConfig,
): string => {
  const _pageSize = config.pageSize ?? 100; // eslint-disable-line @typescript-eslint/no-unused-vars

  // Build content fragment based on what's requested
  const contentParts: string[] = [];

  if (config.includeIssueContent !== false) {
    contentParts.push(`
        ... on Issue {
          __typename id number title url state body
          assignees(first: 5) { nodes { login } }
          labels(first: 10) { nodes { name color } }
          milestone { title dueOn }
          repository { name nameWithOwner }
        }
    `);
  }

  if (config.includePRContent) {
    contentParts.push(`
        ... on PullRequest {
          __typename id number title url state body isDraft
          assignees(first: 5) { nodes { login } }
          labels(first: 10) { nodes { name color } }
          repository { name nameWithOwner }
        }
    `);
  }

  if (config.includeDraftIssueContent) {
    contentParts.push(`
        ... on DraftIssue {
          __typename id title body
          assignees(first: 5) { nodes { login } }
        }
    `);
  }

  const contentFragment = contentParts.join("\n");

  // Build fieldValues fragment — if sprintFieldIds provided, fetch only those
  const sprintFieldIds = config.sprintFieldIds;
  let fieldValuesFragment = "";

  if (sprintFieldIds && sprintFieldIds.length > 0) {
    // Fetch only the sprint field (minimal payload for backlog filtering)
    fieldValuesFragment = `
          fieldValues(first: 1) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldIterationValue {
                iterationId title startDate duration
                field { ... on ProjectV2FieldCommon { id name } }
              }
            }
          }
    `;
  } else {
    // Fetch all field values (default for sprint/burndown tools)
    fieldValuesFragment = `
          fieldValues(first: 20) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldSingleSelectValue { name color optionId field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldIterationValue { iterationId title startDate duration field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldUserValue { users(first: 5) { nodes { login } } field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldLabelValue { labels(first: 10) { nodes { name color } } field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldMilestoneValue { milestone { title dueOn } field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldRepositoryValue { repository { name nameWithOwner } field { ... on ProjectV2FieldCommon { id name } } }
            }
          }
    `;
  }

  const ownerKey = ownerType === "user" ? "user" : "organization";
  const loginArg = `login: $login`;

  return `
query GetProjectItems(
  $login: String!
  $number: Int!
  $first: Int!
  $after: String
) {
  ${ownerKey}(${loginArg}) {
    projectV2(number: $number) {
      id
      items(first: $first, after: $after) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id type createdAt updatedAt isArchived
          content {
            __typename
            ${contentFragment.trim()}
          }
          ${fieldValuesFragment.trim()}
        }
      }
    }
  }
}
  `.trim();
};

// ---------------------------------------------------------------------------
// PaginatedProjectItemFetcher
// ---------------------------------------------------------------------------

/**
 * A reusable paginated fetcher for GitHub Projects v2 items.
 *
 * Usage pattern:
 *   ```typescript
 *   const fetcher = new PaginatedProjectItemFetcher(config, github, options);
 *
 *   // Iterate lazily
 *   for await (const item of fetcher) {
 *     console.log(item.id);
 *   }
 *
 *   // Collect all (optionally filtered)
 *   const allItems = await fetcher.collect();
 *   const backlogItems = await fetcher.collect(isBacklog);
 *   ```
 */
export class PaginatedProjectItemFetcher {
  private hasNextPage: boolean = true;
  private endCursor: string | null = null;
  private totalCount: number = 0;
  private buffer: ProjectItem[] = [];
  private bufferIndex: number = 0;
  private query: string;
  private login: string;
  private projectNumber: number;
  private ownerType: "user" | "org";

  /**
   * Create a new paginated fetcher.
   * Automatically fetches the first page on construction.
   *
   * @param config - RuntimeConfig with project identity and field metadata
   * @param github - GraphQL client
   * @param options - Fetch configuration controlling payload size
   */
  constructor(
    private config: RuntimeConfig,
    private github: { graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> },
    private options: ItemFetchConfig = {},
  ) {
    const gh = config.scrumConfig.backends.github as GitHubBackendConfig | undefined;
    if (!gh) throw new Error("No GitHub backend configured in config.scrumConfig.");
    this.login = gh.owner;
    this.projectNumber = gh.project_number;
    this.ownerType = gh.owner_type;
    this.query = buildItemsQuery(this.ownerType, this.options);
  }

  /** Get total item count from the first page response. */
  getTotalCount(): number {
    return this.totalCount;
  }

  /** Check if more pages remain to be fetched. */
  hasMore(): boolean {
    return this.hasNextPage || this.bufferIndex < this.buffer.length;
  }

  /** Fetch the next page from the GitHub API. */
  private async _fetchPage(): Promise<void> {
    const variables = {
      login: this.login,
      number: this.projectNumber,
      first: this.options.pageSize ?? 100,
      after: this.endCursor,
    };

    const result = await this.github.graphql<ProjectItemsResponse>(this.query, variables);

    const project = this.ownerType === "user"
      ? result.user?.projectV2
      : result.organization?.projectV2;

    if (!project) {
      throw new Error(
        `Project #${this.projectNumber} not found for ${this.ownerType} '${this.login}'.`,
      );
    }

    const items = project.items;
    this.totalCount = items.totalCount;
    this.hasNextPage = items.pageInfo.hasNextPage;
    this.endCursor = items.pageInfo.endCursor;
    this.buffer = items.nodes.map(this._rawToItem);
    this.bufferIndex = 0;
  }

  /** Convert a raw GraphQL item to a typed ProjectItem. */
  private _rawToItem(raw: RawProjectItem): ProjectItem {
    return {
      id: raw.id,
      type: raw.type,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      isArchived: raw.isArchived,
      content: raw.content as ProjectItem["content"],
      fieldValues: {
        nodes: (raw.fieldValues?.nodes ?? []).map((fv) => ({
          __typename: fv.__typename,
          field: fv.field ?? { id: "", name: "" },
          iterationId: ("iterationId" in fv ? fv.iterationId : undefined) ?? undefined,
          title: fv.title,
          startDate: fv.startDate,
          duration: fv.duration,
          text: fv.text,
          number: fv.number,
          date: fv.date,
          name: fv.name,
          color: fv.color,
          optionId: fv.optionId,
          users: fv.users,
          labels: fv.labels,
          milestone: fv.milestone,
          repository: fv.repository,
        })),
      },
    };
  }

  /** AsyncIterator protocol — enables `for await` syntax. */
  async *[Symbol.asyncIterator](): AsyncIterator<ProjectItem> {
    while (this.hasNextPage || this.bufferIndex < this.buffer.length) {
      if (this.bufferIndex >= this.buffer.length) {
        await this._fetchPage();
        if (this.buffer.length === 0 && !this.hasNextPage) break;
      }
      yield this.buffer[this.bufferIndex++];
    }
  }

  /**
   * Collect all items (optionally filtered).
   *
   * @param filter - Optional predicate to filter items. If omitted, all items are collected.
   * @returns Array of matching ProjectItem objects
   */
  async collect(
    filter?: (item: ProjectItem) => boolean,
  ): Promise<ProjectItem[]> {
    const results: ProjectItem[] = [];
    for await (const item of this) {
      if (!filter || filter(item)) {
        results.push(item);
      }
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a project item is in the backlog (no sprint assignment).
 *
 * @param item - ProjectItem to check
 * @param sprintFieldId - The GraphQL field ID for the sprint field
 * @returns true if the item has no sprint assigned
 */
export const isBacklogItem = (
  item: ProjectItem,
  sprintFieldId: string,
): boolean => {
  const sprintValue = item.fieldValues.nodes.find(
    (fv) => fv.field?.id === sprintFieldId,
  );

  // No sprint field value at all = backlog
  if (!sprintValue) return true;

  // Iteration value with null iterationId = backlog
  if (sprintValue.__typename === "ProjectV2ItemFieldIterationValue") {
    return ("iterationId" in sprintValue ? sprintValue.iterationId : null) === null;
  }

  // Any other typename means the field exists but isn't an iteration — treat as backlog
  return true;
};
