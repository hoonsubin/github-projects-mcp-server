// =============================================================================
// src/adapters/github/internal/story-mutation-service.ts — Story Write Operations
//
// Single responsibility: write-side story mutations extracted from the backend facade.
// Handles createStory, updateStory, setField, and addComment.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type { GitHubClient } from "./http-client.ts";
import { resolveStory } from "./resolver.ts";
import { LabelResolver } from "./label-resolver.ts";
import { UserMilestoneResolver } from "./user-milestone-resolver.ts";
import { FieldValueMutator } from "./field-value-mutator.ts";
import type { RuntimeConfig } from "../config-loader.ts";
import type { CreateStoryInput, StoryUpdates } from "../../../scrum/ports.ts";
import type { SprintRef, StoryRef } from "../../../domain/types.ts";

// ── StoryMutationService class ─────────────────────────────────────────────────

/**
 * Write-side story operations: create, update, set fields, and add comments.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class StoryMutationService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly gh: GitHubClient,
    private readonly owner: string,
    private readonly repo: string,
    private readonly labelResolver: LabelResolver,
    private readonly userMilestoneResolver: UserMilestoneResolver,
    private readonly fieldValueMutator: FieldValueMutator,
  ) {}

  async createStory(input: CreateStoryInput): Promise<StoryRef> {
    // Determine whether a full Issue is required after draft creation.
    // Draft Issues support: title, body, assignees (on the project board).
    // Full Issues additionally support: labels, milestones (epic).
    const hasLabels = (input.labels?.length ?? 0) > 0;
    const hasEpic = input.epic !== undefined;
    const needsFullIssue = hasLabels || hasEpic;

    // Resolve assignee IDs upfront — both paths use them.
    const assigneeIds = input.assignees
      ? await this.userMilestoneResolver.resolveUserNodeIds(input.assignees)
      : [];

    // ── Step 1: Create a draft issue on the project board (always) ────────────
    // addProjectV2DraftIssue creates the item and adds it to the project in one
    // call — no separate addProjectV2ItemById needed.
    const draftResult = await this.gh.graphql<{
      addProjectV2DraftIssue?: { projectItem?: { id: string } };
    }>(
      `mutation AddDraftIssue(
        $projectId: ID!, $title: String!, $body: String, $assigneeIds: [ID!]
      ) {
        addProjectV2DraftIssue(input: {
          projectId: $projectId, title: $title, body: $body,
          assigneeIds: $assigneeIds
        }) { projectItem { id } }
      }`,
      {
        projectId: this.config.projectId,
        title: input.title,
        body: input.body,
        ...(assigneeIds.length > 0 ? { assigneeIds } : {}),
      },
    );

    const itemId = draftResult.addProjectV2DraftIssue?.projectItem?.id;
    if (!itemId) {
      throw new GitHubApiError("addProjectV2DraftIssue returned no project item.", {
        code: "MUTATION_FAILED",
        recovery:
          "Check that your token has Projects (read/write) permission and that the project " +
          "number in your configuration is correct, then retry.",
      });
    }

    const storyRef: StoryRef = { id: itemId };

    // ── Step 2: Set Type via project board field (works on draft issues) ──────
    // Only applied when both the Type field is configured AND the canonical key is known
    // in typeOptions. Silently skipped on mismatch so partial configs don't break creation.
    if (this.config.fields.typeFieldId && this.config.typeOptions[input.type]) {
      await this.fieldValueMutator.setFieldType(itemId, input.type);
    }

    // ── Step 3: Set Priority via project board field (works on draft issues) ──
    // Same reasoning: call mutator directly using itemId already in scope.
    if (input.priority) {
      await this.fieldValueMutator.setFieldPriority(itemId, input.priority);
    }

    // ── Step 4: Convert to full Issue when labels or epic require it ──────────
    // convertProjectV2DraftIssueItemToIssue keeps the same itemId (project item
    // stays on the board) but promotes the underlying content to a real Issue,
    // enabling label and milestone mutations via updateIssue.
    if (needsFullIssue) {
      const issueId = await this.convertDraftToIssue(itemId);

      // Apply labels via updateIssue (replaces entire label set).
      if (hasLabels) {
        const labelIds = await this.labelResolver.resolveLabelNodeIds(input.labels!);
        if (labelIds.length > 0) {
          await this.gh.graphql(
            `mutation SetLabels($issueId: ID!, $labelIds: [ID!]!) {
              updateIssue(input: { id: $issueId, labelIds: $labelIds }) { issue { id } }
            }`,
            { issueId, labelIds },
          );
        }
      }

      // Apply epic (milestone) via updateIssue.
      if (hasEpic) {
        const milestoneId = await this.userMilestoneResolver.resolveOrCreateMilestoneNodeId(
          input.epic!,
        );
        await this.gh.graphql(
          `mutation SetMilestone($issueId: ID!, $milestoneId: ID!) {
            updateIssue(input: { id: $issueId, milestoneId: $milestoneId }) { issue { id } }
          }`,
          { issueId, milestoneId },
        );
      }
    }

    return storyRef;
  }

  async updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void> {
    const resolved = await resolveStory(ref, this.gh);
    const issueId = resolved.issueId ?? await this.convertDraftToIssue(resolved.itemId);

    const parts: string[] = [];
    const varDecls: string[] = ["$issueId: ID!"];
    const variables: Record<string, unknown> = { issueId };

    if (updates.title !== undefined) {
      parts.push("title: $title");
      varDecls.push("$title: String");
      variables.title = updates.title;
    }
    if (updates.body !== undefined) {
      parts.push("body: $body");
      varDecls.push("$body: String");
      variables.body = updates.body;
    }
    if (updates.labels !== undefined && updates.labels.length > 0) {
      parts.push("labelIds: $labelIds");
      varDecls.push("$labelIds: [ID!]");
      variables.labelIds = await this.labelResolver.resolveLabelNodeIds(updates.labels);
    }
    if (updates.assignees !== undefined && updates.assignees.length > 0) {
      parts.push("assigneeIds: $assigneeIds");
      varDecls.push("$assigneeIds: [ID!]");
      variables.assigneeIds = await this.userMilestoneResolver.resolveUserNodeIds(
        updates.assignees,
      );
    }
    if (updates.epic !== undefined) {
      parts.push("milestoneId: $milestoneId");
      varDecls.push("$milestoneId: ID");
      variables.milestoneId = updates.epic === null
        ? null
        : await this.userMilestoneResolver.resolveOrCreateMilestoneNodeId(updates.epic);
    }

    if (parts.length === 0) return;

    const mutation = `
      mutation UpdateIssue(${varDecls.join(", ")}) {
        updateIssue(input: { id: $issueId, ${parts.join(", ")} }) { issue { id } }
      }
    `;
    await this.gh.graphql(mutation, variables);
  }

  async setField(
    ref: StoryRef,
    field: "status" | "sprint" | "story_points" | "priority" | "assignee" | "type",
    value: string | number | SprintRef | null,
  ): Promise<void> {
    const resolved = await resolveStory(ref, this.gh);
    const itemId = resolved.itemId;

    switch (field) {
      case "status":
        return this.fieldValueMutator.setFieldStatus(itemId, value as string);
      case "sprint":
        return this.fieldValueMutator.setFieldSprint(itemId, value as SprintRef);
      case "story_points":
        return this.fieldValueMutator.setFieldStoryPoints(itemId, value as number | null);
      case "priority":
        return this.fieldValueMutator.setFieldPriority(itemId, value as string | null);
      case "type":
        // Type is a project board field — works on both draft and full issues.
        return this.fieldValueMutator.setFieldType(itemId, value as string | null);
      case "assignee": {
        const assigneeIssueId = resolved.issueId ?? await this.convertDraftToIssue(resolved.itemId);
        return this.fieldValueMutator.setFieldAssignee(assigneeIssueId, value as string | null);
      }
      default:
        throw new Error(`Unknown field: ${field}`);
    }
  }

  async addComment(ref: StoryRef, body: string): Promise<void> {
    const resolved = await resolveStory(ref, this.gh);

    if (resolved.issueNumber !== null) {
      await this.gh.rest(
        `repos/${this.owner}/${this.repo}/issues/${resolved.issueNumber}/comments`,
        { method: "POST", body: { body } },
      );
      return;
    }

    // Draft Issue — auto-convert then post via GraphQL (issue number not yet known).
    const issueId = await this.convertDraftToIssue(resolved.itemId);
    await this.gh.graphql(
      `mutation AddComment($subjectId: ID!, $body: String!) {
        addComment(input: { subjectId: $subjectId, body: $body }) {
          commentEdge { node { id } }
        }
      }`,
      { subjectId: issueId, body },
    );
  }

  private async convertDraftToIssue(itemId: string): Promise<string> {
    const repositoryId = await this.labelResolver.fetchRepoNodeId();
    const result = await this.gh.graphql<{
      convertProjectV2DraftIssueItemToIssue?: {
        item?: { content?: { __typename: string; id: string } };
      };
    }>(
      `mutation ConvertDraftIssue($itemId: ID!, $repositoryId: ID!) {
        convertProjectV2DraftIssueItemToIssue(input: {
          itemId: $itemId, repositoryId: $repositoryId
        }) { item { content { __typename ... on Issue { id } } } }
      }`,
      { itemId, repositoryId },
    );
    const content = result.convertProjectV2DraftIssueItemToIssue?.item?.content;
    if (!content || content.__typename !== "Issue") {
      throw new GitHubApiError(
        "Failed to auto-convert Draft Issue to a real Issue.",
        {
          code: "MUTATION_FAILED",
          recovery:
            "Check that your token has Issues (read/write) and Projects (read/write) permissions, " +
            "then retry. If the error persists, verify the repository is not archived.",
          context: { itemId },
        },
      );
    }
    return content.id;
  }
}
