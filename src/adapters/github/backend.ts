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
  type BurndownStoryInput,
  // extractBoardFields kept for potential future use in write path
  extractBoardFields as _extractBoardFields,
} from "./mappers.ts";
import {
  GET_ISSUE_DETAILS_QUERY,
  GET_ITEM_FIELDS_QUERY,
  GET_PROJECT_ITEMS_QUERY,
  GET_REPO_LABELS_QUERY,
} from "./queries.ts";
import type {
  BurndownInput,
  CompletionMap,
  CreateStoryInput,
  PlatformState,
  ProjectBackend,
  SprintHistoryEntry,
  SprintInfo,
  SprintRef,
  StoryDetail,
  StoryUpdates,
  VocabularyKind,
} from "../../scrum/ports.ts";
import type { IterationEntry, Story, StoryRef } from "../../types.ts";

// ── Helper types ─────────────────────────────────────────────────────────────

interface RawFieldValue {
  field?: { id: string } | null;
  name?: string;
  optionId?: string;
  number?: number;
  title?: string;
  iterationId?: string;
  startDate?: string;
  duration?: number;
}

interface RawItem {
  id: string;
  content: {
    id: string;
    number?: number;
    title: string;
    body?: string;
    url?: string;
    createdAt?: string;
    updatedAt?: string;
    assignees?: { nodes: Array<{ login: string }> };
    labels?: { nodes: Array<{ name: string }> };
    milestone?: { title: string } | null;
  } | null;
  fieldValues: { nodes: RawFieldValue[] };
}

interface GetProjectItemsResponse {
  user?: {
    projectV2?: {
      items: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RawItem[];
      };
    } | null;
  } | null;
}

interface RepoLabelsResponse {
  repository?: {
    labels?: {
      nodes: Array<{ name: string; color: string; description: string }>;
    };
  };
}

// ── GitHubProjectBackend ──────────────────────────────────────────────────────

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
    const liveStatusOptions = Object.values(this.config.statusOptions);
    const livePriorityOptions = Object.values(this.config.priorityOptions);

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
    const resolved = await resolveStory(ref, this.config, { graphql: this.gh.graphql });
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
      issue as IssueDetailsNode,
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
    const doneDisplay = this.resolveStatusDisplayName("done", "Done");
    return windowSlice.map((iter) => {
      const iterItems = allItems.filter((item) => {
        const fv = item.fieldValues.nodes.find((v) => v.field?.id === sprintFieldId);
        return fv?.iterationId === iter.id;
      });
      let committedPoints = 0;
      let completedPoints = 0;
      let completedCount = 0;
      const stories = iterItems
        .filter((item) => item.content && typeof item.content.number === "number")
        .map((item) => {
          const content = item.content!;
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
            number: content.number as number,
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
    const doneStatusName = this.resolveStatusDisplayName("done", "Done");
    const statusFieldName = this.config.yml.field_names.status;
    const nodeIdToNumber = new Map(
      input.stories.map((s) => [s.number, s.number]), // already has number
    );
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
    }
    const completions = await this.fetchIssueCloseCompletions(input.stories, input.sprint);
    return {
      completions,
      dataSource: "issue_close_proxy",
      warning: "Burndown timestamps are inferred from issue close events, not board field changes.",
    };
  }

  fetchRepoFile(path: string): Promise<string> {
    return fetchRepoFile(this.owner, this.repo, path);
  }

  // ── Write stubs ──────────────────────────────────────────────────────────

  createStory(_input: CreateStoryInput): Promise<StoryRef> {
    throw new Error("not yet implemented");
  }
  updateStory(_ref: StoryRef, _updates: StoryUpdates): Promise<void> {
    throw new Error("not yet implemented");
  }
  setField(
    _ref: StoryRef,
    _field: string,
    _value: string | number | SprintRef | null,
  ): Promise<void> {
    throw new Error("not yet implemented");
  }
  addComment(_ref: StoryRef, _body: string): Promise<void> {
    throw new Error("not yet implemented");
  }
  addVocabulary(_kind: VocabularyKind, _value: string): Promise<{ created: boolean }> {
    throw new Error("not yet implemented");
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async fetchAllItems(): Promise<RawItem[]> {
    if (this.ownerType === "org") {
      throw new Error(
        "Org-owned projects are not yet supported by the scrum_* read tools.",
      );
    }
    const all: RawItem[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;
    while (hasNextPage) {
      const data: GetProjectItemsResponse = await this.gh.graphql(GET_PROJECT_ITEMS_QUERY, {
        login: this.owner,
        number: this.config.yml.project.project_number,
        after: cursor ?? null,
      });
      const items = data.user?.projectV2?.items;
      if (!items) break;
      all.push(...items.nodes);
      hasNextPage = items.pageInfo.hasNextPage;
      cursor = items.pageInfo.endCursor;
    }
    return all;
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

  private resolveStatusDisplayName(keyHint: string, fallback: string): string {
    const vocab = this.config.yml.status as Record<string, string> | undefined;
    if (!vocab) return fallback;
    const entry = Object.entries(vocab).find(([k]) =>
      k.toLowerCase().includes(keyHint.toLowerCase())
    );
    return entry ? entry[1] : fallback;
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
  node?: { fieldValues?: { nodes: RawFieldValue[] } } | null;
}

interface IssueDetailsNode {
  id: string;
  number: number;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
  assignees?: { nodes: Array<{ login: string }> };
  labels?: { nodes: Array<{ name: string }> };
  milestone?: { title: string } | null;
  comments?: {
    nodes: Array<
      { author?: { login: string } | null; body: string; createdAt: string; url: string }
    >;
  };
  timelineItems?: {
    nodes: Array<
      {
        source?: {
          number?: number | null;
          title?: string | null;
          url?: string | null;
          state?: string | null;
          isDraft?: boolean | null;
        } | null;
      }
    >;
  };
}
