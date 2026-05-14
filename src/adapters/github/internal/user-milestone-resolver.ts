// =============================================================================
// src/adapters/github/internal/user-milestone-resolver.ts — User & Milestone Resolution
//
// Single responsibility: manage resolution of GitHub users and milestones.
// Injected into GitHubProjectBackend via constructor (DIP).
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { graphql } from "./http-client.ts";

// ── UserMilestoneResolver class ───────────────────────────────────────────────

/**
 * Handles resolution of GitHub users and milestones.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class UserMilestoneResolver {
  private readonly gh: { graphql: typeof graphql };
  private readonly owner: string;
  private readonly repo: string;

  constructor(
    gh: { graphql: typeof graphql },
    owner: string,
    repo: string,
  ) {
    this.gh = gh;
    this.owner = owner;
    this.repo = repo;
  }

  /** Resolve a single user login to their GitHub node ID */
  async resolveUserNodeId(login: string): Promise<string> {
    const result = await this.gh.graphql<{ user?: { id: string } }>(
      `query GetUser($login: String!) { user(login: $login) { id } }`,
      { login },
    );
    const nodeId = result?.user?.id;
    if (!nodeId) {
      throw new GitHubApiError(`User "${login}" not found.`, 404);
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

  /** Resolve or create a milestone by title on the repository */
  async resolveOrCreateMilestoneNodeId(title: string): Promise<string> {
    // Check existing milestones on the repo
    const milestonesQuery = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          milestones(first: 100, states: [OPEN]) {
            nodes { id title }
          }
        }
      }
    `;
    const result = await this.gh.graphql<{
      repository?: { milestones?: { nodes: Array<{ id: string; title: string }> } };
    }>(milestonesQuery, { owner: this.owner, repo: this.repo });
    const nodes = result?.repository?.milestones?.nodes ?? [];
    const found = nodes.find((m) => m.title.toLowerCase() === title.toLowerCase());
    if (found) {
      return found.id;
    }

    // Create milestone if not found.
    // GitHub's createMilestone only accepts: repositoryId, title, description, dueOn.
    const repositoryId = await this.fetchRepoNodeId();
    const createResult = await this.gh.graphql<{
      createMilestone: { milestone: { id: string } };
    }>(
      `mutation CreateMilestone($repositoryId: ID!, $title: String!) {
        createMilestone(input: { repositoryId: $repositoryId, title: $title }) {
          milestone { id }
        }
      }`,
      { repositoryId, title },
    );
    return createResult.createMilestone.milestone.id;
  }

  /** Private helper to fetch the repository node ID for milestone creation */
  private async fetchRepoNodeId(): Promise<string> {
    const result = await this.gh.graphql<{ repository?: { id: string } }>(
      `query GetRepo($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { id } }`,
      { owner: this.owner, repo: this.repo },
    );
    const nodeId = result?.repository?.id;
    if (!nodeId) {
      throw new Error(`Could not fetch repository node ID for ${this.owner}/${this.repo}`);
    }
    return nodeId;
  }
}
