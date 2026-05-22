// =============================================================================
// src/adapters/github/internal/label-resolver.ts — Label & Milestone Resolution
//
// Single responsibility: manage GitHub label CRUD, repository node ID fetching,
// and hash-to-color utility for auto-generated label colors.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { GitHubClient } from "./http-client.ts";
import { CREATE_LABEL_MUTATION, GET_REPO_LABELS_QUERY, GET_REPO_QUERY } from "../queries.ts";
import type { RuntimeConfig } from "../config-loader.ts";

// ── Helper types ─────────────────────────────────────────────────────────────

export interface GitHubLabel {
  id: string;
  name: string;
  color: string;
  description: string;
}

/** Interface for providing repository node IDs. Satisfied by LabelResolver. */
export interface RepoNodeIdProvider {
  fetchRepoNodeId(): Promise<string>;
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
  private readonly gh: GitHubClient;
  private readonly owner: string;
  private readonly repo: string;

  constructor(
    config: RuntimeConfig,
    gh: GitHubClient,
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
      GET_REPO_QUERY,
      { owner: this.owner, repo: this.repo },
    );
    const nodeId = result?.repository?.id;
    if (!nodeId) {
      throw new GitHubApiError(
        `Could not fetch repository node ID for ${this.owner}/${this.repo}.`,
        {
          code: "NOT_FOUND",
          statusCode: 404,
          recovery: "Check that owner and repo in your configuration are spelled correctly, " +
            "the repository exists, and your token has Metadata (read) access to it.",
          context: { owner: this.owner, repo: this.repo },
        },
      );
    }
    return nodeId;
  }

  /** Fetch all existing labels for the repository */
  private async fetchAllLabels(): Promise<GitHubLabel[]> {
    const result = await this.gh.graphql<RepoLabelsResponse>(GET_REPO_LABELS_QUERY, {
      owner: this.owner,
      repo: this.repo,
    });
    return result?.repository?.labels?.nodes ?? [];
  }

  /**
   * Audit type labels: compare existing repo labels against the expected set.
   * Used by getPlatformState to surface missing label gaps to the agent.
   */
  async auditTypeLabels(): Promise<{ existing: string[]; expected: string[] }> {
    const labels = await this.fetchAllLabels();
    const existing = labels.map((l) => l.name);
    // Type vocabulary is now managed via the Type project board field (type_display in config.yml).
    // No labels are expected by the system — all label management is user-driven.
    const expected: string[] = [];
    return { existing, expected };
  }

  /** Resolve label names to node IDs, creating missing labels with auto-generated colors */
  async resolveOrCreateLabelNodeIds(names: string[]): Promise<string[]> {
    const existingLabels = await this.fetchAllLabels();
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
          CREATE_LABEL_MUTATION,
          { repositoryId, name, color },
        );
        nodeIds.push(createResult.createLabel.label.id);
      }
    }

    return nodeIds;
  }

  /**
   * Resolve label names to node IDs. Throws if any label does not already exist
   * on the repository — this is the correct behavior for story creation/update.
   *
   * Used by: StoryMutationService.createStory(), StoryMutationService.updateStory()
   */
  async resolveExistingLabelNodeIds(names: string[]): Promise<string[]> {
    const existingLabels = await this.fetchAllLabels();
    const nodeIds: string[] = [];
    const unknown: string[] = [];

    for (const name of names) {
      const found = existingLabels.find((l) => l.name === name);
      if (found) {
        nodeIds.push(found.id);
      } else {
        unknown.push(name);
      }
    }

    if (unknown.length > 0) {
      throw new GitHubApiError(
        `Cannot assign unknown label(s): ${unknown.join(", ")}. ` +
          `Available labels on ${this.owner}/${this.repo}: ${
            existingLabels.map((l) => l.name).join(", ")
          }.`,
        {
          code: "OPTION_NOT_FOUND",
          recovery:
            `Call scrum_orient to see all existing repo labels in platform_state.labels.existing. ` +
            `If you need to create a new label, use scrum_add_vocabulary with kind: "label" first, ` +
            `then assign it to the story.`,
          context: { unknown, available: existingLabels.map((l) => l.name) },
        },
      );
    }

    return nodeIds;
  }

  /** Resolve a single label by name, creating it if it doesn't exist. Returns node ID or null. */
  async resolveOrCreateLabel(name: string): Promise<string | null> {
    const existingLabels = await this.fetchAllLabels();
    const existing = existingLabels.find((l) => l.name === name);
    if (existing) {
      return existing.id;
    }
    // Create the label
    const repositoryId = await this.fetchRepoNodeId();
    const color = this.hashToColor(name);
    const createResult = await this.gh.graphql<{ createLabel?: { label?: { id: string } } }>(
      CREATE_LABEL_MUTATION,
      { repositoryId, name, color },
    );
    return createResult.createLabel?.label?.id ?? null;
  }

  /** Add a label to the repo (used by vocabulary management) */
  async addLabel(value: string): Promise<{ created: boolean }> {
    const existingLabels = await this.fetchAllLabels();
    const existingNames: string[] = existingLabels.map((l) => l.name);
    if (existingNames.includes(value)) {
      return { created: false };
    }
    const color = this.hashToColor(value);
    const repositoryId = await this.fetchRepoNodeId();
    await this.gh.graphql(
      CREATE_LABEL_MUTATION,
      { repositoryId, name: value, color },
    );
    return { created: true };
  }

  /** Generate a deterministic pastel color from a string name */
  private hashToColor(name: string): string {
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
