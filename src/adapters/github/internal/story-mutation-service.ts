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

// ── Dependency section rewrite helper ────────────────────────────────────────

const BLOCKED_BY_LINE_RE = /^-\s+blocked\s+by:\s+#\d+\s*$/im;
const BLOCKS_LINE_RE = /^-\s+blocks:\s+#\d+\s*$/im;

/**
 * Rewrite the `## Dependencies` markdown section in a story body.
 *
 * Rules (per direction):
 *   `undefined` — leave that direction untouched (preserve existing lines)
 *   `null`       — clear all lines for that direction
 *   `StoryRef[]` — replace all lines for that direction with new entries
 *
 * If both directions end up empty, the entire section (heading + content)
 * is removed. Otherwise the section is upserted — replaced if it already
 * exists, or appended to the end of the body if absent.
 */
const rewriteDependencySection = (
  currentBody: string,
  blockedBy: StoryRef[] | null | undefined,
  blocks: StoryRef[] | null | undefined,
  resolveIssueNumber: (ref: StoryRef) => string,
): string => {
  // Match the ## Dependencies section up to the next ## heading or end of string.
  // $(?![\s\S]) is the JS idiom for end-of-string in multiline mode.
  const sectionMatch = currentBody.match(
    /^##\s+dependencies\b.*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/im,
  );
  const existingSection = sectionMatch ? sectionMatch[0] : "";
  const existingBody = sectionMatch
    ? currentBody.replace(sectionMatch[0], "").trimEnd()
    : currentBody;

  const existingBlockedBy: string[] = [];
  const existingBlocks: string[] = [];
  const otherLines: string[] = [];
  for (const line of existingSection.split("\n")) {
    if (BLOCKED_BY_LINE_RE.test(line)) {
      existingBlockedBy.push(line);
    } else if (BLOCKS_LINE_RE.test(line)) {
      existingBlocks.push(line);
    } else if (line.trim() !== "" || otherLines.length > 0) {
      otherLines.push(line);
    }
  }

  const finalBlockedBy: string[] = blockedBy === undefined
    ? existingBlockedBy
    : blockedBy === null
    ? []
    : blockedBy.map((ref) => `- Blocked by: #${resolveIssueNumber(ref)}`);
  const finalBlocks: string[] = blocks === undefined
    ? existingBlocks
    : blocks === null
    ? []
    : blocks.map((ref) => `- Blocks: #${resolveIssueNumber(ref)}`);

  const sectionLines = [...otherLines, ...finalBlockedBy, ...finalBlocks]
    .filter((line) => line.trim() !== "");

  if (sectionLines.length === 0) {
    return existingBody || "";
  }

  const section = ["## Dependencies", "", ...sectionLines].join("\n");
  return existingBody ? `${existingBody}\n\n${section}` : section;
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
    private readonly config: RuntimeConfig,
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

    // Resolve assignee IDs upfront — both the draft and full-issue paths use them.
    const assigneeIds = input.assignees
      ? await this.userMilestoneResolver.resolveUserNodeIds(input.assignees)
      : [];

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

    // Type is a project board field — works on draft issues without conversion.
    // Silently skipped on config mismatch so partial configs don't break creation.
    if (this.config.fields.typeFieldId && this.config.typeOptions[input.type]) {
      await this.fieldValueMutator.setFieldType(itemId, input.type);
    }

    if (input.priority) {
      await this.fieldValueMutator.setFieldPriority(itemId, input.priority);
    }

    // convertProjectV2DraftIssueItemToIssue keeps the same itemId on the project board
    // but promotes the underlying content to a real Issue, enabling label and
    // milestone mutations via updateIssue.
    if (needsFullIssue) {
      const issueId = await this.convertDraftToIssue(itemId);

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

    if (updates.blocked_by !== undefined || updates.blocks !== undefined) {
      const updatedBody = await this._buildDependencyBody(updates, issueId);
      updates = { ...updates, body: updatedBody };
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
        value: await this.labelResolver.resolveLabelNodeIds(updates.labels),
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
        value: updates.epic === null
          ? null
          : await this.userMilestoneResolver.resolveOrCreateMilestoneNodeId(updates.epic),
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

  /**
   * Build an updated body with the ## Dependencies section rewritten.
   * Resolves all StoryRef arrays in a single parallel pass before the sync rewrite.
   */
  private async _buildDependencyBody(
    updates: StoryUpdates,
    issueId: string,
  ): Promise<string> {
    const currentBody: string = updates.body !== undefined
      ? (updates.body ?? "")
      : await this._fetchCurrentBody(issueId);

    // Collect only the refs that need network resolution (non-null arrays).
    const blockedByRefs = Array.isArray(updates.blocked_by) ? updates.blocked_by : [];
    const blocksRefs = Array.isArray(updates.blocks) ? updates.blocks : [];
    const allRefs = [...blockedByRefs, ...blocksRefs];

    const resolvedNumbers = await Promise.all(
      allRefs.map((ref) => this._resolveRefToIssueNumber(ref)),
    );
    const numById = new Map(allRefs.map((ref, i) => [ref.id, resolvedNumbers[i]]));

    return rewriteDependencySection(
      currentBody,
      updates.blocked_by,
      updates.blocks,
      (ref) => numById.get(ref.id) ?? "",
    );
  }

  /** Resolve a StoryRef to its issue number string for dependency body entries. */
  private async _resolveRefToIssueNumber(ref: StoryRef): Promise<string> {
    const resolved = await resolveStory(ref, this.gh);
    if (resolved.issueNumber === null) {
      throw new GitHubApiError(
        `Cannot resolve dependency reference: story ${ref.id} is a Draft Issue with no issue number.`,
        {
          code: "RESOLUTION_FAILED",
          recovery: "Draft Issues cannot be referenced in dependency lists. " +
            "Convert the draft to a full Issue first, then retry.",
          context: { itemId: ref.id },
        },
      );
    }
    return String(resolved.issueNumber);
  }

  /** Fetch the current body of an issue by its node ID. */
  private async _fetchCurrentBody(issueId: string): Promise<string> {
    const result = await this.gh.graphql<{
      node?: { body?: string } | null;
    }>(
      `query GetIssueBody($issueId: ID!) { node(id: $issueId) { ... on Issue { body } } }`,
      { issueId },
    );
    return result.node?.body ?? "";
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
        // Type is a project board field — works on draft issues without conversion,
        // unlike assignee which requires a real Issue.
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
