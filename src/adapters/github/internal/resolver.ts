// =============================================================================
// src/adapters/github/internal/resolver.ts
//
// ── resolveSprint: resolve SprintRef → GitHub iteration ID ───────────────────
// ── resolveStory:  resolve StoryRef  → GitHub node IDs needed for mutations ──
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type * as GH from "../generated/github-types.ts";
import type { RuntimeConfig } from "../config-loader.ts";
import type { SprintRef, StoryRef } from "../../../domain/types.ts";
import type { GitHubIssueId, GitHubItemId } from "../types.ts";
import { GET_PROJECT_ITEM_BY_ID_QUERY } from "../queries.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Resolved story - the node IDs the backend mutations need.
 *
 * itemId is the project item node ID (PVTI_...) - branded as GitHubItemId.
 * issueId / issueNumber are null for DraftIssue items.
 * Write tools that require a real Issue (e.g. addComment) must guard on null
 * and throw a clear error rather than crashing.
 */
interface ResolvedStory {
  itemId: GitHubItemId;
  issueId: GitHubIssueId | null;
  issueNumber: number | null; // user-facing issue number, null for DraftIssues
}

/** Minimal GitHub client interface - matches what index.ts passes in. */
interface GitHubClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

/** Query projection of GH.ProjectV2Item for resolveStory. */
interface ItemByIdQueryNode extends Required<Pick<GH.ProjectV2Item, "id">> {
  content?: {
    __typename: string;
    id: string;
    number?: number;
  } | null;
}
interface ItemByIdResponse {
  node?: ItemByIdQueryNode | null;
}

// ── resolveSprint ─────────────────────────────────────────────────────────────

/**
 * Resolve a SprintRef to a GitHub iteration ID (or null to clear the sprint field).
 * Overload: accepts the strict SprintRef type.
 *
 * - "current"   → config.iterations.active.id - throws SprintNotScheduledError if none
 * - "next"      → config.iterations.next.id   - throws SprintNotScheduledError if none
 * - null        → returns null (clears the sprint field on an item)
 * - SprintName  → case-insensitive title match against config.iterations.all; throws if no match
 */
export function resolveSprint(ref: SprintRef, config: RuntimeConfig): string | null;

/**
 * Resolve a sprint string (from user input or scope parameter) to a GitHub iteration ID.
 * Accepts "current", "next", an explicit sprint name, or null/undefined.
 * Returns null for invalid or unresolvable strings (does NOT throw).
 */
export function resolveSprint(
  ref: string | null | undefined,
  config: RuntimeConfig,
): string | null;

/**
 * Implementation - handles both overloads.
 */
export function resolveSprint(
  ref: SprintRef | string | null | undefined,
  config: RuntimeConfig,
): string | null {
  if (ref === null || ref === undefined) {
    return null;
  }

  if (ref === "current") {
    if (!config.iterations.active) {
      throw new GitHubApiError(
        "No active sprint iteration configured in this project.",
        {
          code: "NOT_FOUND",
          recovery: "There is no sprint currently running. " +
            "Check the Sprint field in GitHub Projects to ensure a sprint iteration is configured.",
          context: { ref: "current" },
        },
      );
    }
    return config.iterations.active.id;
  }

  if (ref === "next") {
    if (!config.iterations.next) {
      throw new GitHubApiError(
        "No next sprint is scheduled in this project.",
        {
          code: "NOT_FOUND",
          recovery:
            "Create a new sprint iteration in the GitHub Projects UI before assigning stories to it.",
          context: { ref: "next" },
        },
      );
    }
    return config.iterations.next.id;
  }

  // For SprintRef (SprintName branded type) - throw on not found.
  // For plain string - return null on not found (user input may be invalid).
  const normalised = ref.toLowerCase();
  const match = config.iterations.all.find(
    (iter) => iter.title.toLowerCase() === normalised,
  );
  if (!match) {
    return null;
  }
  return match.id;
}

// ── resolveStory ──────────────────────────────────────────────────────────────

/**
 * Resolve a StoryRef to the GitHub node IDs needed for mutations.
 *
 * Uses ref.id as a project item node ID (PVTI_...) - the same opaque handle
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
  // resolveStory requires a resolved { id } ref - throw early if only { number } is given.
  if (!("id" in ref)) {
    throw new GitHubApiError(
      `resolveStory requires a resolved StoryRef with 'id', but received '{ number: ${ref.number} }'.`,
      {
        code: "RESOLUTION_FAILED",
        recovery: "Call resolveRef() first to convert issue numbers to opaque IDs.",
        context: { storyNumber: ref.number },
      },
    );
  }
  const data = await github.graphql<ItemByIdResponse>(GET_PROJECT_ITEM_BY_ID_QUERY, {
    itemId: ref.id,
  });

  const node = data.node;
  if (!node) {
    throw new GitHubApiError(
      `Project item "${ref.id}" not found.`,
      {
        code: "NOT_FOUND",
        statusCode: 404,
        recovery: "The ID may be stale or the item was deleted. " +
          "Use scrum_orient or scrum_find_items to get a fresh Story.ref.id.",
        context: { itemId: ref.id },
      },
    );
  }

  const content = node.content;
  if (!content) {
    throw new GitHubApiError(
      `Project item "${ref.id}" has no content.`,
      {
        code: "NOT_FOUND",
        statusCode: 404,
        recovery: "The item may have been deleted from the underlying repository. " +
          "Archive or remove it from the project board, then retry.",
        context: { itemId: ref.id },
      },
    );
  }

  if (content.__typename === "DraftIssue") {
    return {
      itemId: node.id as GitHubItemId,
      issueId: null,
      issueNumber: null,
    };
  }

  if (content.__typename === "PullRequest") {
    throw new GitHubApiError(
      `Project item "${ref.id}" is a Pull Request, not a Story.`,
      {
        code: "WRONG_CONTENT_TYPE",
        statusCode: 400,
        recovery: "Only Issues and Draft Issues are supported as Stories. " +
          "Use a Story ref from scrum_orient or scrum_find_items.",
        context: { itemId: ref.id, contentType: "PullRequest" },
      },
    );
  }

  // Issue - has id and number
  return {
    itemId: node.id as GitHubItemId,
    issueId: content.id as GitHubIssueId,
    issueNumber: content.number ?? null,
  };
};
