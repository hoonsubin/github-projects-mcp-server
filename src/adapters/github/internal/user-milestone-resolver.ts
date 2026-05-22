// =============================================================================
// src/adapters/github/internal/user-milestone-resolver.ts — User & Milestone Resolution
//
// Single responsibility: manage resolution of GitHub users and milestones.
// Injected into GitHubProjectBackend via constructor (DIP).
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { GitHubClient } from "./http-client.ts";
import { RepoNodeIdProvider } from "./label-resolver.ts";
import {
  CREATE_MILESTONE_MUTATION,
  GET_USER_MILESTONES_QUERY,
  GET_USER_NODE_ID,
} from "../queries.ts";

// ── UserMilestoneResolver class ───────────────────────────────────────────────

/**
 * Handles resolution of GitHub users and milestones.
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
    const result = await this.gh.graphql<{ user?: { id: string } }>(
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
  async resolveUserNodeIds(logins: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const login of logins) {
      ids.push(await this.resolveUserNodeId(login));
    }
    return ids;
  }

  // TODO: dead after EpicRef migration — remove in follow-up.
  // Epic refs now pass MI_ node IDs directly; no title→ID resolution needed.
  /** Resolve or create a milestone by title on the repository */
  async resolveOrCreateMilestoneNodeId(title: string): Promise<string> {
    // Check existing milestones on the repo
    const result = await this.gh.graphql<{
      repository?: { milestones?: { nodes: Array<{ id: string; title: string }> } };
    }>(GET_USER_MILESTONES_QUERY, { owner: this.owner, repo: this.repo });
    const nodes = result?.repository?.milestones?.nodes ?? [];
    const found = nodes.find((m) => m.title.toLowerCase() === title.toLowerCase());
    if (found) {
      return found.id;
    }

    // Create milestone if not found.
    // GitHub's createMilestone only accepts: repositoryId, title, description, dueOn.
    const repositoryId = await this.repoNodeIdProvider.fetchRepoNodeId();
    const createResult = await this.gh.graphql<{
      createMilestone: { milestone: { id: string } };
    }>(
      CREATE_MILESTONE_MUTATION,
      { repositoryId, title },
    );
    return createResult.createMilestone.milestone.id;
  }
}
