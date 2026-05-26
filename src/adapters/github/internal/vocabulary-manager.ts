// =============================================================================
// src/adapters/github/internal/vocabulary-manager.ts - Vocabulary Management
//
// Single responsibility: manage project vocabulary (status, priority, labels).
// Injected into GitHubProjectBackend via constructor (DIP).
// Depends on LabelResolver for label operations.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { assertNever } from "../../../domain/errors.ts";
import { type SelectFieldOption } from "../types.ts";
import { type GitHubClient } from "./http-client.ts";
import { LabelResolver } from "./label-resolver.ts";
import type { RuntimeConfig } from "../config-loader.ts";
import type { VocabularyKind } from "../../../scrum/ports.ts";
import { GET_FIELD_OPTIONS_QUERY, UPDATE_FIELD_MUTATION } from "../queries.ts";

// ── Helper types ─────────────────────────────────────────────────────────────

/** GraphQL response shape for GET_FIELD_OPTIONS_QUERY. */
interface GetFieldOptionsResponse {
  node?: {
    options: SelectFieldOption[];
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
        return assertNever(kind);
    }
  }

  private async addStatusOption(value: string): Promise<{ created: boolean }> {
    const fieldId = this.config.fields.statusFieldId;
    if (!fieldId) {
      throw new GitHubApiError(
        "Status field is not configured in this project.",
        {
          code: "FIELD_NOT_CONFIGURED",
          statusCode: 400,
          recovery: 'Add a single-select field named "Status" to your GitHub Project, ' +
            "then re-run the server before adding vocabulary options.",
        },
      );
    }
    return await this.addSingleSelectOption(fieldId, value);
  }

  private async addPriorityOption(value: string): Promise<{ created: boolean }> {
    const fieldId = this.config.fields.priorityFieldId;
    if (!fieldId) {
      throw new GitHubApiError(
        "Priority field is not configured in this project.",
        {
          code: "FIELD_NOT_CONFIGURED",
          statusCode: 400,
          recovery: 'Add a single-select field named "Priority" to your GitHub Project, ' +
            "then re-run the server before adding vocabulary options.",
        },
      );
    }
    return await this.addSingleSelectOption(fieldId, value);
  }

  private async addSingleSelectOption(
    fieldId: string,
    value: string,
  ): Promise<{ created: boolean }> {
    const fieldData = await this.gh.graphql<GetFieldOptionsResponse>(
      GET_FIELD_OPTIONS_QUERY,
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
      UPDATE_FIELD_MUTATION,
      { projectId: this.config.projectId, fieldId, options: updatedOptions },
    );
    return { created: true };
  }
}
