// =============================================================================
// src/adapters/github/internal/vocabulary-manager.ts — Vocabulary Management
//
// Single responsibility: manage project vocabulary (status, priority, labels).
// Injected into GitHubProjectBackend via constructor (DIP).
// Depends on LabelResolver for label operations.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { type GitHubClient } from "./http-client.ts";
import { LabelResolver } from "./label-resolver.ts";
import type { RuntimeConfig } from "../config-loader.ts";
import type { VocabularyKind } from "../../../scrum/ports.ts";

// ── Helper types ─────────────────────────────────────────────────────────────

interface SingleSelectFieldNode {
  id: string;
  name: string;
  color: string;
  description: string;
}

interface GetFieldOptionsResponse {
  node?: {
    options: Array<SingleSelectFieldNode>;
  } | null;
}

// ── VocabularyManager class ──────────────────────────────────────────────────

/**
 * Manages project vocabulary (status, priority, labels).
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class VocabularyManager {
  private readonly config: RuntimeConfig;
  private readonly gh: GitHubClient;
  private readonly labelResolver: LabelResolver;
  private readonly owner: string;
  private readonly repo: string;

  constructor(
    config: RuntimeConfig,
    gh: GitHubClient,
    labelResolver: LabelResolver,
    owner: string,
    repo: string,
  ) {
    this.config = config;
    this.gh = gh;
    this.labelResolver = labelResolver;
    this.owner = owner;
    this.repo = repo;
  }

  /** Add a new vocabulary option (status or priority) */
  async addVocabulary(kind: VocabularyKind, value: string): Promise<{ created: boolean }> {
    switch (kind) {
      case "status_option":
        return await this.addStatusOption(value);
      case "priority_option":
        return await this.addPriorityOption(value);
      case "label":
        return await this.labelResolver.addLabel(value);
      default:
        throw new Error(`Unknown vocabulary kind: ${kind}`);
    }
  }

  private async addStatusOption(value: string): Promise<{ created: boolean }> {
    const fieldId = this.config.fields.statusFieldId;
    if (!fieldId) {
      throw new GitHubApiError(
        "Status field does not exist on the project. Create the field manually in GitHub Projects UI before adding options.",
        400,
      );
    }
    return await this.addSingleSelectOption(fieldId, value);
  }

  private async addPriorityOption(value: string): Promise<{ created: boolean }> {
    const fieldId = this.config.fields.priorityFieldId;
    if (!fieldId) {
      throw new GitHubApiError(
        "Priority field does not exist on the project. Create the field manually in GitHub Projects UI before adding options.",
        400,
      );
    }
    return await this.addSingleSelectOption(fieldId, value);
  }

  private async addSingleSelectOption(
    fieldId: string,
    value: string,
  ): Promise<{ created: boolean }> {
    const fieldData = await this.gh.graphql<GetFieldOptionsResponse>(
      `query GetFieldOptions($fieldId: ID!) {
        node(id: $fieldId) {
          ... on ProjectV2SingleSelectField { options { id name color description } }
        }
      }`,
      { fieldId },
    );
    const currentOptions = fieldData.node?.options ?? [];
    if (currentOptions.some((opt) => opt.name === value)) {
      return { created: false };
    }
    const updatedOptions = [
      ...currentOptions,
      { name: value, color: "GRAY", description: "" },
    ];
    await this.gh.graphql(
      `mutation UpdateField($projectId: ID!, $fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
        updateProjectV2Field(input: {
          projectId: $projectId
          fieldId: $fieldId
          singleSelectOptions: $options
        }) {
          projectV2Field { id }
        }
      }`,
      { projectId: this.config.projectId, fieldId, options: updatedOptions },
    );
    return { created: true };
  }
}
