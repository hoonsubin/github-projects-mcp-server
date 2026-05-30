// =============================================================================
// src/adapters/github/internal/field-value-mutator.ts - Field Value Mutation
//
// Single responsibility: handle all mutations for project board fields.
// Injected into GitHubProjectBackend via constructor (DIP).
// Depends on UserMilestoneResolver for assignee resolution.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { GitHubClient } from "./http-client.ts";
import { resolveSprint } from "./resolver.ts";
import { UserMilestoneResolver } from "./user-milestone-resolver.ts";
import type { GitHubBootState } from "../bootstrap.ts";
import type { SprintRef } from "../../../domain/types.ts";
import { CLEAR_ITEM_FIELD_MUTATION, UPDATE_ITEM_FIELD_MUTATION } from "../queries.ts";
import { CLEAR_ASSIGNEES_MUTATION, SET_ASSIGNEE_MUTATION } from "../queries.ts";

// ── FieldValueMutator class ──────────────────────────────────────────────────

/**
 * Handles all mutations for project board fields (status, sprint, points, priority, assignee).
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class FieldValueMutator {
  private readonly config: GitHubBootState;
  private readonly gh: GitHubClient;
  private readonly userMilestoneResolver: UserMilestoneResolver;

  constructor(
    config: GitHubBootState,
    gh: GitHubClient,
    userMilestoneResolver: UserMilestoneResolver,
  ) {
    this.config = config;
    this.gh = gh;
    this.userMilestoneResolver = userMilestoneResolver;
  }

  /** Clear a project field value using the dedicated GitHub mutation. */
  async clearField(itemId: string, fieldId: string): Promise<void> {
    await this.gh.graphql(
      CLEAR_ITEM_FIELD_MUTATION,
      { input: { projectId: this.config.live.projectId, itemId, fieldId } },
    );
  }

  /** Update the status of a project item */
  async setFieldStatus(itemId: string, value: string): Promise<void> {
    const optionId = this.config.live.statusOptions[value];
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
            knownOptions: Object.keys(this.config.live.statusOptions),
          },
        },
      );
    }
    const fieldId = this.config.live.fields.statusFieldId;
    if (!fieldId) {
      throw new GitHubApiError("Status field is not configured in this project.", {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery: 'Add a single-select field named "Status" to your GitHub Project, ' +
          "then re-run the server so config-loader can pick it up.",
      });
    }
    await this.gh.graphql<{ updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }>(
      UPDATE_ITEM_FIELD_MUTATION,
      {
        input: {
          projectId: this.config.live.projectId,
          itemId,
          fieldId,
          value: { singleSelectOptionId: optionId },
        },
      },
    );
  }

  /** Update the sprint (iteration) of a project item */
  async setFieldSprint(itemId: string, value: SprintRef): Promise<void> {
    const iterationId = value === null ? null : resolveSprint(value, this.config);
    const fieldId = this.config.live.fields.sprintFieldId;
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
      await this.gh.graphql<{ updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }>(
        UPDATE_ITEM_FIELD_MUTATION,
        {
          input: { projectId: this.config.live.projectId, itemId, fieldId, value: { iterationId } },
        },
      );
    }
  }

  /** Update the story points of a project item */
  async setFieldStoryPoints(itemId: string, value: number | null): Promise<void> {
    const fieldId = this.config.live.fields.storyPointsFieldId;
    if (!fieldId) {
      throw new GitHubApiError("Story points field is not configured in this project.", {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery: 'Add a number field named "Story Points" to your GitHub Project, ' +
          "then re-run the server so config-loader can pick it up.",
      });
    }
    if (value === null) {
      await this.clearField(itemId, fieldId);
    } else {
      await this.gh.graphql<{ updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }>(
        UPDATE_ITEM_FIELD_MUTATION,
        {
          input: {
            projectId: this.config.live.projectId,
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
    const fieldId = this.config.live.fields.priorityFieldId;
    if (!fieldId) {
      throw new GitHubApiError("Priority field is not configured in this project.", {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery: 'Add a single-select field named "Priority" to your GitHub Project, ' +
          "then re-run the server so config-loader can pick it up.",
      });
    }
    if (value === null) {
      await this.clearField(itemId, fieldId);
    } else {
      const optionId = this.config.live.priorityOptions[value];
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
              knownOptions: Object.keys(this.config.live.priorityOptions),
            },
          },
        );
      }
      await this.gh.graphql<{ updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }>(
        UPDATE_ITEM_FIELD_MUTATION,
        {
          input: {
            projectId: this.config.live.projectId,
            itemId,
            fieldId,
            value: { singleSelectOptionId: optionId },
          },
        },
      );
    }
  }

  /** Update the type of a project item via the Type single-select field */
  async setFieldType(itemId: string, value: string | null): Promise<void> {
    const fieldId = this.config.live.fields.typeFieldId;
    if (!fieldId) {
      throw new GitHubApiError("Type field is not configured in this project.", {
        code: "FIELD_NOT_CONFIGURED",
        statusCode: 400,
        recovery:
          "Add a single-select field and set its name under field_mapping.item_type in config.yml, " +
          "then re-run the server so config-loader can pick it up.",
      });
    }
    if (value === null) {
      await this.clearField(itemId, fieldId);
      return;
    }
    const optionId = this.config.live.typeOptions[value];
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
            knownOptions: Object.keys(this.config.live.typeOptions),
          },
        },
      );
    }
    await this.gh.graphql<{ updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }>(
      UPDATE_ITEM_FIELD_MUTATION,
      {
        input: {
          projectId: this.config.live.projectId,
          itemId,
          fieldId,
          value: { singleSelectOptionId: optionId },
        },
      },
    );
  }

  /** Update the assignee of a GitHub issue */
  async setFieldAssignee(issueId: string, value: string | null): Promise<void> {
    if (value === null) {
      // Clear all assignees
      await this.gh.graphql<{ updateIssue: { issue: { id: string } } }>(
        CLEAR_ASSIGNEES_MUTATION,
        { issueId },
      );
      return;
    }
    // Resolve login → user node ID
    const userId = await this.userMilestoneResolver.resolveUserNodeId(value);
    await this.gh.graphql<{ updateIssue: { issue: { id: string } } }>(
      SET_ASSIGNEE_MUTATION,
      { issueId, userId },
    );
  }
}
