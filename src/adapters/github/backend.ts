// =============================================================================
// src/adapters/github/backend.ts — GitHubProjectBackend implements ProjectBackend
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// All read methods implemented; write methods are stubs.
// This file imports no MCP SDK types.
// =============================================================================

import { fetchRepoFile, GitHubApiError, graphql, rest } from "../../services/github.ts";
import type { RestResponse } from "../../services/github.ts";
import { type RuntimeConfig } from "./config-loader.ts";
import { resolveSprint, resolveStory } from "../../services/resolver.ts";
import { isBacklogItem, PaginatedProjectItemFetcher } from "../../services/pagination.ts";
import {
  buildBurndownStoryInput,
  buildCommentList,
  buildEnrichedStory,
  buildLinkedPrList,
  buildStoryFromRaw,
  type IssueDetailsInput,
} from "./mappers.ts";
import {
  GET_ISSUE_DETAILS_QUERY,
  GET_ITEM_FIELDS_QUERY,
  GET_REPO_LABELS_QUERY,
} from "./queries.ts";
import type {
  BurndownInput,
  BurndownStoryInput,
  CompletionMap,
  CreateStoryInput,
  PlatformState,
  ProjectBackend,
  SprintHistoryEntry,
  SprintInfo,
  StoryDetail,
  StoryUpdates,
  VocabularyKind,
} from "../../scrum/ports.ts";
import type { IterationEntry, SprintRef, Story, StoryRef } from "../../domain/types.ts";
import type {
  GitHubBackendConfig,
  ItemFieldValue,
  ProjectItemIssueContent,
  ProjectItem,
  ProjectItemPRContent,
} from "./types.ts";

// ── Helper types ─────────────────────────────────────────────────────────────

interface RepoLabelsResponse {
  repository?: {
    labels?: {
      nodes: Array<{ id: string; name: string; color: string; description: string }>;
    };
  };
}

// ── GitHubProjectBackend ──────────────────────────────────────────────────────

//todo: this class is way too massive. It should be broken down even further and separate reusable logic outside of the class
export class GitHubProjectBackend implements ProjectBackend {
  private readonly config: RuntimeConfig;
  private readonly gh: { graphql: typeof graphql; rest: typeof rest };
  private readonly owner: string;
  private readonly ownerType: "user" | "org";
  private readonly repo: string;

  constructor(
    config: RuntimeConfig,
    gh: { graphql: typeof graphql; rest: typeof rest },
    owner: string,
    ownerType: "user" | "org",
    repo: string,
  ) {
    this.config = config;
    this.gh = gh;
    this.owner = owner;
    this.ownerType = ownerType;
    this.repo = repo;
  }

  // ── Read implementations ─────────────────────────────────────────────────

  async getPlatformState(declaredVocabulary: {
    statusValues: string[];
    priorityValues: string[];
  }): Promise<PlatformState> {
    const liveStatusOptions = Object.keys(this.config.statusOptions); // display names (keys map to option IDs)
    const livePriorityOptions = Object.keys(this.config.priorityOptions); // display names (keys map to option IDs)

    const missingStatusOptions = declaredVocabulary.statusValues.filter(
      (v) => !liveStatusOptions.includes(v),
    );
    const missingPriorityOptions = declaredVocabulary.priorityValues.filter(
      (v) => !livePriorityOptions.includes(v),
    );

    const typeLabels = await this.fetchTypeLabels();
    const existingLabels = typeLabels.existing;
    const expectedLabels = typeLabels.expected;
    const missingLabels = expectedLabels.filter((l) => !existingLabels.includes(l));

    return {
      fields: {
        status: {
          exists: !!this.config.fields.statusFieldId,
          options: liveStatusOptions,
          missingOptions: missingStatusOptions,
        },
        sprint: { exists: !!this.config.fields.sprintFieldId },
        story_points: { exists: !!this.config.fields.storyPointsFieldId },
        priority: {
          exists: !!this.config.fields.priorityFieldId,
          options: livePriorityOptions,
          missingOptions: missingPriorityOptions,
        },
      },
      labels: { existing: existingLabels, expected: expectedLabels, missing: missingLabels },
      iterations: {
        active: this.toSprintInfo(this.config.iterations.active),
        next: this.toSprintInfo(this.config.iterations.next),
        completed: this.config.iterations.completed.map((i) => this.toSprintInfo(i)!),
        completedCount: this.config.iterations.completed.length,
      },
    };
  }

  async getSprintStories(
    sprint: SprintRef,
  ): Promise<{ stories: Story[]; sprintInfo: SprintInfo | null }> {
    const iterationId = resolveSprint(sprint, this.config);
    if (iterationId === null) {
      return { stories: [], sprintInfo: null };
    }
    const iterEntry = this.config.iterations.all.find((i) => i.id === iterationId);
    const allItems = await this.fetchAllItems();
    const sprintItems = allItems.filter((item) => {
      const fv = item.fieldValues.nodes.find((v) =>
        v.field?.id === this.config.fields.sprintFieldId
      );
      return fv?.iterationId === iterationId;
    });
    const stories = sprintItems
      .map((item) => buildStoryFromRaw(item, this.config))
      .filter((s): s is Story => s !== null);
    return { stories, sprintInfo: this.toSprintInfo(iterEntry ?? null) };
  }

  async getBacklogStories(): Promise<Story[]> {
    const fetcher = new PaginatedProjectItemFetcher(this.config, { graphql: this.gh.graphql }, {
      sprintFieldIds: [this.config.fields.sprintFieldId],
      includeIssueContent: true,
      includePRContent: false,
      includeDraftIssueContent: false,
      pageSize: 100,
    });
    const backlogItems = await fetcher.collect((item) =>
      isBacklogItem(item, this.config.fields.sprintFieldId)
    );
    return backlogItems
      .map((item) => buildStoryFromRaw(item, this.config))
      .filter((s): s is Story => s !== null);
  }

  async getStoryDetail(ref: StoryRef): Promise<StoryDetail> {
    const resolved = await resolveStory(ref, { graphql: this.gh.graphql });
    if (!resolved.issueId) {
      throw new Error(
        `Story "${ref.id}" is a Draft Issue — detailed view is not available. ` +
          "Convert it to a real issue to access comments and linked PRs.",
      );
    }
    const [issueData, itemData] = await Promise.all([
      this.gh.graphql<GetIssueDetailsResponse>(GET_ISSUE_DETAILS_QUERY, {
        issueId: resolved.issueId,
      }),
      this.gh.graphql<GetItemFieldsResponse>(GET_ITEM_FIELDS_QUERY, { itemId: resolved.itemId }),
    ]);
    const issue = issueData.node;
    if (!issue || issue.number === null) {
      throw new Error(`Issue ${resolved.issueId} could not be fetched.`);
    }
    const story = buildEnrichedStory(
      issue as IssueDetailsInput,
      resolved.itemId,
      itemData.node?.fieldValues?.nodes ?? [],
      this.config,
    );
    const comments = buildCommentList(issue.comments?.nodes ?? []);
    const linkedPrs = buildLinkedPrList(issue.timelineItems?.nodes ?? []);
    return { story, comments, linkedPrs };
  }

  async getCompletedSprintHistory(window: number): Promise<SprintHistoryEntry[]> {
    const completedSorted = [...this.config.iterations.completed].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );
    const windowSlice = completedSorted.slice(0, window);
    if (windowSlice.length === 0) return [];
    const allItems = await this.fetchAllItems();
    const { sprintFieldId, statusFieldId, storyPointsFieldId } = this.config.fields;
    const doneDisplay = this.resolveTerminalStatusDisplayName();
    return windowSlice.map((iter) => {
      const iterItems = allItems.filter((item) => {
        const fv = item.fieldValues.nodes.find((v) => v.field?.id === sprintFieldId);
        return fv?.iterationId === iter.id;
      });
      let committedPoints = 0;
      let completedPoints = 0;
      let completedCount = 0;
      const stories = iterItems
        .filter((item) => item.content !== null && item.content.__typename !== "DraftIssue")
        .map((item) => {
          const content = item.content as ProjectItemIssueContent | ProjectItemPRContent;
          const ptsFv = storyPointsFieldId
            ? item.fieldValues.nodes.find((v) => v.field?.id === storyPointsFieldId)
            : null;
          const pts = ptsFv?.number ?? 0;
          const statusFv = item.fieldValues.nodes.find((v) => v.field?.id === statusFieldId);
          const statusName = statusFv?.name ?? null;
          const isDone = statusName === doneDisplay;
          committedPoints += pts;
          if (isDone) {
            completedPoints += pts;
            completedCount++;
          }
          return {
            number: content.number,
            title: content.title,
            points: pts,
            status: statusName,
          };
        });
      const endDate = new Date(iter.startDate);
      endDate.setDate(endDate.getDate() + iter.duration);
      return {
        info: {
          name: iter.title,
          startDate: iter.startDate,
          durationDays: iter.duration,
          endDate: endDate.toISOString().slice(0, 10),
        },
        stories,
      };
    });
  }

  async getBurndownInput(sprint: SprintRef): Promise<BurndownInput> {
    const iterationId = resolveSprint(sprint, this.config);
    if (iterationId === null) {
      throw new Error("Burndown does not apply to the backlog.");
    }
    const iterEntry = this.config.iterations.all.find((i) => i.id === iterationId);
    if (!iterEntry) throw new Error(`Sprint "${sprint}" resolved to an unknown iteration ID.`);
    const allItems = await this.fetchAllItems();
    const sprintItems = allItems.filter((item) => {
      const fv = item.fieldValues.nodes.find((v) =>
        v.field?.id === this.config.fields.sprintFieldId
      );
      return fv?.iterationId === iterationId;
    });
    const stories = sprintItems
      .map((item) => buildBurndownStoryInput(item, this.config))
      .filter((s): s is BurndownStoryInput => s !== null);
    const endDate = new Date(iterEntry.startDate);
    endDate.setDate(endDate.getDate() + iterEntry.duration);
    return {
      sprint: {
        name: iterEntry.title,
        startDate: iterEntry.startDate,
        durationDays: iterEntry.duration,
        endDate: endDate.toISOString().slice(0, 10),
      },
      stories,
    };
  }

  async resolveCompletionTimestamps(input: BurndownInput): Promise<CompletionMap> {
    const doneStatusName = this.resolveTerminalStatusDisplayName();
    const statusFieldName = (this.config.yml.backends.github as GitHubBackendConfig).field_mapping.status ?? "Status";
    const nodeIdToNumber = new Map(
      input.stories.map((s) => [s.number, s.number]), // already has number
    );
    if (this.ownerType === "org") {
      try {
        const completions = await this.fetchAuditLogCompletions(
          nodeIdToNumber,
          new Date(input.sprint.startDate),
          new Date(input.sprint.endDate),
          this.owner,
          doneStatusName,
          statusFieldName,
        );
        return { completions, dataSource: "audit_log" };
      } catch (err) {
        if (!(err instanceof GitHubApiError) || err.statusCode !== 403) throw err;
        // 403 = org audit log disabled; fall through to issue-close proxy
      }
    }
    const completions = await this.fetchIssueCloseCompletions(input.stories, input.sprint);
    return {
      completions,
      dataSource: "issue_close_proxy",
      warning: "Burndown timestamps are inferred from issue close events, not board field changes.",
    };
  }

  // ── Private helpers for addVocabulary ───────────────────────────────────────

  private async fetchRepoNodeId(): Promise<string> {
    // Fetch the repository node ID from GitHub GraphQL API
    const result = await this.gh.graphql<{ repository?: { id: string } }>(
      `query GetRepo($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { id } }`,
      { owner: this.owner, repo: this.repo },
    );
    const nodeId = result?.repository?.id;
    if (!nodeId) {
      throw new Error(`Could not fetch repository node ID for ${this.owner}/${this.repo}`);
    }
    return nodeId;
  }

  // ── Private helpers for setField ────────────────────────────────────────────

  /**
   * Clear a project field value using the dedicated GitHub mutation.
   * `updateProjectV2ItemFieldValue` does not accept `value: null` — this is the
   * correct mutation to use when removing a field value entirely.
   */
  private async clearField(itemId: string, fieldId: string): Promise<void> {
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

  private async resolveUserNodeId(login: string): Promise<string> {
    const result = await this.gh.graphql<{ user?: { id: string } }>(
      `query GetUser($login: String!) { user(login: $login) { id } }`,
      { login },
    );
    const nodeId = result?.user?.id;
    if (!nodeId) {
      throw new GitHubApiError(`User "${login}" not found.`, 404);
    }
    return nodeId;
  }

  private async resolveUserNodeIds(logins: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const login of logins) {
      ids.push(await this.resolveUserNodeId(login));
    }
    return ids;
  }

  private async resolveOrCreateMilestoneNodeId(title: string): Promise<string> {
    // Check existing milestones on the repo
    const milestonesQuery = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          milestones(first: 100, states: [OPEN]) {
            nodes { id title }
          }
        }
      }
    `;
    const result = await this.gh.graphql<{
      repository?: { milestones?: { nodes: Array<{ id: string; title: string }> } };
    }>(milestonesQuery, { owner: this.owner, repo: this.repo });
    const nodes = result?.repository?.milestones?.nodes ?? [];
    const found = nodes.find((m) => m.title.toLowerCase() === title.toLowerCase());
    if (found) {
      return found.id;
    }
    // Create milestone if not found.
    // GitHub's createMilestone only accepts: repositoryId, title, description, dueOn.
    // startDate and endDate are not valid fields on this mutation.
    const repositoryId = await this.fetchRepoNodeId();
    const createResult = await this.gh.graphql<{
      createMilestone: { milestone: { id: string } };
    }>(
      `mutation CreateMilestone($repositoryId: ID!, $title: String!) {
        createMilestone(input: { repositoryId: $repositoryId, title: $title }) {
          milestone { id }
        }
      }`,
      { repositoryId, title },
    );
    return createResult.createMilestone.milestone.id;
  }

  private async resolveLabelNodeIds(names: string[]): Promise<string[]> {
    const result = await this.gh.graphql<RepoLabelsResponse>(GET_REPO_LABELS_QUERY, {
      owner: this.owner,
      repo: this.repo,
    });
    const existingLabels = result?.repository?.labels?.nodes ?? [];
    const nodeIds: string[] = [];
    const missing: string[] = [];

    for (const name of names) {
      const found = existingLabels.find((l) => l.name === name);
      if (found) {
        nodeIds.push(found.id);
      } else {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      const repositoryId = await this.fetchRepoNodeId();
      for (const name of missing) {
        const color = this.hashToColor(name);
        const createResult = await this.gh.graphql<{ createLabel: { label: { id: string } } }>(
          `mutation CreateLabel($repositoryId: ID!, $name: String!, $color: String!) {
            createLabel(input: { repositoryId: $repositoryId, name: $name, color: $color }) {
              label { id }
            }
          }`,
          { repositoryId, name, color },
        );
        nodeIds.push(createResult.createLabel.label.id);
      }
    }

    return nodeIds;
  }

  /** Resolve a single label by name, creating it if it doesn't exist. Returns node ID or null. */
  private async resolveOrCreateLabel(name: string): Promise<string | null> {
    const result = await this.gh.graphql<RepoLabelsResponse>(GET_REPO_LABELS_QUERY, {
      owner: this.owner,
      repo: this.repo,
    });
    const existingLabels = result?.repository?.labels?.nodes ?? [];
    const existing = existingLabels.find((l) => l.name === name);
    if (existing) {
      return existing.id;
    }
    // Create the label
    const repositoryId = await this.fetchRepoNodeId();
    const color = this.hashToColor(name);
    const createResult = await this.gh.graphql<{ createLabel?: { label?: { id: string } } }>(
      `mutation CreateLabel($repositoryId: ID!, $name: String!, $color: String!) {
        createLabel(input: { repositoryId: $repositoryId, name: $name, color: $color }) {
          label { id }
        }
      }`,
      { repositoryId, name, color },
    );
    return createResult.createLabel?.label?.id ?? null;
  }

  fetchRepoFile(path: string): Promise<string> {
    return fetchRepoFile(this.owner, this.repo, path);
  }

  // ── Write stubs ──────────────────────────────────────────────────────────

  async createStory(input: CreateStoryInput): Promise<StoryRef> {
    // Step 1: Resolve/create type label
    const typeLabelId = await this.resolveOrCreateLabel(`type_${input.type}`);

    // Step 2: Resolve/create priority label (if provided)
    let priorityLabelId: string | null = null;
    if (input.priority) {
      priorityLabelId = await this.resolveOrCreateLabel(`priority_${input.priority.toLowerCase()}`);
    }

    // Step 3: Resolve existing repo labels to build label ID list
    const labelResult = await this.gh.graphql<RepoLabelsResponse>(GET_REPO_LABELS_QUERY, {
      owner: this.owner,
      repo: this.repo,
    });
    const existingLabels = labelResult?.repository?.labels?.nodes ?? [];
    const labelIds: string[] = [];

    // Add type label
    const typeNode = existingLabels.find((l) => l.name === `type_${input.type}`);
    if (typeNode) {
      labelIds.push(typeNode.id);
    } else if (typeLabelId) {
      labelIds.push(typeLabelId);
    }

    // Add priority label if resolved
    if (priorityLabelId) {
      labelIds.push(priorityLabelId);
    }

    // Add user-provided labels
    if (input.labels) {
      for (const labelName of input.labels) {
        const existing = existingLabels.find((l) => l.name === labelName);
        if (existing) {
          labelIds.push(existing.id);
        } else {
          const createdId = await this.resolveOrCreateLabel(labelName);
          if (createdId) labelIds.push(createdId);
        }
      }
    }

    // Step 4: Resolve assignee logins → user node IDs
    const assigneeIds: string[] = [];
    if (input.assignees) {
      for (const login of input.assignees) {
        const nodeId = await this.resolveUserNodeId(login);
        assigneeIds.push(nodeId);
      }
    }

    // Step 5: Call createIssue mutation
    const repositoryId = await this.fetchRepoNodeId();
    const result = await this.gh.graphql<{
      createIssue?: { issue?: { id: string; number: number } };
    }>(
      `mutation CreateIssue(
        $repositoryId: ID!,
        $title: String!,
        $body: String,
        $labelIds: [ID!],
        $assigneeIds: [ID!]
      ) {
        createIssue(
          input: {
            repositoryId: $repositoryId
            title: $title
            body: $body
            labelIds: $labelIds
            assigneeIds: $assigneeIds
          }
        ) {
          issue { id number }
        }
      }`,
      {
        repositoryId,
        title: input.title,
        body: input.body,
        ...(labelIds.length > 0 ? { labelIds } : {}),
        ...(assigneeIds.length > 0 ? { assigneeIds } : {}),
      },
    );

    const issue = result.createIssue?.issue;
    if (!issue) {
      throw new GitHubApiError("Failed to create issue: no issue returned from mutation");
    }

    // Step 6: Call addProjectV2ItemById to add to project board
    const addItemResult = await this.gh.graphql<{
      addProjectV2ItemById: { item: { id: string } };
    }>(
      `mutation AddItem($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }`,
      { projectId: this.config.projectId, contentId: issue.id },
    );

    // After Step 6, the project item ID is the opaque StoryRef handle.
    const itemId = addItemResult.addProjectV2ItemById?.item?.id;
    if (!itemId) {
      throw new Error("Failed to add issue to project — no item ID returned.");
    }
    const storyRef: StoryRef = { id: itemId };

    // Set priority as board field
    if (input.priority) {
      await this.setField(storyRef, "priority", input.priority);
    }

    return storyRef;
  }

  async updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void> {
    const resolved = await resolveStory(ref, { graphql: this.gh.graphql });
    if (!resolved.issueId) {
      throw new Error(
        `Story "${ref.id}" is a Draft Issue — title, body, labels, assignees, and epic cannot be ` +
          "edited via the GitHub Issues API. Convert it to a real issue first.",
      );
    }
    const issueId = resolved.issueId;

    // Build update parts — only include fields that are set
    const parts: string[] = [];
    const variables: Record<string, unknown> = { issueId };

    if (updates.title !== undefined) {
      parts.push("title: $title");
      variables.title = updates.title;
    }
    if (updates.body !== undefined) {
      parts.push("body: $body");
      variables.body = updates.body;
    }
    if (updates.labels !== undefined && updates.labels.length > 0) {
      const labelIds = await this.resolveLabelNodeIds(updates.labels);
      parts.push("labelIds: $labelIds");
      variables.labelIds = labelIds;
    }
    if (updates.assignees !== undefined && updates.assignees.length > 0) {
      const userIds = await this.resolveUserNodeIds(updates.assignees);
      parts.push("assigneeIds: $assigneeIds");
      variables.assigneeIds = userIds;
    }
    if (updates.epic !== undefined) {
      if (updates.epic === null) {
        parts.push("milestoneId: null");
      } else {
        const milestoneId = await this.resolveOrCreateMilestoneNodeId(updates.epic);
        parts.push("milestoneId: $milestoneId");
        variables.milestoneId = milestoneId;
      }
    }

    if (parts.length === 0) return; // Nothing to update

    const mutation = `
      mutation UpdateIssue($issueId: ID!, $title: String, $body: String, $labelIds: [ID!], $assigneeIds: [ID!], $milestoneId: ID) {
        updateIssue(input: { issueId: $issueId, ${parts.join(", ")} }) {
          issue { id }
        }
      }
    `;

    await this.gh.graphql(mutation, variables);
  }

  async setField(
    ref: StoryRef,
    field: "status" | "sprint" | "story_points" | "priority" | "assignee",
    value: string | number | SprintRef | null,
  ): Promise<void> {
    const resolved = await resolveStory(ref, { graphql: this.gh.graphql });
    const itemId = resolved.itemId;

    switch (field) {
      case "status":
        return this.setFieldStatus(itemId, value as string);
      case "sprint":
        return this.setFieldSprint(itemId, value as SprintRef);
      case "story_points":
        return this.setFieldStoryPoints(itemId, value as number | null);
      case "priority":
        return this.setFieldPriority(itemId, value as string | null);
      case "assignee":
        if (!resolved.issueId) {
          throw new Error(
            `Story "${ref.id}" is a Draft Issue — assignee cannot be set via the GitHub Issues API. ` +
              "Convert it to a real issue first.",
          );
        }
        return this.setFieldAssignee(resolved.issueId, value as string | null);
      default:
        throw new Error(`Unknown field: ${field}`);
    }
  }

  async addComment(ref: StoryRef, body: string): Promise<void> {
    const resolved = await resolveStory(ref, { graphql: this.gh.graphql });

    if (resolved.issueNumber === null) {
      throw new Error(
        `Story "${ref.id}" is a Draft Issue — comments can only be added to real Issues. ` +
          "Convert it to a real issue first.",
      );
    }

    await this.gh.rest(
      `repos/${this.owner}/${this.repo}/issues/${resolved.issueNumber}/comments`,
      {
        method: "POST",
        body: { body },
      },
    );
  }

  // ── Private helpers for setField ────────────────────────────────────────────

  private async setFieldStatus(itemId: string, value: string): Promise<void> {
    const optionId = this.config.statusOptions[value];
    if (!optionId) {
      throw new GitHubApiError(
        `Status option "${value}" not found in vocabulary. Run scrum_add_vocabulary to add it first.`,
        400,
      );
    }
    const fieldId = this.config.fields.statusFieldId;
    if (!fieldId) throw new Error("Status field ID is not configured.");
    await this.gh.graphql(
      `mutation {
        updateProjectV2ItemFieldValue(input: {
          itemId: "${itemId}"
          fieldId: "${fieldId}"
          value: { singleSelectOptionId: "${optionId}" }
        }) { item { id } }
      }`,
    );
  }

  private async setFieldSprint(itemId: string, value: SprintRef): Promise<void> {
    const iterationId = value === null ? null : resolveSprint(value, this.config);
    const fieldId = this.config.fields.sprintFieldId;
    if (!fieldId) throw new Error("Sprint field ID is not configured.");
    if (iterationId === null) {
      await this.clearField(itemId, fieldId);
    } else {
      await this.gh.graphql(
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

  private async setFieldStoryPoints(itemId: string, value: number | null): Promise<void> {
    const fieldId = this.config.fields.storyPointsFieldId;
    if (!fieldId) throw new Error("Story points field ID is not configured.");
    if (value === null) {
      await this.clearField(itemId, fieldId);
    } else {
      await this.gh.graphql(
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

  private async setFieldPriority(itemId: string, value: string | null): Promise<void> {
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
      await this.gh.graphql(
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

  private async setFieldAssignee(issueId: string, value: string | null): Promise<void> {
    if (value === null) {
      // Clear all assignees
      await this.gh.graphql(
        `mutation {
          updateIssue(input: { issueId: "${issueId}", assigneeIds: [] }) { issue { id } }
        }`,
      );
      return;
    }
    // Resolve login → user node ID
    const userId = await this.resolveUserNodeId(value);
    await this.gh.graphql(
      `mutation {
        updateIssue(input: { issueId: "${issueId}", assigneeIds: ["${userId}"] }) { issue { id } }
      }`,
    );
  }

  addVocabulary(kind: VocabularyKind, value: string): Promise<{ created: boolean }> {
    switch (kind) {
      case "status_option":
        return this.addStatusOption(value);
      case "priority_option":
        return this.addPriorityOption(value);
      case "label":
        return this.addLabel(value);
    }
  }

  private addStatusOption(value: string): Promise<{ created: boolean }> {
    const fieldId = this.config.fields.statusFieldId;
    if (!fieldId) {
      throw new GitHubApiError(
        "Status field does not exist on the project. Create the field manually in GitHub Projects UI before adding options.",
        400,
      );
    }
    return this.addSingleSelectOption(fieldId, value);
  }

  private addPriorityOption(value: string): Promise<{ created: boolean }> {
    const fieldId = this.config.fields.priorityFieldId;
    if (!fieldId) {
      throw new GitHubApiError(
        "Priority field does not exist on the project. Create the field manually in GitHub Projects UI before adding options.",
        400,
      );
    }
    return this.addSingleSelectOption(fieldId, value);
  }

  private async addSingleSelectOption(
    fieldId: string,
    value: string,
  ): Promise<{ created: boolean }> {
    const fieldData = await this.gh.graphql<{
      node: {
        options: Array<{ id: string; name: string; color: string; description: string }>;
      } | null;
    }>(
      `query GetFieldOptions($fieldId: ID!) {
        node(id: $fieldId) {
          ... on ProjectV2SingleSelectField { options { id name color description } }
        }
      }`,
      { fieldId },
    );
    const currentOptions = fieldData.node?.options ?? [];
    if (currentOptions.some((opt) => opt.name === value)) {
      return { created: false };
    }
    const updatedOptions = [
      ...currentOptions.map((opt) => ({
        id: opt.id,
        name: opt.name,
        color: opt.color,
        description: opt.description,
      })),
      { name: value, color: "GRAY", description: "" },
    ];
    await this.gh.graphql(
      `mutation UpdateField($projectId: ID!, $fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
        updateProjectV2Field(input: {
          projectId: $projectId
          fieldId: $fieldId
          singleSelectOptions: $options
        }) {
          projectV2Field { id }
        }
      }`,
      { projectId: this.config.projectId, fieldId, options: updatedOptions },
    );
    return { created: true };
  }

  private async addLabel(value: string): Promise<{ created: boolean }> {
    const result = await this.gh.graphql<RepoLabelsResponse>(GET_REPO_LABELS_QUERY, {
      owner: this.owner,
      repo: this.repo,
    });
    const existingLabels = result?.repository?.labels?.nodes.map((l) => l.name) ?? [];
    if (existingLabels.includes(value)) {
      return { created: false };
    }
    const color = this.hashToColor(value);
    const repositoryId = await this.fetchRepoNodeId();
    await this.gh.graphql(
      `mutation CreateLabel($repositoryId: ID!, $name: String!, $color: String!) {
        createLabel(input: { repositoryId: $repositoryId, name: $name, color: $color }) {
          label { id name }
        }
      }`,
      { repositoryId, name: value, color },
    );
    return { created: true };
  }

  private hashToColor(name: string): string {
    const palette = [
      "f9d0c4",
      "d8f3dc",
      "d4e6f1",
      "e8daef",
      "ffeaa7",
      "fab1a0",
      "81ecec",
      "a29bfe",
      "fd79a8",
      "55efc4",
      "ff7675",
      "74b9ff",
      "a9def9",
      "c39bd3",
      "f6e58a",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return palette[Math.abs(hash) % palette.length];
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async fetchAllItems(): Promise<ProjectItem[]> {
    const fetcher = new PaginatedProjectItemFetcher(this.config, { graphql: this.gh.graphql }, {
      includeIssueContent: true,
      includePRContent: true,
      includeDraftIssueContent: true,
      pageSize: 100,
    });
    return fetcher.collect();
  }

  private async fetchTypeLabels(): Promise<{ existing: string[]; expected: string[] }> {
    const result = await this.gh.graphql<RepoLabelsResponse>(GET_REPO_LABELS_QUERY, {
      owner: this.owner,
      repo: this.repo,
    });
    const existing = result?.repository?.labels?.nodes.map((l) => l.name) ?? [];
    const expected = ["feature", "bug", "tech_debt", "spike", "impediment"];
    return { existing, expected };
  }

  private toSprintInfo(iter: IterationEntry | null): SprintInfo | null {
    if (!iter) return null;
    const endDate = new Date(iter.startDate);
    endDate.setDate(endDate.getDate() + iter.duration);
    return {
      name: iter.title,
      startDate: iter.startDate,
      durationDays: iter.duration,
      endDate: endDate.toISOString().slice(0, 10),
    };
  }

  /**
   * Resolve the display name for a canonical status key using the GitHub backend's
   * status_display mapping. Falls back to `fallback` if the key is not found.
   */
  private resolveStatusDisplayName(canonicalKey: string, fallback: string): string {
    const statusDisplay = (this.config.yml.backends.github as GitHubBackendConfig).status_display;
    if (!statusDisplay) return fallback;
    return statusDisplay[canonicalKey] ?? fallback;
  }

  /**
   * Return the display name of the terminal status (i.e., "done") by finding
   * the canonical key marked `terminal: true` in scrum.status, then looking up
   * its display name in backends.github.status_display.
   */
  private resolveTerminalStatusDisplayName(): string {
    const scrumStatus = this.config.yml.scrum?.status ?? {};
    const terminalKey = Object.entries(scrumStatus).find(([, meta]) => meta.terminal)?.[0];
    if (!terminalKey) return "Done"; // safe fallback
    return this.resolveStatusDisplayName(terminalKey, "Done");
  }

  private async fetchAuditLogCompletions(
    nodeIdToNumber: Map<number, number>,
    _startDate: Date,
    endDate: Date,
    org: string,
    doneStatusName: string,
    statusFieldName: string,
  ): Promise<Map<number, string>> {
    let url =
      `/orgs/${org}/audit-log?phrase=action:projects_v2_item.field_value_updated&order=asc&per_page=100`;
    const completions = new Map<number, string>();
    while (url) {
      const response: RestResponse<unknown> = await rest(url.split("?")[0], {
        params: Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")),
      });
      const entries = (response.data as {
        total_count: number;
        data: Array<{
          created_at: string;
          field_type: string;
          field_name: string;
          value: string;
          project_item_node_id: string;
        }>;
      })?.data ?? [];
      for (const entry of entries) {
        if (
          entry.field_type === "single_select" && entry.field_name === statusFieldName &&
          entry.value === doneStatusName
        ) {
          const issueNumber = Array.from(nodeIdToNumber.values()).find((n) =>
            n === Number(entry.project_item_node_id.slice(-6))
          );
          if (issueNumber !== undefined) {
            completions.set(issueNumber, entry.created_at);
          }
        }
        if (new Date(entry.created_at) > endDate) return completions;
      }
      if (entries.length === 0) break;
      const nextUrl = this.extractLinkHeader(response.linkHeader);
      if (!nextUrl) break;
      url = nextUrl;
    }
    return completions;
  }

  private async fetchIssueCloseCompletions(
    stories: BurndownStoryInput[],
    sprint: SprintInfo,
  ): Promise<Map<number, string>> {
    const completions = new Map<number, string>();
    for (const story of stories) {
      try {
        const response: RestResponse<
          { events: Array<{ id: number; event: string; created_at: string }> }
        > = await rest(`repos/${this.owner}/${this.repo}/issues/${story.number}/timeline`, {
          params: { per_page: "100" },
        });
        const events = response.data?.events ?? [];
        let lastCloseAt: string | null = null;
        for (const event of events) {
          if (
            event.event === "closed" && new Date(event.created_at) >= new Date(sprint.startDate) &&
            new Date(event.created_at) <= new Date(sprint.endDate)
          ) {
            lastCloseAt = event.created_at;
          }
        }
        if (lastCloseAt) completions.set(story.number, lastCloseAt);
      } catch {
        continue;
      }
    }
    return completions;
  }

  private extractLinkHeader(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
  }
}

// ── Response types ────────────────────────────────────────────────────────────

interface GetIssueDetailsResponse {
  node?: {
    id?: string;
    number?: number;
    title?: string;
    body?: string;
    url?: string;
    createdAt?: string;
    updatedAt?: string;
    assignees?: { nodes: Array<{ login: string }> };
    labels?: { nodes: Array<{ name: string }> };
    milestone?: { title: string } | null;
    comments?: {
      nodes: Array<
        {
          id: string;
          author?: { login: string } | null;
          body: string;
          createdAt: string;
          url: string;
        }
      >;
    };
    timelineItems?: {
      nodes: Array<
        {
          source?: {
            number?: number;
            title?: string;
            url?: string;
            state?: string;
            isDraft?: boolean;
          } | null;
        }
      >;
    };
  } | null;
}

interface GetItemFieldsResponse {
  node?: { fieldValues?: { nodes: ItemFieldValue[] } } | null;
}
