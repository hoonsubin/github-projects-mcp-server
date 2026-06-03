// =============================================================================
// src/adapters/github/internal/user-milestone-resolver.ts - User Resolution
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type * as GH from "../generated/github-types.ts";
import { GET_USER_NODE_ID } from "../queries.ts";
import { mapWithConcurrency } from "./concurrent.ts";
import type { GitHubInfraContext } from "./infra-context.ts";

interface GetUserNodeIdResponse {
  user?: Pick<GH.User, "id"> | null;
}

const USER_LOOKUP_CONCURRENCY = 6;

/**
 * Resolves GitHub user logins to node IDs for assignee mutations.
 */
export class UserMilestoneResolver {
  private readonly nodeIdByLogin = new Map<string, string>();

  constructor(private readonly ctx: GitHubInfraContext) {}

  async resolveUserNodeId(login: string): Promise<string> {
    const cached = this.nodeIdByLogin.get(login);
    if (cached) return cached;

    const result = await this.ctx.gh.graphql<GetUserNodeIdResponse>(
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
    this.nodeIdByLogin.set(login, nodeId);
    return nodeId;
  }

  async resolveUserNodeIds(logins: readonly string[]): Promise<string[]> {
    const unique = [...new Set(logins.filter((l) => l.length > 0))];
    await mapWithConcurrency(
      unique,
      USER_LOOKUP_CONCURRENCY,
      (login) => this.resolveUserNodeId(login),
    );
    return Promise.all(logins.map((login) => this.resolveUserNodeId(login)));
  }
}
