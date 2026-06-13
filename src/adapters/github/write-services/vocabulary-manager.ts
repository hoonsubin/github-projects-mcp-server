// =============================================================================
// src/adapters/github/vocabulary-manager.ts - Vocabulary Management
//
// Single responsibility: manage project vocabulary (status, priority, labels).
// Injected into GitHubProjectBackend via constructor (DIP).
// Depends on LabelResolver for label operations.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { assertNever } from "../../../domain/errors.ts";
import { type SelectFieldOption } from "../types.ts";
import { LabelResolver } from "./label-resolver.ts";
import type { GitHubInfraContext } from "../infra/infra-context.ts";
import type { CreateResult, VocabularyKind } from "../../../scrum/ports.ts";
import {
  GET_FIELD_OPTIONS_QUERY,
  GET_ORG_ISSUE_FIELD_OPTIONS_QUERY,
  UPDATE_FIELD_MUTATION,
  UPDATE_ORG_ISSUE_FIELD_CATALOG_MUTATION,
} from "../queries.ts";

// ── Helper types ─────────────────────────────────────────────────────────────

/** GraphQL response shape for GET_FIELD_OPTIONS_QUERY. */
interface GetFieldOptionsResponse {
  node?: {
    options: SelectFieldOption[];
  } | null;
}

interface OrgIssueFieldOption {
  id: string;
  name: string;
  color?: string;
}

interface GetOrgIssueFieldOptionsResponse {
  node?: {
    options: OrgIssueFieldOption[];
  } | null;
}

interface UpdateOrgIssueFieldCatalogResponse {
  updateIssueField?: {
    issueField?: {
      options: OrgIssueFieldOption[];
    } | null;
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
    return await this.addSingleSelectOption(fieldId, value, "statusOptions");
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
    return await this.addSingleSelectOption(fieldId, value, "priorityOptions");
  }

  private async addSingleSelectOption(
    fieldId: string,
    value: string,
    optionMapKey: "statusOptions" | "priorityOptions",
  ): Promise<CreateResult> {
    const issueBacked = this.ctx.config.live.issueBackedFields[fieldId];
    if (issueBacked) {
      return await this.addOrgIssueFieldOption(issueBacked, fieldId, value, optionMapKey);
    }
    return await this.addProjectBoardOption(fieldId, value);
  }

  private async addProjectBoardOption(
    fieldId: string,
    value: string,
  ): Promise<CreateResult> {
    const fieldData = await this.ctx.gh.graphql<GetFieldOptionsResponse>(
      GET_FIELD_OPTIONS_QUERY,
      { fieldId },
    );
    const currentOptions = fieldData.node?.options ?? [];
    if (currentOptions.some((opt) => opt.name === value)) {
      return { created: false, already_exists: true };
    }
    const updatedOptions = [
      ...currentOptions,
      { name: value, color: "GRAY", description: "" },
    ];
    await this.ctx.gh.graphql(
      UPDATE_FIELD_MUTATION,
      { fieldId, options: updatedOptions },
    );
    return { created: true };
  }

  private async addOrgIssueFieldOption(
    issueBacked: { orgFieldId: string; options?: Record<string, string> },
    projectFieldId: string,
    value: string,
    optionMapKey: "statusOptions" | "priorityOptions",
  ): Promise<CreateResult> {
    const fieldData = await this.ctx.gh.graphql<GetOrgIssueFieldOptionsResponse>(
      GET_ORG_ISSUE_FIELD_OPTIONS_QUERY,
      { fieldId: issueBacked.orgFieldId },
    );
    const currentOptions = fieldData.node?.options ?? [];
    if (currentOptions.some((opt) => opt.name === value)) {
      this.syncOrgIssueFieldOptionMaps(
        issueBacked,
        projectFieldId,
        currentOptions,
        optionMapKey,
      );
      return { created: false, already_exists: true };
    }

    const updatedOptions = [
      ...currentOptions.map((opt) => ({
        name: opt.name,
        color: opt.color ?? "GRAY",
        description: "",
      })),
      { name: value, color: "GRAY" as const, description: "" },
    ];

    const result = await this.ctx.gh.graphql<UpdateOrgIssueFieldCatalogResponse>(
      UPDATE_ORG_ISSUE_FIELD_CATALOG_MUTATION,
      { id: issueBacked.orgFieldId, options: updatedOptions },
    );

    const refreshedOptions = result.updateIssueField?.issueField?.options ?? currentOptions;
    this.syncOrgIssueFieldOptionMaps(
      issueBacked,
      projectFieldId,
      refreshedOptions,
      optionMapKey,
    );
    if (!issueBacked.options?.[value]) {
      throw new GitHubApiError(
        `Failed to add "${value}" to the organization issue field catalog.`,
        {
          code: "MUTATION_FAILED",
          statusCode: 500,
          recovery: "Retry scrum_add_vocabulary or add the option manually in GitHub org settings.",
          context: { value, orgFieldId: issueBacked.orgFieldId },
        },
      );
    }

    return { created: true };
  }

  private syncOrgIssueFieldOptionMaps(
    issueBacked: { orgFieldId: string; options?: Record<string, string> },
    projectFieldId: string,
    options: OrgIssueFieldOption[],
    optionMapKey: "statusOptions" | "priorityOptions",
  ): void {
    const optionMap = Object.fromEntries(options.map((o) => [o.name, o.id]));
    issueBacked.options = optionMap;
    this.ctx.config.live.issueBackedFields[projectFieldId] = issueBacked;
    this.ctx.config.live[optionMapKey] = {
      ...this.ctx.config.live[optionMapKey],
      ...optionMap,
    };
  }
}
