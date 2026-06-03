// =============================================================================
// src/adapters/github/internal/field-value-mutator.ts - Field Value Mutation
//
// Single responsibility: handle all mutations for project board fields.
// Injected into GitHubProjectBackend via constructor (DIP).
// Depends on UserMilestoneResolver for assignee resolution.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { resolveSprint } from "./resolver.ts";
import { UserMilestoneResolver } from "./user-milestone-resolver.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { SprintRef } from "../../../domain/types.ts";
import {
  CLEAR_ISSUE_FIELD_MUTATION,
  CLEAR_ITEM_FIELD_MUTATION,
  GET_PROJECT_ITEM_BY_ID_QUERY,
  SET_ISSUE_TYPE_MUTATION,
  UPDATE_ISSUE_FIELD_MUTATION,
  UPDATE_ITEM_FIELD_MUTATION,
} from "../queries.ts";
import { CLEAR_ASSIGNEES_MUTATION, SET_ASSIGNEE_MUTATION } from "../queries.ts";

// ── FieldValueMutator class ──────────────────────────────────────────────────

/**
 * Handles all mutations for project board fields (status, sprint, points, priority, assignee).
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class FieldValueMutator {
  constructor(
    private readonly ctx: GitHubInfraContext,
    private readonly userMilestoneResolver: UserMilestoneResolver,
  ) {}

  /** Clear a project field value using the dedicated GitHub mutation. */
  async clearField(itemId: string, fieldId: string): Promise<void> {
    await this.ctx.gh.graphql(
      CLEAR_ITEM_FIELD_MUTATION,
      { input: { projectId: this.ctx.config.live.projectId, itemId, fieldId } },
    );
  }

  /**
   * Set an org-level issue field value using updateIssueFieldValue.
   * Required for fields backed by org issue fields (ProjectV2ItemIssueFieldValue).
   * `issueId` must be the Issue node ID, not the ProjectV2Item ID.
   * `orgFieldId` is the org-level IssueField node ID from issueBackedFields.
   */
  private async setIssueBackedField(
    issueId: string,
    orgFieldId: string,
    fieldValue: {
      singleSelectOptionId?: string;
      textValue?: string;
      dateValue?: string;
      numberValue?: number;
    },
  ): Promise<void> {
    await this.ctx.gh.graphql<{ updateIssueFieldValue: { issue: { id: string } } }>(
      UPDATE_ISSUE_FIELD_MUTATION,
      {
        input: {
          issueId,
          issueField: {
            fieldId: orgFieldId,
            ...fieldValue,
          },
        },
      },
    );
  }

  /**
   * Clear an org-level issue field value using deleteIssueFieldValue.
   * `issueId` must be the Issue node ID; `orgFieldId` is the org-level IssueField node ID.
   */
  private async clearIssueBackedField(issueId: string, orgFieldId: string): Promise<void> {
    await this.ctx.gh.graphql<{ deleteIssueFieldValue: { issue: { id: string } } }>(
      CLEAR_ISSUE_FIELD_MUTATION,
      { input: { issueId, fieldId: orgFieldId } },
    );
  }

  /** Update the status of a project item */
  async setFieldStatus(itemId: string, value: string): Promise<void> {
    const optionId = this.ctx.config.live.statusOptions[value];
    if (!optionId) {
      throw new GitHubApiError(
        `Status option "${value}" is not in the project vocabulary.`,
        {
          code: "OPTION_NOT_FOUND",
          statusCode: 400,
          recovery:
            `Run scrum_add_vocabulary with type "status" and value "${value}" to add it, then retry.`,
          context: {
            field: "status",
            value,
            knownOptions: Object.keys(this.ctx.config.live.statusOptions),
          },
        },
      );
    }
    const fieldId = this.ctx.config.live.fields.statusFieldId;
    if (!fieldId) {
      throw new GitHubApiError("Status field is not configured in this project.", {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery: 'Add a single-select field named "Status" to your GitHub Project, ' +
          "then re-run the server so config-loader can pick it up.",
      });
    }
    await this.ctx.gh.graphql<{ updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }>(
      UPDATE_ITEM_FIELD_MUTATION,
      {
        input: {
          projectId: this.ctx.config.live.projectId,
          itemId,
          fieldId,
          value: { singleSelectOptionId: optionId },
        },
      },
    );
  }

  /** Update the sprint (iteration) of a project item */
  async setFieldSprint(itemId: string, value: SprintRef): Promise<void> {
    const iterationId = value === null ? null : resolveSprint(value, this.ctx.config);
    const fieldId = this.ctx.config.live.fields.sprintFieldId;
    if (!fieldId) {
      throw new GitHubApiError("Sprint (Iteration) field is not configured in this project.", {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery: 'Add an Iteration field named "Sprint" to your GitHub Project, ' +
          "then re-run the server so config-loader can pick it up.",
      });
    }
    if (iterationId === null) {
      await this.clearField(itemId, fieldId);
    } else {
      await this.ctx.gh.graphql<
        { updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }
      >(
        UPDATE_ITEM_FIELD_MUTATION,
        {
          input: {
            projectId: this.ctx.config.live.projectId,
            itemId,
            fieldId,
            value: { iterationId },
          },
        },
      );
    }
  }

  /** Update the story points of a project item */
  async setFieldStoryPoints(itemId: string, value: number | null): Promise<void> {
    const fieldId = this.ctx.config.live.fields.storyPointsFieldId;
    if (!fieldId) {
      throw new GitHubApiError("Story points field is not configured in this project.", {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery: 'Add a number field named "Story Points" to your GitHub Project, ' +
          "then re-run the server so config-loader can pick it up.",
      });
    }
    const issueBacked = this.ctx.config.live.issueBackedFields[fieldId];
    if (issueBacked) {
      const issueId = await this.resolveIssueNodeId(itemId);
      if (value === null) {
        await this.clearIssueBackedField(issueId, issueBacked.orgFieldId);
      } else {
        await this.setIssueBackedField(issueId, issueBacked.orgFieldId, { numberValue: value });
      }
      return;
    }
    if (value === null) {
      await this.clearField(itemId, fieldId);
    } else {
      await this.ctx.gh.graphql<
        { updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }
      >(
        UPDATE_ITEM_FIELD_MUTATION,
        {
          input: {
            projectId: this.ctx.config.live.projectId,
            itemId,
            fieldId,
            value: { number: value },
          },
        },
      );
    }
  }

  /** Update the priority of a project item */
  async setFieldPriority(itemId: string, value: string | null): Promise<void> {
    const fieldId = this.ctx.config.live.fields.priorityFieldId;
    if (!fieldId) {
      throw new GitHubApiError("Priority field is not configured in this project.", {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery: 'Add a single-select field named "Priority" to your GitHub Project, ' +
          "then re-run the server so config-loader can pick it up.",
      });
    }
    const issueBacked = this.ctx.config.live.issueBackedFields[fieldId];
    if (issueBacked) {
      const issueId = await this.resolveIssueNodeId(itemId);
      if (value === null) {
        await this.clearIssueBackedField(issueId, issueBacked.orgFieldId);
      } else {
        const optionId = (issueBacked.options ?? {})[value] ??
          this.ctx.config.live.priorityOptions[value];
        if (!optionId) {
          throw new GitHubApiError(
            `Priority option "${value}" is not in the project vocabulary.`,
            {
              code: "OPTION_NOT_FOUND",
              statusCode: 400,
              recovery:
                `Run scrum_add_vocabulary with type "priority" and value "${value}" to add it, then retry.`,
              context: {
                field: "priority",
                value,
                knownOptions: Object.keys(issueBacked.options ?? this.ctx.config.live.priorityOptions),
              },
            },
          );
        }
        await this.setIssueBackedField(issueId, issueBacked.orgFieldId, {
          singleSelectOptionId: optionId,
        });
      }
      return;
    }
    if (value === null) {
      await this.clearField(itemId, fieldId);
    } else {
      const optionId = this.ctx.config.live.priorityOptions[value];
      if (!optionId) {
        throw new GitHubApiError(
          `Priority option "${value}" is not in the project vocabulary.`,
          {
            code: "OPTION_NOT_FOUND",
            statusCode: 400,
            recovery:
              `Run scrum_add_vocabulary with type "priority" and value "${value}" to add it, then retry.`,
            context: {
              field: "priority",
              value,
              knownOptions: Object.keys(this.ctx.config.live.priorityOptions),
            },
          },
        );
      }
      await this.ctx.gh.graphql<
        { updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }
      >(
        UPDATE_ITEM_FIELD_MUTATION,
        {
          input: {
            projectId: this.ctx.config.live.projectId,
            itemId,
            fieldId,
            value: { singleSelectOptionId: optionId },
          },
        },
      );
    }
  }

  /**
   * Update the type of a project item via the Type single-select field.
   * @param issueId - When org issue types are used, pass the issue node ID from
   *   resolveStory() to avoid a redundant GetProjectItemById lookup.
   */
  async setFieldType(
    itemId: string,
    value: string | null,
    issueId?: string | null,
  ): Promise<void> {
    const { typeResolution, typeOptions } = this.ctx.config.live;
    if (value === null) {
      if (typeResolution.source === "board_field") {
        await this.clearField(itemId, typeResolution.fieldId);
        return;
      }
      throw new GitHubApiError("Type cannot be cleared when using organization issue types.", {
        code: "NOT_IMPLEMENTED",
        statusCode: 400,
        recovery: "Organization issue types require an explicit type assignment. " +
          "Set a valid type key instead of null.",
      });
    }
    const optionId = typeOptions[value];
    if (!optionId) {
      throw new GitHubApiError(
        `Type option "${value}" is not in the project vocabulary.`,
        {
          code: "OPTION_NOT_FOUND",
          statusCode: 400,
          recovery: `The canonical type "${value}" has no matching option in the Type field. ` +
            "Check that type_mapping in config.yml maps this key to a valid GitHub option name.",
          context: {
            field: "type",
            value,
            knownOptions: Object.keys(typeOptions),
          },
        },
      );
    }
    if (typeResolution.source === "board_field") {
      if (!typeResolution.fieldId) {
        throw new GitHubApiError("Type field is not configured in this project.", {
          code: "FIELD_NOT_CONFIGURED",
          statusCode: 400,
          recovery:
            "Add a single-select field and set its name under field_mapping.item_type in config.yml, " +
            "then re-run the server so config-loader can pick it up.",
        });
      }
      await this.ctx.gh.graphql<
        { updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }
      >(
        UPDATE_ITEM_FIELD_MUTATION,
        {
          input: {
            projectId: this.ctx.config.live.projectId,
            itemId,
            fieldId: typeResolution.fieldId,
            value: { singleSelectOptionId: optionId },
          },
        },
      );
      return;
    }

    const resolvedIssueId = issueId ?? await this.resolveIssueNodeId(itemId);
    await this.ctx.gh.graphql<{ updateIssue: { issue: { id: string } } }>(
      SET_ISSUE_TYPE_MUTATION,
      { issueId: resolvedIssueId, issueTypeId: optionId },
    );
  }

  /** Update the assignee of a GitHub issue */
  async setFieldAssignee(issueId: string, value: string | null): Promise<void> {
    if (value === null) {
      // Clear all assignees
      await this.ctx.gh.graphql<{ updateIssue: { issue: { id: string } } }>(
        CLEAR_ASSIGNEES_MUTATION,
        { issueId },
      );
      return;
    }
    // Resolve login → user node ID
    const userId = await this.userMilestoneResolver.resolveUserNodeId(value);
    await this.ctx.gh.graphql<{ updateIssue: { issue: { id: string } } }>(
      SET_ASSIGNEE_MUTATION,
      { issueId, userId },
    );
  }

  private async resolveIssueNodeId(itemId: string): Promise<string> {
    const result = await this.ctx.gh.graphql<{
      node?: {
        content?: { __typename: string; id: string } | null;
      } | null;
    }>(GET_PROJECT_ITEM_BY_ID_QUERY, { itemId });
    const content = result.node?.content;
    if (!content) {
      throw new GitHubApiError(`Project item "${itemId}" has no content.`, {
        code: "NOT_FOUND",
        statusCode: 404,
        recovery: "The item may have been deleted from the project. Refresh items and retry.",
        context: { itemId },
      });
    }
    if (content.__typename !== "Issue") {
      throw new GitHubApiError(
        `Type writes for org issue types require a real Issue; item "${itemId}" is ${content.__typename}.`,
        {
          code: "DRAFT_ISSUE_CONSTRAINT",
          statusCode: 400,
          recovery:
            "Convert the item to an Issue (for example by adding labels/epic) before setting type.",
          context: { itemId, contentType: content.__typename },
        },
      );
    }
    return content.id;
  }
}
