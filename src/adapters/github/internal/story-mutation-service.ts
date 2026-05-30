// =============================================================================
// src/adapters/github/internal/story-mutation-service.ts - Story Write Operations
//
// Single responsibility: write-side story mutations extracted from the backend facade.
// Handles createStory, updateStory, setField, and addComment.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { assertNever } from "../../../domain/errors.ts";
import type { GitHubClient } from "./http-client.ts";
import { resolveStory } from "./resolver.ts";
import { LabelResolver } from "./label-resolver.ts";
import { UserMilestoneResolver } from "./user-milestone-resolver.ts";
import { FieldValueMutator } from "./field-value-mutator.ts";
import {
  ADD_COMMENT_MUTATION,
  ADD_DRAFT_ISSUE_MUTATION,
  CONVERT_DRAFT_ISSUE_MUTATION,
  GET_BLOCKED_BY_QUERY,
  SET_LABELS_MUTATION,
  SET_MILESTONE_MUTATION,
} from "../queries.ts";
import type { GitHubBootState } from "../bootstrap.ts";
import type { CreateStoryInput, ScrumField, StoryUpdates } from "../../../scrum/ports.ts";
import type { SprintRef, StoryRef } from "../../../domain/types.ts";

// ── Dependency mutation helpers ──────────────────────────────────────────────

/**
 * Apply blocked_by dependency changes using native GitHub addBlockedBy/removeBlockedBy mutations.
 * Computes diff between current and desired state, then executes all changes
 * in a single batched GraphQL call using aliases.
 */
const applyDependencyMutations = async (
  gh: GitHubClient,
  issueId: string,
  blockedBy: readonly StoryRef[] | null | undefined,
  resolveRefsToIssueIds: (refs: readonly StoryRef[]) => Promise<string[]>,
): Promise<void> => {
  if (blockedBy === undefined) return;

  // Fetch current blocked_by relationships
  const current = await gh.graphql<{
    node?: { blockedBy?: { nodes: Array<{ id: string }> } } | null;
  }>(
    GET_BLOCKED_BY_QUERY,
    { issueId },
  );
  const currentBlockedByIds = new Set(
    (current.node?.blockedBy?.nodes ?? []).map((n) => n.id),
  );

  // Resolve desired refs to issue node IDs (null = clear all)
  const desiredBlockedByIds: Set<string> = blockedBy === null
    ? new Set()
    : blockedBy.length
    ? new Set(await resolveRefsToIssueIds(blockedBy))
    : new Set();

  // Build batched mutation with aliases
  const adds: Array<{ alias: string; blockerId: string }> = [];
  const removes: Array<{ alias: string; blockerId: string }> = [];

  for (const id of desiredBlockedByIds) {
    if (!currentBlockedByIds.has(id)) {
      adds.push({ alias: `addBb${id.slice(-8)}`, blockerId: id });
    }
  }
  for (const id of currentBlockedByIds) {
    if (!desiredBlockedByIds.has(id)) {
      removes.push({ alias: `rmBb${id.slice(-8)}`, blockerId: id });
    }
  }

  if (adds.length === 0 && removes.length === 0) return;

  const mutationParts: string[] = [];
  const variables: Record<string, unknown> = {};

  for (const a of adds) {
    const varName = `bid_${a.alias}`;
    mutationParts.push(
      `${a.alias}: addBlockedBy(input: { issueId: $issueId, blockingIssueId: $${varName} }) { clientMutationId }`,
    );
    variables[varName] = a.blockerId;
  }
  for (const r of removes) {
    const varName = `bid_${r.alias}`;
    mutationParts.push(
      `${r.alias}: removeBlockedBy(input: { issueId: $issueId, blockingIssueId: $${varName} }) { clientMutationId }`,
    );
    variables[varName] = r.blockerId;
  }

  variables["issueId"] = issueId;
  await gh.graphql(
    `mutation($issueId: ID!, ${
      Object.keys(variables).filter((k) => k !== "issueId").map((k) => `$${k}: ID!`).join(", ")
    }) {
      ${mutationParts.join("\n")}
    }`,
    variables,
  );
};

// ── StoryMutationService class ────────────────────────────────────────────────

/** One field entry for a dynamic updateIssue mutation. Keeps part/decl/value coupled. */
interface MutationField {
  part: string; // GraphQL input fragment, e.g. "title: $title"
  decl: string; // Variable declaration, e.g. "$title: String"
  name: string; // Variable name, e.g. "title"
  value: unknown;
}

/**
 * Write-side story operations: create, update, set fields, and add comments.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class StoryMutationService {
  constructor(
    private readonly config: GitHubBootState,
    private readonly gh: GitHubClient,
    private readonly owner: string,
    private readonly repo: string,
    private readonly labelResolver: LabelResolver,
    private readonly userMilestoneResolver: UserMilestoneResolver,
    private readonly fieldValueMutator: FieldValueMutator,
  ) {}

  async createStory(input: CreateStoryInput): Promise<StoryRef> {
    const hasLabels = (input.labels?.length ?? 0) > 0;
    const hasEpic = input.epic !== undefined;
    const needsFullIssue = hasLabels || hasEpic;

    // Resolve assignee IDs upfront - both the draft and full-issue paths use them.
    const assigneeIds = input.assignees
      ? await this.userMilestoneResolver.resolveUserNodeIds(input.assignees)
      : [];

    // addProjectV2DraftIssue creates the item and adds it to the project in one
    // call - no separate addProjectV2ItemById needed.
    const draftResult = await this.gh.graphql<{
      addProjectV2DraftIssue?: { projectItem?: { id: string } };
    }>(
      ADD_DRAFT_ISSUE_MUTATION,
      {
        input: {
          projectId: this.config.live.projectId,
          title: input.title,
          body: input.body,
          ...(assigneeIds.length > 0 ? { assigneeIds } : {}),
        },
      },
    );

    const itemId = draftResult.addProjectV2DraftIssue?.projectItem?.id;
    if (!itemId) {
      throw new GitHubApiError(
        "addProjectV2DraftIssue returned no project item.",
        {
          code: "MUTATION_FAILED",
          recovery: "Check that your token has Projects (read/write) permission and that " +
            "the project number in your configuration is correct, then retry.",
          context: {
            projectId: this.config.live.projectId,
            title: input.title,
            responseShape: JSON.stringify(draftResult),
          },
        },
      );
    }

    const storyRef: StoryRef = { id: itemId };

    // Type is a project board field - works on draft issues without conversion.
    // Config validation at startup guarantees typeFieldId and typeOptions are populated.
    const optionId = this.config.live.typeOptions[input.type];
    if (!optionId) {
      throw new GitHubApiError(
        `Cannot set story type: "${input.type}" is not a recognized canonical type key. ` +
          `Valid keys: ${Object.keys(this.config.live.typeOptions).join(", ")}. ` +
          `Check backends.github.type_mapping in your config file.`,
        {
          code: "OPTION_NOT_FOUND",
          recovery: `Call scrum_orient to see valid type keys (vocabulary.type). ` +
            `If "${input.type}" is a new type, add it to type_mapping in your config file and ` +
            `ensure the matching option exists on the Type project field.`,
          context: { requested: input.type, valid: Object.keys(this.config.live.typeOptions) },
        },
      );
    }
    await this.fieldValueMutator.setFieldType(itemId, input.type);

    if (input.priority) {
      await this.fieldValueMutator.setFieldPriority(itemId, input.priority);
    }

    // convertProjectV2DraftIssueItemToIssue keeps the same itemId on the project board
    // but promotes the underlying content to a real Issue, enabling label and
    // milestone mutations via updateIssue.
    if (needsFullIssue) {
      const issueId = await this.convertDraftToIssue(itemId);

      if (hasLabels) {
        const labelIds = await this.labelResolver.resolveExistingLabelNodeIds(input.labels!);
        if (labelIds.length > 0) {
          await this.gh.graphql(
            SET_LABELS_MUTATION,
            { issueId, labelIds },
          );
        }
      }

      if (hasEpic) {
        // EpicRef.id is the GitHub Milestone node ID (MI_...) - no resolution needed.
        await this.gh.graphql(
          SET_MILESTONE_MUTATION,
          { issueId, milestoneId: input.epic!.id },
        );
      }
    }

    return storyRef;
  }

  async updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void> {
    const resolved = await resolveStory(ref, this.gh);
    const issueId = resolved.issueId ?? await this.convertDraftToIssue(resolved.itemId);

    // Apply blocked_by changes via native GitHub mutations (not body text manipulation)
    if (updates.blocked_by !== undefined) {
      await applyDependencyMutations(
        this.gh,
        issueId,
        updates.blocked_by,
        async (refs: readonly StoryRef[]) => {
          const results = await Promise.all(refs.map((r) => resolveStory(r, this.gh)));
          return results.map((r) => {
            if (!r.issueId) {
              throw new GitHubApiError(
                `Cannot resolve dependency: story ${r.itemId} is a Draft Issue.`,
                {
                  code: "RESOLUTION_FAILED",
                  recovery: "Use a real Issue for dependencies.",
                  context: { itemId: r.itemId },
                },
              );
            }
            return r.issueId;
          });
        },
      );
    }

    const fields: MutationField[] = [];

    if (updates.title !== undefined) {
      fields.push({
        part: "title: $title",
        decl: "$title: String",
        name: "title",
        value: updates.title,
      });
    }
    if (updates.body !== undefined) {
      fields.push({
        part: "body: $body",
        decl: "$body: String",
        name: "body",
        value: updates.body,
      });
    }
    if (updates.labels !== undefined && updates.labels.length > 0) {
      fields.push({
        part: "labelIds: $labelIds",
        decl: "$labelIds: [ID!]",
        name: "labelIds",
        value: await this.labelResolver.resolveExistingLabelNodeIds(updates.labels),
      });
    }
    if (updates.assignees !== undefined && updates.assignees.length > 0) {
      fields.push({
        part: "assigneeIds: $assigneeIds",
        decl: "$assigneeIds: [ID!]",
        name: "assigneeIds",
        value: await this.userMilestoneResolver.resolveUserNodeIds(updates.assignees),
      });
    }
    if (updates.epic !== undefined) {
      fields.push({
        part: "milestoneId: $milestoneId",
        decl: "$milestoneId: ID",
        name: "milestoneId",
        // EpicRef.id is the GitHub Milestone node ID (MI_...) - no resolution needed.
        value: updates.epic === null ? null : updates.epic.id,
      });
    }

    if (fields.length === 0) return;

    const variables: Record<string, unknown> = { issueId };
    for (const f of fields) variables[f.name] = f.value;

    const mutation = `
      mutation UpdateIssue($issueId: ID!, ${fields.map((f) => f.decl).join(", ")}) {
        updateIssue(input: { id: $issueId, ${
      fields.map((f) => f.part).join(", ")
    } }) { issue { id } }
      }
    `;
    await this.gh.graphql(mutation, variables);
  }

  async setField(
    ref: StoryRef,
    field: ScrumField,
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
        // Type is a project board field - works on draft issues without conversion,
        // unlike assignee which requires a real Issue.
        return this.fieldValueMutator.setFieldType(itemId, value as string | null);
      case "assignee": {
        const assigneeIssueId = resolved.issueId ?? await this.convertDraftToIssue(resolved.itemId);
        return this.fieldValueMutator.setFieldAssignee(assigneeIssueId, value as string | null);
      }
      default:
        return assertNever(field, `Unknown field: ${field}`);
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

    // Draft Issue - auto-convert then post via GraphQL (issue number not yet known).
    const issueId = await this.convertDraftToIssue(resolved.itemId);
    await this.gh.graphql(
      ADD_COMMENT_MUTATION,
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
      CONVERT_DRAFT_ISSUE_MUTATION,
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
