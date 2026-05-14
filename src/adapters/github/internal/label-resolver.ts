// =============================================================================
// src/adapters/github/internal/label-resolver.ts — Label & Milestone Resolution
//
// Single responsibility: manage GitHub label CRUD, repository node ID fetching,
// and hash-to-color utility for auto-generated label colors.
// =============================================================================

import { graphql } from "./http-client.ts";
import { GET_REPO_LABELS_QUERY } from "../queries.ts";
import type { RuntimeConfig } from "../config-loader.ts";

// ── Helper types ─────────────────────────────────────────────────────────────

export interface GitHubLabel {
  id: string;
  name: string;
  color: string;
  description: string;
}

interface RepoLabelsResponse {
  repository?: {
    labels?: {
      nodes: GitHubLabel[];
    };
  };
}

// ── LabelResolver class ──────────────────────────────────────────────────────

/**
 * Handles label CRUD operations, repository node ID fetching, and color hashing.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class LabelResolver {
  private readonly config: RuntimeConfig;
  private readonly gh: { graphql: typeof graphql };
  private readonly owner: string;
  private readonly repo: string;

  constructor(
    config: RuntimeConfig,
    gh: { graphql: typeof graphql },
    owner: string,
    repo: string,
  ) {
    this.config = config;
    this.gh = gh;
    this.owner = owner;
    this.repo = repo;
  }

  /** Fetch the repository node ID from GitHub GraphQL API */
  async fetchRepoNodeId(): Promise<string> {
    const result = await this.gh.graphql<{ repository?: { id: string } }>(
      `query GetRepo($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { id } }`,
      { owner: this.owner, repo: this.repo },
    );
    const nodeId = result?.repository?.id;
    if (!nodeId) {
      // todo: use enriched error wrapper
      throw new Error(`Could not fetch repository node ID for ${this.owner}/${this.repo}`);
    }
    return nodeId;
  }

  /** Resolve label names to node IDs, creating missing labels with auto-generated colors */
  async resolveLabelNodeIds(names: string[]): Promise<string[]> {
    const result = await this.gh.graphql<RepoLabelsResponse>(GET_REPO_LABELS_QUERY, {
      owner: this.owner,
      repo: this.repo,
    });
    const existingLabels: GitHubLabel[] = result?.repository?.labels?.nodes ?? [];
    const nodeIds: string[] = [];
    const missing: string[] = [];

    for (const name of names) {
      const found = existingLabels.find((l) => l.name === name);
      if (found) {
        nodeIds.push(found.id);
      } else {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      const repositoryId = await this.fetchRepoNodeId();
      for (const name of missing) {
        const color = this.hashToColor(name);
        const createResult = await this.gh.graphql<{ createLabel: { label: { id: string } } }>(
          `mutation CreateLabel($repositoryId: ID!, $name: String!, $color: String!) {
            createLabel(input: { repositoryId: $repositoryId, name: $name, color: $color }) {
              label { id }
            }
          }`,
          { repositoryId, name, color },
        );
        nodeIds.push(createResult.createLabel.label.id);
      }
    }

    return nodeIds;
  }

  /** Resolve a single label by name, creating it if it doesn't exist. Returns node ID or null. */
  async resolveOrCreateLabel(name: string): Promise<string | null> {
    const result = await this.gh.graphql<RepoLabelsResponse>(GET_REPO_LABELS_QUERY, {
      owner: this.owner,
      repo: this.repo,
    });
    const existingLabels: GitHubLabel[] = result?.repository?.labels?.nodes ?? [];
    const existing = existingLabels.find((l) => l.name === name);
    if (existing) {
      return existing.id;
    }
    // Create the label
    const repositoryId = await this.fetchRepoNodeId();
    const color = this.hashToColor(name);
    const createResult = await this.gh.graphql<{ createLabel?: { label?: { id: string } } }>(
      `mutation CreateLabel($repositoryId: ID!, $name: String!, $color: String!) {
        createLabel(input: { repositoryId: $repositoryId, name: $name, color: $color }) {
          label { id }
        }
      }`,
      { repositoryId, name, color },
    );
    return createResult.createLabel?.label?.id ?? null;
  }

  /** Add a label to the repo (used by vocabulary management) */
  async addLabel(value: string): Promise<{ created: boolean }> {
    const result = await this.gh.graphql<RepoLabelsResponse>(GET_REPO_LABELS_QUERY, {
      owner: this.owner,
      repo: this.repo,
    });
    const existingLabels: string[] = (result?.repository?.labels?.nodes ?? []).map((l) => l.name);
    if (existingLabels.includes(value)) {
      return { created: false };
    }
    const color = this.hashToColor(value);
    const repositoryId = await this.fetchRepoNodeId();
    await this.gh.graphql(
      `mutation CreateLabel($repositoryId: ID!, $name: String!, $color: String!) {
        createLabel(input: { repositoryId: $repositoryId, name: $name, color: $color }) {
          label { id name }
        }
      }`,
      { repositoryId, name: value, color },
    );
    return { created: true };
  }

  /** Generate a deterministic pastel color from a string name */
  hashToColor(name: string): string {
    const palette = [
      "f9d0c4",
      "d8f3dc",
      "d4e6f1",
      "e8daef",
      "ffeaa7",
      "fab1a0",
      "81ecec",
      "a29bfe",
      "fd79a8",
      "55efc4",
      "ff7675",
      "74b9ff",
      "a9def9",
      "c39bd3",
      "f6e58a",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return palette[Math.abs(hash) % palette.length];
  }
}
