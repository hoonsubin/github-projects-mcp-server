// =============================================================================
// src/services/resolver.ts
//
// ── Phase 1, step 4: resolveSprint — COMPLETE ────────────────────────────────
// ── Phase 1, step 9: resolveStory  — COMPLETE ────────────────────────────────
// =============================================================================

import type { RuntimeConfig } from "../adapters/github/config-loader.ts";
import type { SprintRef, StoryRef } from "../types.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Resolved story — both node IDs the backend mutations need.
 * { number } path requires a GraphQL call; { id } path is a direct item lookup.
 */
export interface ResolvedStory {
  itemId: string; // project item node ID (PVTI_...)
  issueId: string; // issue node ID (I_kwDO...)
  issueNumber: number; // user-facing issue number
}

/** Minimal GitHub client interface — matches what index.ts passes in. */
interface GitHubClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

// ── GraphQL queries ───────────────────────────────────────────────────────────

/**
 * Lookup by issue number: returns the issue node ID and all project items
 * the issue belongs to (so we can filter to our project).
 */
const GET_ISSUE_BY_NUMBER_QUERY = `
  query GetIssueByNumber($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        id
        number
        projectItems(first: 10) {
          nodes {
            id
            project { id }
          }
        }
      }
    }
  }
`;

interface IssueByNumberResponse {
  repository?: {
    issue?: {
      id: string;
      number: number;
      projectItems: {
        nodes: Array<{
          id: string;
          project: { id: string };
        }>;
      };
    } | null;
  } | null;
}

/**
 * Lookup by project item ID (PVTI_...): returns the underlying issue ID
 * and number so the write tools can call updateIssue.
 */
const GET_ITEM_BY_ID_QUERY = `
  query GetProjectItemById($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        id
        content {
          ... on Issue {
            id
            number
          }
        }
      }
    }
  }
`;

interface ItemByIdResponse {
  node?: {
    id: string;
    content?: {
      id: string;
      number: number;
    } | null;
  } | null;
}

// ── resolveSprint ─────────────────────────────────────────────────────────────

/**
 * Resolve a SprintRef to a GitHub iteration ID (or null to clear the sprint field).
 * Pure function — operates on the already-fetched RuntimeConfig; no network call.
 *
 * - "current" → config.iterations.active?.id — throws if no active sprint
 * - "next"    → config.iterations.next?.id   — throws with a user-readable message if none scheduled
 * - null      → returns null (caller passes this to clear/remove the sprint field on an item)
 * - string    → case-insensitive title match against config.iterations.all; throws if no match
 */
export const resolveSprint = (
  ref: SprintRef,
  config: RuntimeConfig,
): string | null => {
  if (ref === null) {
    return null;
  }

  if (ref === "current") {
    if (!config.iterations.active) {
      throw new Error(
        "No active sprint found. There is no sprint currently running in this project. " +
          "Check the Sprint field in GitHub Projects to ensure a sprint iteration is configured.",
      );
    }
    return config.iterations.active.id;
  }

  if (ref === "next") {
    if (!config.iterations.next) {
      throw new Error(
        "No next sprint is scheduled. " +
          "Create a new sprint iteration in the GitHub Projects UI before assigning stories to it.",
      );
    }
    return config.iterations.next.id;
  }

  // Explicit sprint name — case-insensitive title match against all known iterations
  const normalised = ref.toLowerCase();
  const match = config.iterations.all.find(
    (iter) => iter.title.toLowerCase() === normalised,
  );
  if (!match) {
    const known = config.iterations.all.map((i) => `"${i.title}"`).join(", ");
    throw new Error(
      `Sprint "${ref}" not found. Known sprints: ${known || "(none)"}. ` +
        'Pass "current", "next", or an exact sprint title.',
    );
  }
  return match.id;
};

// ── resolveStory ──────────────────────────────────────────────────────────────

/**
 * Resolve a StoryRef to the GitHub node IDs needed for mutations.
 *
 * Two resolution paths:
 *
 * { number } — lookup by issue number in the configured repository.
 *   Queries `repository { issue(number:$n) { id, projectItems } }` and filters
 *   the returned project items to the one whose project.id matches config.projectId.
 *   Throws if the issue doesn't exist or isn't in this project.
 *
 * { id }     — treat id as a project item node ID (PVTI_...).
 *   Queries `node(id:$itemId) { ... on ProjectV2Item { content { ... on Issue } } }`.
 *   Throws if the item doesn't exist or its content is not an Issue (e.g., DraftIssue).
 *
 * At least one of { number, id } must be present; if both are provided, { id } wins
 * (it saves a round-trip).
 *
 * @param repoOwner - Owner of the repository (defaults to config.yml.project.owner for backward compat)
 */
export const resolveStory = async (
  ref: StoryRef,
  config: RuntimeConfig,
  github: GitHubClient,
  repoOwner?: string,
): Promise<ResolvedStory> => {
  if (!ref.number && !ref.id) {
    throw new Error(
      "StoryRef must contain at least one of { number } or { id }.",
    );
  }

  // ── Path A: item ID provided — fastest, single node lookup ─────────────────
  if (ref.id) {
    const data = await github.graphql<ItemByIdResponse>(GET_ITEM_BY_ID_QUERY, {
      itemId: ref.id,
    });

    const node = data.node;
    if (!node) {
      throw new Error(
        `Project item "${ref.id}" not found. The ID may be stale or the item was deleted.`,
      );
    }
    const issue = node.content;
    if (!issue) {
      throw new Error(
        `Project item "${ref.id}" is not an Issue (it may be a Draft or Pull Request). ` +
          "Only Issues are supported as Stories.",
      );
    }
    return {
      itemId: node.id,
      issueId: issue.id,
      issueNumber: issue.number,
    };
  }

  // ── Path B: issue number provided — lookup via repository query ─────────────
  const gh = config.yml.backends.github;
  if (!gh) {
    throw new Error("No GitHub backend configured in config.yml.");
  }
  // Primary repo is the first entry in tracked_repos.
  const repo = gh.tracked_repos[0];
  if (!repo) {
    throw new Error("backends.github.tracked_repos is empty — at least one repo is required.");
  }

  // Use explicit repoOwner if provided; otherwise use the configured owner.
  const repoOwnerResolved = repoOwner ?? gh.owner;
  const data = await github.graphql<IssueByNumberResponse>(
    GET_ISSUE_BY_NUMBER_QUERY,
    {
      owner: repoOwnerResolved,
      repo,
      number: ref.number!,
    },
  );

  const issue = data.repository?.issue;
  if (!issue) {
    throw new Error(
      `Issue #${ref.number} not found in ${repoOwnerResolved}/${repo}. ` +
        "Verify the issue number and ensure the token has Contents: Read access.",
    );
  }

  // Filter to the project item belonging to our project
  const projectItem = issue.projectItems.nodes.find(
    (item) => item.project.id === config.projectId,
  );
  if (!projectItem) {
    throw new Error(
      `Issue #${ref.number} exists in ${repoOwnerResolved}/${repo} but is not part of project #${gh.project_number}. ` +
        "Add the issue to the project before operating on it.",
    );
  }

  return {
    itemId: projectItem.id,
    issueId: issue.id,
    issueNumber: issue.number,
  };
};

// ── resolveBacklogItems ───────────────────────────────────────────────────────

import type { ProjectV2Item } from "../types.ts";
import { isBacklogItem, PaginatedProjectItemFetcher } from "./pagination.ts";

/**
 * Resolve all backlog items (items without a sprint assignment).
 *
 * Uses PaginatedProjectItemFetcher for efficient pagination with minimal payload.
 * Only fetches the sprint field value — not all 20 field values.
 *
 * @param config - RuntimeConfig with projectId and field IDs
 * @param github - GraphQL client
 * @returns Array of ProjectV2Item objects that are in the backlog
 */
export const resolveBacklogItems = (
  config: RuntimeConfig,
  github: GitHubClient,
): Promise<ProjectV2Item[]> => {
  const fetcher = new PaginatedProjectItemFetcher(config, github, {
    sprintFieldIds: [config.fields.sprintFieldId], // only need sprint field
    includeIssueContent: true,
    includePRContent: false,
    includeDraftIssueContent: false,
    pageSize: 100,
  });

  return fetcher.collect((item) => isBacklogItem(item, config.fields.sprintFieldId));
};
