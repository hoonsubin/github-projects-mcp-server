// =============================================================================
// src/adapters/github/internal/search-result-normalizer.ts
//
// Maps GitHub Search API issue nodes (with nested projectItems) to ProjectItem[]
// for consumption by ResultNormalizer.normalize().
// =============================================================================

import type { ItemFieldValue, ProjectItem } from "../../types.ts";

/** Minimal projection of a search result Issue node with nested project items. */
export interface SearchIssueNode {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly url: string | null;
  readonly state: "OPEN" | "CLOSED";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly issueType?: { id: string; name: string } | null;
  readonly assignees?: { nodes: Array<{ login: string } | null> };
  readonly labels?: { nodes: Array<{ name: string; color?: string | null } | null> };
  readonly milestone?: { id: string; title: string; dueOn?: string | null } | null;
  readonly blockedBy?: { nodes: Array<{ id: string; number: number; title: string | null }> };
  readonly repository?: { name: string; nameWithOwner: string };
  readonly projectItems?: {
    nodes: Array<
      {
        readonly project?: { id: string; number: number } | null;
        readonly id: string;
        readonly type: string;
        readonly createdAt: string;
        readonly updatedAt: string;
        readonly isArchived: boolean;
        readonly fieldValues?: { nodes: ItemFieldValue[] };
      } | null
    >;
  };
}

/**
 * Convert search issue nodes to ProjectItem[] for the configured project.
 * Issues without a matching project item are excluded (project-membership filter).
 */
export const searchIssuesToProjectItems = (
  nodes: readonly unknown[],
  projectNumber: number,
): ProjectItem[] => {
  const items: ProjectItem[] = [];

  for (const raw of nodes) {
    const issue = raw as SearchIssueNode;
    if (!issue?.id || typeof issue.number !== "number") continue;

    const projectItem = issue.projectItems?.nodes.find(
      (n) => n?.project?.number === projectNumber,
    );
    if (!projectItem) continue;

    items.push({
      id: projectItem.id,
      type: projectItem.type as ProjectItem["type"],
      createdAt: projectItem.createdAt,
      updatedAt: projectItem.updatedAt,
      isArchived: projectItem.isArchived,
      content: {
        __typename: "Issue",
        id: issue.id,
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        url: issue.url ?? "",
        state: issue.state,
        issueType: issue.issueType ?? null,
        assignees: {
          nodes: (issue.assignees?.nodes ?? [])
            .filter((n): n is { login: string } => n?.login !== undefined)
            .map((n) => ({ login: n.login })),
        },
        labels: {
          nodes: (issue.labels?.nodes ?? [])
            .filter((n): n is { name: string; color?: string | null } => n?.name !== undefined)
            .map((n) => ({ name: n.name, color: n.color ?? "" })),
        },
        milestone: issue.milestone ?? null,
        repository: issue.repository ?? { name: "", nameWithOwner: "" },
        blockedBy: {
          nodes: (issue.blockedBy?.nodes ?? []).map((n) => ({
            id: n.id,
            number: n.number,
            title: n.title ?? "",
          })),
        },
      },
      fieldValues: { nodes: projectItem.fieldValues?.nodes ?? [] },
    });
  }

  return items;
};
