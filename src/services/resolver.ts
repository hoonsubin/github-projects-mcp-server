// =============================================================================
// src/services/resolver.ts
//
// ── resolveSprint: resolve SprintRef → GitHub iteration ID ───────────────────
// ── resolveStory:  resolve StoryRef  → GitHub node IDs needed for mutations ──
// =============================================================================

import type { RuntimeConfig } from "../adapters/github/config-loader.ts";
import type { SprintRef, StoryRef } from "../domain/types.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Resolved story — the node IDs the backend mutations need.
 *
 * issueId / issueNumber are null for DraftIssue items.
 * Write tools that require a real Issue (e.g. addComment) must guard on null
 * and throw a clear error rather than crashing.
 */
interface ResolvedStory {
  itemId: string; // project item node ID (PVTI_...)
  issueId: string | null; // issue node ID (I_kwDO...), null for DraftIssues
  issueNumber: number | null; // user-facing issue number, null for DraftIssues
}

/** Minimal GitHub client interface — matches what index.ts passes in. */
interface GitHubClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

// ── GraphQL queries ───────────────────────────────────────────────────────────

/**
 * Lookup by project item ID (PVTI_...): returns the underlying content node.
 * Handles both real Issues and DraftIssues — DraftIssues have no issue ID or number.
 */
const GET_ITEM_BY_ID_QUERY = `
  query GetProjectItemById($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        id
        content {
          __typename
          ... on Issue {
            id
            number
          }
          ... on DraftIssue {
            id
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
      __typename: string;
      id: string;
      number?: number;
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
 * Uses ref.id as a project item node ID (PVTI_...) — the same opaque handle
 * returned by every read tool in Story.ref.id. A single `node()` lookup returns
 * the content type and underlying issue details.
 *
 * DraftIssue items resolve successfully: issueId and issueNumber are null.
 * Callers that require a real Issue (e.g. addComment) must guard on null and
 * throw a clear user-facing error.
 */
export const resolveStory = async (
  ref: StoryRef,
  github: GitHubClient,
): Promise<ResolvedStory> => {
  const data = await github.graphql<ItemByIdResponse>(GET_ITEM_BY_ID_QUERY, {
    itemId: ref.id,
  });

  const node = data.node;
  if (!node) {
    throw new Error(
      `Project item "${ref.id}" not found. The ID may be stale or the item was deleted. ` +
        "Use scrum_get_sprint or scrum_get_backlog to get a fresh Story.ref.id.",
    );
  }

  const content = node.content;
  if (!content) {
    throw new Error(
      `Project item "${ref.id}" has no content. It may have been deleted from the underlying repository.`,
    );
  }

  if (content.__typename === "DraftIssue") {
    return {
      itemId: node.id,
      issueId: null,
      issueNumber: null,
    };
  }

  if (content.__typename === "PullRequest") {
    throw new Error(
      `Project item "${ref.id}" is a Pull Request, not a Story. ` +
        "Only Issues and Draft Issues are supported as Stories.",
    );
  }

  // Issue — has id and number
  return {
    itemId: node.id,
    issueId: content.id,
    issueNumber: content.number ?? null,
  };
};
