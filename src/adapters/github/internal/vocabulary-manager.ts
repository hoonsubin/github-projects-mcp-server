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
import { LabelResolver } from "./label-resolver.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { CreateResult, VocabularyKind } from "../../../scrum/ports.ts";
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
  constructor(
    private readonly ctx: GitHubInfraContext,
    private readonly labelResolver: LabelResolver,
  ) {}

  /** Add a new vocabulary option (status or priority) */
  async addVocabulary(kind: VocabularyKind, value: string): Promise<CreateResult> {
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

  private async addStatusOption(value: string): Promise<CreateResult> {
    const fieldId = this.ctx.config.live.fields.statusFieldId;
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

  private async addPriorityOption(value: string): Promise<CreateResult> {
    const fieldId = this.ctx.config.live.fields.priorityFieldId;
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
  ): Promise<CreateResult> {
    const fieldData = await this.ctx.gh.graphql<GetFieldOptionsResponse>(
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
    await this.ctx.gh.graphql(
      UPDATE_FIELD_MUTATION,
      { projectId: this.ctx.config.live.projectId, fieldId, options: updatedOptions },
    );
    return { created: true };
  }
}
