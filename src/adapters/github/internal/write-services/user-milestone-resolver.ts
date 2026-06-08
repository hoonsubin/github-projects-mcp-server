// =============================================================================
// src/adapters/github/internal/user-milestone-resolver.ts - Actor Resolution
// =============================================================================

import { GitHubApiError } from "../../errors.ts";
import { RESOLVE_ACTOR_NODE_ID, RESOLVE_ASSIGNABLE_ACTOR } from "../../queries.ts";
import { mapWithConcurrency } from "../infra/concurrent.ts";
import type { GitHubInfraContext } from "../infra/infra-context.ts";

interface ResolveActorNodeIdResponse {
  user?: { id: string } | null;
  organization?: { id: string } | null;
}

interface AssignableActorNode {
  login: string;
  id?: string;
}

interface ResolveAssignableActorResponse {
  repository?: {
    suggestedActors?: {
      nodes: Array<AssignableActorNode | null>;
    } | null;
  } | null;
}

const USER_LOOKUP_CONCURRENCY = 6;

/**
 * Resolves GitHub actor logins (User, Organization, Bot) to node IDs for assignee mutations.
 */
export class UserMilestoneResolver {
  private readonly nodeIdByLogin = new Map<string, string>();
  private suggestedActorsCache: Map<string, string> | null = null;

  constructor(private readonly ctx: GitHubInfraContext) {}

  async resolveUserNodeId(login: string): Promise<string> {
    const cached = this.nodeIdByLogin.get(login);
    if (cached) return cached;

    const result = await this.ctx.gh.graphql<ResolveActorNodeIdResponse>(
      RESOLVE_ACTOR_NODE_ID,
      { login },
    );
    let nodeId = result?.user?.id ?? result?.organization?.id;

    if (!nodeId) {
      nodeId = await this.resolveAssignableActorNodeId(login);
    }

    if (!nodeId) {
      throw new GitHubApiError(`Actor "${login}" not found.`, {
        code: "NOT_FOUND",
        statusCode: 404,
        recovery: `Check that the GitHub login "${login}" is spelled correctly, ` +
          "the account exists, and it can be assigned to issues in this repository.",
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

  private async resolveAssignableActorNodeId(login: string): Promise<string | undefined> {
    const repo = this.ctx.repo;
    if (!repo) return undefined;

    if (!this.suggestedActorsCache) {
      const result = await this.ctx.gh.graphql<ResolveAssignableActorResponse>(
        RESOLVE_ASSIGNABLE_ACTOR,
        { owner: this.ctx.owner, repo },
      );
      this.suggestedActorsCache = new Map();
      for (const node of result.repository?.suggestedActors?.nodes ?? []) {
        if (node?.login && node.id) {
          this.suggestedActorsCache.set(node.login, node.id);
        }
      }
    }

    return this.suggestedActorsCache.get(login);
  }
}
