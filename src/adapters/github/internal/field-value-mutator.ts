// =============================================================================
// src/adapters/github/internal/field-value-mutator.ts — Field Value Mutation
//
// Single responsibility: handle all mutations for project board fields.
// Injected into GitHubProjectBackend via constructor (DIP).
// Depends on UserMilestoneResolver for assignee resolution.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { GitHubClient } from "./http-client.ts";
import { resolveSprint } from "./resolver.ts";
import { UserMilestoneResolver } from "./user-milestone-resolver.ts";
import type { RuntimeConfig } from "../config-loader.ts";
import type { SprintRef } from "../../../domain/types.ts";

// ── FieldValueMutator class ──────────────────────────────────────────────────

/**
 * Handles all mutations for project board fields (status, sprint, points, priority, assignee).
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class FieldValueMutator {
  private readonly config: RuntimeConfig;
  private readonly gh: GitHubClient;
  private readonly userMilestoneResolver: UserMilestoneResolver;

  constructor(
    config: RuntimeConfig,
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
      `mutation ClearField($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
        clearProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
        }) { item { id } }
      }`,
      { projectId: this.config.projectId, itemId, fieldId },
    );
  }

  /** Update the status of a project item */
  async setFieldStatus(itemId: string, value: string): Promise<void> {
    const optionId = this.config.statusOptions[value];
    if (!optionId) {
      throw new GitHubApiError(
        `Status option "${value}" not found in vocabulary. Run scrum_add_vocabulary to add it first.`,
        400,
      );
    }
    const fieldId = this.config.fields.statusFieldId;
    if (!fieldId) throw new GitHubApiError("Status field ID is not configured.", 400);
    await this.gh.graphql<{ updateProjectV2ItemFieldValue: { item: { id: string } } }>(
      `mutation SetFieldStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }) { item { id } }
      }`,
      { projectId: this.config.projectId, itemId, fieldId, optionId },
    );
  }

  /** Update the sprint (iteration) of a project item */
  async setFieldSprint(itemId: string, value: SprintRef): Promise<void> {
    const iterationId = value === null ? null : resolveSprint(value, this.config);
    const fieldId = this.config.fields.sprintFieldId;
    if (!fieldId) throw new GitHubApiError("Sprint field ID is not configured.", 400);
    if (iterationId === null) {
      await this.clearField(itemId, fieldId);
    } else {
      await this.gh.graphql<{ updateProjectV2ItemFieldValue: { item: { id: string } } }>(
        `mutation SetFieldSprint($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
            value: { iterationId: $iterationId }
          }) { item { id } }
        }`,
        { projectId: this.config.projectId, itemId, fieldId, iterationId },
      );
    }
  }

  /** Update the story points of a project item */
  async setFieldStoryPoints(itemId: string, value: number | null): Promise<void> {
    const fieldId = this.config.fields.storyPointsFieldId;
    if (!fieldId) throw new GitHubApiError("Story points field ID is not configured.", 400);
    if (value === null) {
      await this.clearField(itemId, fieldId);
    } else {
      await this.gh.graphql<{ updateProjectV2ItemFieldValue: { item: { id: string } } }>(
        `mutation SetFieldStoryPoints($projectId: ID!, $itemId: ID!, $fieldId: ID!, $number: Float!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
            value: { number: $number }
          }) { item { id } }
        }`,
        { projectId: this.config.projectId, itemId, fieldId, number: value },
      );
    }
  }

  /** Update the priority of a project item */
  async setFieldPriority(itemId: string, value: string | null): Promise<void> {
    const fieldId = this.config.fields.priorityFieldId;
    if (!fieldId) throw new GitHubApiError("Priority field ID is not configured.", 400);
    if (value === null) {
      await this.clearField(itemId, fieldId);
    } else {
      const optionId = this.config.priorityOptions[value];
      if (!optionId) {
        throw new GitHubApiError(
          `Priority option "${value}" not found. Run scrum_add_vocabulary to add it first.`,
          400,
        );
      }
      await this.gh.graphql<{ updateProjectV2ItemFieldValue: { item: { id: string } } }>(
        `mutation SetFieldPriority($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
            value: { singleSelectOptionId: $optionId }
          }) { item { id } }
        }`,
        { projectId: this.config.projectId, itemId, fieldId, optionId },
      );
    }
  }

  /** Update the assignee of a GitHub issue */
  async setFieldAssignee(issueId: string, value: string | null): Promise<void> {
    if (value === null) {
      // Clear all assignees
      await this.gh.graphql<{ updateIssue: { issue: { id: string } } }>(
        `mutation ClearAssignees($issueId: ID!) {
          updateIssue(input: { issueId: $issueId, assigneeIds: [] }) { issue { id } }
        }`,
        { issueId },
      );
      return;
    }
    // Resolve login → user node ID
    const userId = await this.userMilestoneResolver.resolveUserNodeId(value);
    await this.gh.graphql<{ updateIssue: { issue: { id: string } } }>(
      `mutation SetAssignee($issueId: ID!, $userId: ID!) {
        updateIssue(input: { issueId: $issueId, assigneeIds: [$userId] }) { issue { id } }
      }`,
      { issueId, userId },
    );
  }
}
