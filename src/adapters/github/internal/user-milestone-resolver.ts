// =============================================================================
// src/adapters/github/internal/user-milestone-resolver.ts - User Resolution
//
// Single responsibility: resolve GitHub user logins to node IDs.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type * as GH from "../generated/github-types.ts";
import { GET_USER_NODE_ID } from "../queries.ts";
import type { GitHubInfraContext } from "./infra-context.ts";

interface GetUserNodeIdResponse {
  user?: Pick<GH.User, "id"> | null;
}

/**
 * Resolves GitHub user logins to node IDs for assignee mutations.
 */
export class UserMilestoneResolver {
  constructor(private readonly ctx: GitHubInfraContext) {}

  async resolveUserNodeId(login: string): Promise<string> {
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
    return nodeId;
  }

  resolveUserNodeIds(logins: readonly string[]): Promise<string[]> {
    return Promise.all(logins.map((login) => this.resolveUserNodeId(login)));
  }
}
