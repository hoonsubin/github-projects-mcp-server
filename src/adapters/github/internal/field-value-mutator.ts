// =============================================================================
// src/adapters/github/internal/field-value-mutator.ts — Field Value Mutation
//
// Single responsibility: handle all mutations for project board fields.
// Injected into GitHubProjectBackend via constructor (DIP).
// Depends on UserMilestoneResolver for assignee resolution.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { graphql } from "./http-client.ts";
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
  private readonly gh: typeof graphql;
  private readonly userMilestoneResolver: UserMilestoneResolver;

  constructor(
    config: RuntimeConfig,
    gh: typeof graphql,
    userMilestoneResolver: UserMilestoneResolver,
  ) {
    this.config = config;
    this.gh = gh;
    this.userMilestoneResolver = userMilestoneResolver;
  }

  /** Clear a project field value using the dedicated GitHub mutation. */
  async clearField(itemId: string, fieldId: string): Promise<void> {
    await this.gh(
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
    if (!fieldId) throw new Error("Status field ID is not configured.");
    await this.gh(
      `mutation {
        updateProjectV2ItemFieldValue(input: {
          itemId: "${itemId}"
          fieldId: "${fieldId}"
          value: { singleSelectOptionId: "${optionId}" }
        }) { item { id } }
      }`,
    );
  }

  /** Update the sprint (iteration) of a project item */
  async setFieldSprint(itemId: string, value: SprintRef): Promise<void> {
    const iterationId = value === null ? null : resolveSprint(value, this.config);
    const fieldId = this.config.fields.sprintFieldId;
    if (!fieldId) throw new Error("Sprint field ID is not configured.");
    if (iterationId === null) {
      await this.clearField(itemId, fieldId);
    } else {
      await this.gh(
        `mutation {
          updateProjectV2ItemFieldValue(input: {
            itemId: "${itemId}"
            fieldId: "${fieldId}"
            value: { iterationId: "${iterationId}" }
          }) { item { id } }
        }`,
      );
    }
  }

  /** Update the story points of a project item */
  async setFieldStoryPoints(itemId: string, value: number | null): Promise<void> {
    const fieldId = this.config.fields.storyPointsFieldId;
    if (!fieldId) throw new Error("Story points field ID is not configured.");
    if (value === null) {
      await this.clearField(itemId, fieldId);
    } else {
      await this.gh(
        `mutation {
          updateProjectV2ItemFieldValue(input: {
            itemId: "${itemId}"
            fieldId: "${fieldId}"
            value: { number: ${value} }
          }) { item { id } }
        }`,
      );
    }
  }

  /** Update the priority of a project item */
  async setFieldPriority(itemId: string, value: string | null): Promise<void> {
    const fieldId = this.config.fields.priorityFieldId;
    if (!fieldId) throw new Error("Priority field ID is not configured.");
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
      await this.gh(
        `mutation {
          updateProjectV2ItemFieldValue(input: {
            itemId: "${itemId}"
            fieldId: "${fieldId}"
            value: { singleSelectOptionId: "${optionId}" }
          }) { item { id } }
        }`,
      );
    }
  }

  /** Update the assignee of a GitHub issue */
  async setFieldAssignee(issueId: string, value: string | null): Promise<void> {
    if (value === null) {
      // Clear all assignees
      await this.gh(
        `mutation {
          updateIssue(input: { issueId: "${issueId}", assigneeIds: [] }) { issue { id } }
        }`,
      );
      return;
    }
    // Resolve login → user node ID
    const userId = await this.userMilestoneResolver.resolveUserNodeId(value);
    await this.gh(
      `mutation {
        updateIssue(input: { issueId: "${issueId}", assigneeIds: ["${userId}"] }) { issue { id } }
      }`,
    );
  }
}
