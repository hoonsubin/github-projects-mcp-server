// GitHub Projects v2 GraphQL API types

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

// ── Projects ────────────────────────────────────────────────────────────────

export interface ProjectV2 {
  id: string;
  number: number;
  title: string;
  shortDescription: string | null;
  url: string;
  public: boolean;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
  readme: string | null;
  owner: { login: string; __typename: string };
  fields: { nodes: ProjectV2Field[] };
  items: { totalCount: number };
}

export interface ProjectV2Field {
  id: string;
  name: string;
  dataType: string;
  // Single-select specific
  options?: Array<{ id: string; name: string; color: string; description: string }>;
  // Iteration specific
  configuration?: {
    iterations: Array<{ id: string; title: string; startDate: string; duration: number }>;
    completedIterations: Array<{ id: string; title: string; startDate: string; duration: number }>;
  };
}

// ── Items / Cards ────────────────────────────────────────────────────────────

export type ItemContentType = "Issue" | "PullRequest" | "DraftIssue";

export interface ProjectV2ItemFieldValue {
  __typename: string;
  field: { name: string };
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
  // Iteration
  title?: string;
  startDate?: string;
  duration?: number;
  iterationId?: string;
  // User
  users?: { nodes: Array<{ login: string }> };
  // Label
  labels?: { nodes: Array<{ name: string; color: string }> };
  // Milestone
  milestone?: { title: string; dueOn: string | null };
  // Repository
  repository?: { name: string; nameWithOwner: string };
}

export interface ProjectV2Item {
  id: string;
  type: ItemContentType;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  fieldValues: { nodes: ProjectV2ItemFieldValue[] };
  content:
    | {
        __typename: "Issue";
        id: string;
        number: number;
        title: string;
        url: string;
        state: string;
        body: string;
        assignees: { nodes: Array<{ login: string }> };
        labels: { nodes: Array<{ name: string; color: string }> };
        milestone: { title: string; dueOn: string | null } | null;
        repository: { name: string; nameWithOwner: string };
      }
    | {
        __typename: "PullRequest";
        id: string;
        number: number;
        title: string;
        url: string;
        state: string;
        body: string;
        isDraft: boolean;
        assignees: { nodes: Array<{ login: string }> };
        labels: { nodes: Array<{ name: string; color: string }> };
        repository: { name: string; nameWithOwner: string };
      }
    | {
        __typename: "DraftIssue";
        id: string;
        title: string;
        body: string;
        assignees: { nodes: Array<{ login: string }> };
      }
    | null;
}

// ── GraphQL response wrappers ────────────────────────────────────────────────

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

export interface UserProjectsData {
  user: {
    projectsV2: {
      nodes: ProjectV2[];
      pageInfo: PageInfo;
      totalCount: number;
    };
  } | null;
}

export interface OrgProjectsData {
  organization: {
    projectsV2: {
      nodes: ProjectV2[];
      pageInfo: PageInfo;
      totalCount: number;
    };
  } | null;
}

export interface SingleProjectData {
  user?: {
    projectV2: ProjectV2 | null;
  };
  organization?: {
    projectV2: ProjectV2 | null;
  };
}

export interface ProjectItemsData {
  user?: {
    projectV2: {
      items: {
        nodes: ProjectV2Item[];
        pageInfo: PageInfo;
        totalCount: number;
      };
    } | null;
  };
  organization?: {
    projectV2: {
      items: {
        nodes: ProjectV2Item[];
        pageInfo: PageInfo;
        totalCount: number;
      };
    } | null;
  };
}

export interface AddProjectItemData {
  addProjectV2ItemById: {
    item: { id: string };
  };
}

export interface AddDraftIssueData {
  addProjectV2DraftIssue: {
    projectItem: { id: string };
  };
}

export interface UpdateProjectItemFieldData {
  updateProjectV2ItemFieldValue: {
    projectV2Item: { id: string };
  };
}

export interface DeleteProjectItemData {
  deleteProjectV2Item: {
    deletedItemId: string;
  };
}

export interface ArchiveProjectItemData {
  archiveProjectV2Item: {
    item: { id: string; isArchived: boolean };
  };
}

export interface UpdateProjectData {
  updateProjectV2: {
    projectV2: Pick<ProjectV2, "id" | "title" | "shortDescription" | "public" | "closed">;
  };
}
