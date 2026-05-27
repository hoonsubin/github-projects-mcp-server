// =============================================================================
// src/adapters/github/internal/user-milestone-resolver.ts - User Resolution
//
// Single responsibility: manage resolution of GitHub users.
// Injected into GitHubProjectBackend via constructor (DIP).
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type * as GH from "../generated/github-types.ts";
import { GitHubClient } from "./http-client.ts";
import { RepoNodeIdProvider } from "./label-resolver.ts";
import { GET_USER_NODE_ID } from "../queries.ts";

// ── Response types ─────────────────────────────────────────────────────────────

/** Query projection for GET_USER_NODE_ID. */
interface GetUserNodeIdResponse {
  user?: Pick<GH.User, "id"> | null;
}

// ── UserMilestoneResolver class ───────────────────────────────────────────────

/**
 * Handles resolution of GitHub users.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class UserMilestoneResolver {
  private readonly gh: GitHubClient;
  private readonly owner: string;
  private readonly repo: string;
  private readonly repoNodeIdProvider: RepoNodeIdProvider;

  constructor(
    gh: GitHubClient,
    owner: string,
    repo: string,
    repoNodeIdProvider: RepoNodeIdProvider,
  ) {
    this.gh = gh;
    this.owner = owner;
    this.repo = repo;
    this.repoNodeIdProvider = repoNodeIdProvider;
  }

  /** Resolve a single user login to their GitHub node ID */
  async resolveUserNodeId(login: string): Promise<string> {
    const result = await this.gh.graphql<GetUserNodeIdResponse>(
      GET_USER_NODE_ID,
      { login },
    );
    const nodeId = result?.user?.id;
    if (!nodeId) {
      throw new GitHubApiError(`User "${login}" not found.`, {
        code: "NOT_FOUND",
        statusCode: 404,
        recovery:
          `Check that the GitHub username "${login}" is spelled correctly and the account exists.`,
        context: { login },
      });
    }
    return nodeId;
  }

  /** Resolve multiple user logins to their GitHub node IDs */
  async resolveUserNodeIds(logins: readonly string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const login of logins) {
      ids.push(await this.resolveUserNodeId(login));
    }
    return ids;
  }
}
