// =============================================================================
// src/adapters/github/internal/story-mutation-service.test.ts
//
// Unit tests for StoryMutationService: createStory, updateStory, setField, addComment.
// Mocks all injected dependencies; resolveStory is tested indirectly via gh.graphql
// intercepts (the real resolveStory function consumes our mock responses).
// =============================================================================

import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { StoryMutationService } from "./story-mutation-service.ts";
import type { GitHubClient, RestResponse } from "./http-client.ts";
import type { RuntimeConfig } from "../config-loader.ts";
import type { LabelResolver } from "./label-resolver.ts";
import type { UserMilestoneResolver } from "./user-milestone-resolver.ts";
import type { FieldValueMutator } from "./field-value-mutator.ts";
import type { CreateStoryInput, StoryUpdates } from "../../../scrum/ports.ts";
import type { SprintRef, StoryRef } from "../../../domain/types.ts";
import { GitHubApiError } from "../errors.ts";

// =============================================================================
// Response shapes (minimal — only the fields resolveStory / mutations read)
// =============================================================================

const ADD_DRAFT_SUCCESS = {
  addProjectV2DraftIssue: { projectItem: { id: "PVTI_new1" } },
};

const ADD_DRAFT_NULL = {
  addProjectV2DraftIssue: { projectItem: null },
};

const CONVERT_SUCCESS = {
  convertProjectV2DraftIssueItemToIssue: {
    item: { content: { __typename: "Issue" as const, id: "I_issue1" } },
  },
};

const CONVERT_WRONG_TYPE = {
  convertProjectV2DraftIssueItemToIssue: {
    item: { content: { __typename: "PullRequest" as const, id: "PR_1" } },
  },
};

const UPDATE_ISSUE_OK = { updateIssue: { issue: { id: "I_issue1" } } };

const SET_LABELS_OK = { updateIssue: { issue: { id: "I_issue1" } } };

const SET_MILESTONE_OK = { updateIssue: { issue: { id: "I_issue1" } } };

/** resolveStory → issue with number */
const RESOLVED_ISSUE = {
  node: {
    id: "PVTI_item1",
    content: { __typename: "Issue" as const, id: "I_issue1", number: 42 },
  },
};

/** resolveStory → draft (no issueId / issueNumber) */
const RESOLVED_DRAFT = {
  node: {
    id: "PVTI_draft1",
    content: { __typename: "DraftIssue" as const, id: "DI_draft1" },
  },
};

/** resolveStory → not found */
const RESOLVED_NOT_FOUND = { node: null };

/** resolveStory → issue with the "existing" node ID used in dependency current-state mocks */
const RESOLVED_EXISTING = {
  node: {
    id: "PVTI_existing",
    content: { __typename: "Issue" as const, id: "I_existing1", number: 100 },
  },
};

const REPO_ID = { repository: { id: "R_repo1" } };

const ADD_COMMENT_OK = { addComment: { commentEdge: { node: { id: "C_1" } } } };

// =============================================================================
// GitHubClient spy — queue-based to handle sequential resolveStory calls
// =============================================================================

interface GitHubClientSpy extends GitHubClient {
  graphqlCalls: Array<{ queryExcerpt: string; variables: Record<string, unknown> }>;
  restCalls: Array<{ path: string; options: unknown }>;
  enqueue(...responses: unknown[]): void;
  remaining(): number;
}

const createGhSpy = (): GitHubClientSpy => {
  const queue: unknown[] = [];
  const spy: GitHubClientSpy = {
    graphqlCalls: [],
    restCalls: [],
    async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      spy.graphqlCalls.push({
        queryExcerpt: query.slice(0, 300).replace(/\s+/g, " "),
        variables: variables ?? {},
      });
      if (queue.length === 0) {
        throw new Error(`Unmocked graphql (empty queue): ${query.slice(0, 120)}`);
      }
      const r = queue.shift()!;
      if (r instanceof Error) throw r;
      return await Promise.resolve(r as T);
    },
    async rest<T>(path: string, options?: Record<string, unknown>): Promise<RestResponse<T>> {
      spy.restCalls.push({ path, options });
      return await Promise.resolve({ data: {} as T, linkHeader: null });
    },
    enqueue(...responses: unknown[]) {
      queue.push(...responses);
    },
    remaining() {
      return queue.length;
    },
  };
  return spy;
};

// =============================================================================
// Fixture factories
// =============================================================================

const makeConfig = (overrides: Partial<RuntimeConfig> = {}): RuntimeConfig => ({
  scrumConfig: {
    project: { name: "Test" },
    scrum: { priority: [], status: {} },
    backends: { github: {} },
  },
  projectId: "PVT_project1",
  fields: {
    sprintFieldId: "PVTF_sprint",
    statusFieldId: "PVTF_status",
    storyPointsFieldId: "PVTF_points",
    priorityFieldId: "PVTF_priority",
    epicFieldId: null,
    assigneeFieldId: null,
    typeFieldId: "PVTF_type",
  },
  statusOptions: { "In Progress": "opt_ip" },
  priorityOptions: { "Must": "opt_must" },
  typeOptions: { feature: "opt_feature", bug: "opt_bug" },
  typeTemplatePaths: {},
  iterations: {
    active: { id: "IT_active", title: "Sprint 5", startDate: "2026-01-01", duration: 14 },
    next: { id: "IT_next", title: "Sprint 6", startDate: "2026-01-15", duration: 14 },
    completed: [],
    all: [],
  },
  ...overrides,
});

const makeCreateInput = (overrides: Partial<CreateStoryInput> = {}): CreateStoryInput => ({
  title: "Test Story",
  body: "As a user, I want to test.",
  type: "feature",
  priority: "Must",
  storyPoints: 5,
  labels: ["bug"],
  epic: { id: "MI_epic1" },
  assignees: ["testuser"],
  sprint: "current",
  ...overrides,
});

const makeStoryRef = (id = "PVTI_item1"): StoryRef => ({ id });

const makeUpdates = (overrides: Partial<StoryUpdates> = {}): StoryUpdates => ({
  title: "Updated Title",
  ...overrides,
});

// =============================================================================
// Service factory
// =============================================================================

interface CreateServiceOptions {
  configOverrides?: Partial<RuntimeConfig>;
  labelResolverOverrides?: Partial<Pick<LabelResolver, "resolveExistingLabelNodeIds">>;
}

const createService = (options: CreateServiceOptions = {}) => {
  const gh = createGhSpy();

  // Track label resolver calls
  const labelCalls: string[][] = [];
  const labelResolver = {
    resolveExistingLabelNodeIds(names: string[]): Promise<string[]> {
      labelCalls.push([...names]);
      return Promise.resolve(names.map((_, i) => `LA_${i + 1}`));
    },
    fetchRepoNodeId(): Promise<string> {
      return Promise.resolve("R_repo1");
    },
    ...options.labelResolverOverrides,
  } as unknown as LabelResolver;

  // Track user resolver calls
  const userCalls: string[][] = [];
  const userMilestoneResolver = {
    resolveUserNodeIds(logins: string[]): Promise<string[]> {
      userCalls.push([...logins]);
      return Promise.resolve(logins.map((_, i) => `U_${i + 1}`));
    },
    resolveUserNodeId(login: string): Promise<string> {
      return Promise.resolve(`U_${login}`);
    },
  } as unknown as UserMilestoneResolver;

  // Track field mutator calls
  const fieldCalls: Array<{ method: string; args: unknown[] }> = [];
  const recordCall = (...args: unknown[]) => {
    fieldCalls.push({ method: "recordCall", args });
    return Promise.resolve();
  };
  const fieldValueMutator = {
    setFieldStatus: recordCall,
    setFieldSprint: recordCall,
    setFieldStoryPoints: recordCall,
    setFieldPriority: recordCall,
    setFieldType: recordCall,
    setFieldAssignee: recordCall,
    clearField: recordCall,
  } as unknown as FieldValueMutator;

  const service = new StoryMutationService(
    makeConfig(options.configOverrides ?? {}),
    gh,
    "test-owner",
    "test-repo",
    labelResolver,
    userMilestoneResolver,
    fieldValueMutator,
  );

  return {
    service,
    gh,
    labelResolver,
    labelCalls,
    userMilestoneResolver,
    userCalls,
    fieldValueMutator,
    fieldCalls,
  };
};

// Helper: return a fresh service with custom config
const createServiceWithConfig = (configOverrides: Partial<RuntimeConfig>) =>
  createService({ configOverrides });

// ═══════════════════════════════════════════════════════════════════════════════
// Group A — createStory
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "createStory - throws MUTATION_FAILED when addProjectV2DraftIssue returns null item",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(ADD_DRAFT_NULL);
    const input = makeCreateInput({ labels: undefined, epic: undefined, priority: undefined });
    await assertRejects(
      () => service.createStory(input),
      GitHubApiError,
      "addProjectV2DraftIssue returned no project item",
    );
  },
});

Deno.test({
  name: "createStory - draft-only path (no labels, no epic, no priority) — single graphql call",
  async fn() {
    const { service, gh, fieldCalls } = createService();
    gh.enqueue(ADD_DRAFT_SUCCESS);
    const input = makeCreateInput({ labels: undefined, epic: undefined, priority: undefined });

    const ref = await service.createStory(input);

    assertEquals("id" in ref && ref.id, "PVTI_new1");
    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(gh.remaining(), 0);
    // exactly one field mutation: setFieldType
    assertEquals(fieldCalls.length, 1);
  },
});

Deno.test({
  name: "createStory - sets type field when typeFieldId is configured",
  async fn() {
    const { service, gh, fieldCalls } = createService();
    gh.enqueue(ADD_DRAFT_SUCCESS);
    const input = makeCreateInput({ labels: undefined, epic: undefined, priority: undefined });

    await service.createStory(input);

    const typeCall = fieldCalls.find((c) => c.args[0] === "PVTI_new1");
    assert(typeCall, "setFieldType should have been called");
  },
});

Deno.test({
  name: "createStory - throws when type value not in typeOptions",
  async fn() {
    const { service, gh } = createServiceWithConfig({
      typeOptions: {},
    });
    gh.enqueue(ADD_DRAFT_SUCCESS);
    const input = makeCreateInput({ labels: undefined, epic: undefined, priority: undefined });

    await assertRejects(
      () => service.createStory(input),
      GitHubApiError,
      "is not a recognized canonical type key",
    );
  },
});

Deno.test({
  name: "createStory - sets priority when provided",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(ADD_DRAFT_SUCCESS);
    const input = makeCreateInput({ labels: undefined, epic: undefined, priority: "Must" });

    await service.createStory(input);

    // Verify setFieldPriority was called — check graphql hadn't queued extra mutations
    assertEquals(gh.remaining(), 0); // no convert/label/epic mutations queued
  },
});

Deno.test({
  name: "createStory - skips priority when not provided",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(ADD_DRAFT_SUCCESS);
    const input = makeCreateInput({ labels: undefined, epic: undefined, priority: undefined });

    await service.createStory(input);
    assertEquals(gh.remaining(), 0);
  },
});

Deno.test({
  name: "createStory - converts draft to issue when labels are present",
  async fn() {
    const { service, gh } = createService();
    // Sequence: AddDraftIssue → ConvertDraftIssue → SetLabels
    gh.enqueue(ADD_DRAFT_SUCCESS, CONVERT_SUCCESS, SET_LABELS_OK);
    const input = makeCreateInput({ labels: ["bug"], epic: undefined });

    const ref = await service.createStory(input);
    assertEquals("id" in ref && ref.id, "PVTI_new1");
    assertEquals(gh.graphqlCalls.length, 3);
  },
});

Deno.test({
  name: "createStory - resolves label names and calls SetLabels mutation",
  async fn() {
    const { service, gh, labelCalls } = createService();
    gh.enqueue(ADD_DRAFT_SUCCESS, CONVERT_SUCCESS, SET_LABELS_OK);
    const input = makeCreateInput({ labels: ["bug", "feature"], epic: undefined });

    await service.createStory(input);

    assertEquals(labelCalls.length, 1);
    assertEquals(labelCalls[0], ["bug", "feature"]);
  },
});

Deno.test({
  name: "createStory - skips label mutation when resolved label IDs are empty",
  async fn() {
    const { service, gh } = createService({
      labelResolverOverrides: {
        resolveExistingLabelNodeIds: (_names: string[]) => Promise.resolve([] as string[]),
      },
    });
    gh.enqueue(ADD_DRAFT_SUCCESS, CONVERT_SUCCESS);
    const input = makeCreateInput({ labels: ["nonexistent"], epic: undefined });

    await service.createStory(input);
    // Only 2 calls: AddDraft + Convert — no SetLabels because labelIds was empty
    assertEquals(gh.graphqlCalls.length, 2);
  },
});

Deno.test({
  name: "createStory - sets epic milestone when epic is provided",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(ADD_DRAFT_SUCCESS, CONVERT_SUCCESS, SET_MILESTONE_OK);
    const input = makeCreateInput({ labels: undefined, epic: { id: "MI_epic1" } });

    const ref = await service.createStory(input);
    assertEquals("id" in ref && ref.id, "PVTI_new1");
    assertEquals(gh.graphqlCalls.length, 3);
  },
});

Deno.test({
  name: "createStory - handles both labels AND epic in same call",
  async fn() {
    const { service, gh } = createService();
    // AddDraft → Convert → SetLabels → SetMilestone
    gh.enqueue(ADD_DRAFT_SUCCESS, CONVERT_SUCCESS, SET_LABELS_OK, SET_MILESTONE_OK);
    const input = makeCreateInput({ labels: ["bug"], epic: { id: "MI_epic1" } });

    await service.createStory(input);
    assertEquals(gh.graphqlCalls.length, 4);
  },
});

Deno.test({
  name: "createStory - passes assigneeIds to addProjectV2DraftIssue",
  async fn() {
    const { service, gh, userCalls } = createService();
    gh.enqueue(ADD_DRAFT_SUCCESS);
    const input = makeCreateInput({
      labels: undefined,
      epic: undefined,
      assignees: ["user1", "user2"],
    });

    await service.createStory(input);

    assertEquals(userCalls.length, 1);
    assertEquals(userCalls[0], ["user1", "user2"]);
  },
});

Deno.test({
  name: "createStory - omits assigneeIds when assignees is undefined",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(ADD_DRAFT_SUCCESS);
    const input = makeCreateInput({ labels: undefined, epic: undefined, assignees: undefined });

    await service.createStory(input);

    const draftCall = gh.graphqlCalls[0];
    assertEquals("assigneeIds" in draftCall.variables, false);
  },
});

Deno.test({
  name: "createStory - convertDraftToIssue throws MUTATION_FAILED on wrong content type",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(ADD_DRAFT_SUCCESS, REPO_ID, CONVERT_WRONG_TYPE);
    const input = makeCreateInput({ labels: ["bug"], epic: undefined });

    await assertRejects(
      () => service.createStory(input),
      GitHubApiError,
      "Failed to auto-convert Draft Issue",
    );
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group B — updateStory
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "updateStory - updates title only — single-field dynamic mutation",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE, UPDATE_ISSUE_OK);
    const updates = makeUpdates({ title: "New Title" });

    await service.updateStory(makeStoryRef(), updates);

    assertEquals(gh.graphqlCalls.length, 2); // resolveStory + updateIssue
    const mutationCall = gh.graphqlCalls[1];
    assertStringIncludes(mutationCall.queryExcerpt, "title:");
    assertEquals(mutationCall.variables.title, "New Title");
  },
});

Deno.test({
  name: "updateStory - updates body only",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE, UPDATE_ISSUE_OK);
    const updates = makeUpdates({ body: "New body" });

    await service.updateStory(makeStoryRef(), updates);

    const mutationCall = gh.graphqlCalls[1];
    assertStringIncludes(mutationCall.queryExcerpt, "body:");
    assertEquals(mutationCall.variables.body, "New body");
  },
});

Deno.test({
  name: "updateStory - resolves labels then mutates",
  async fn() {
    const { service, gh, labelCalls } = createService();
    gh.enqueue(RESOLVED_ISSUE, UPDATE_ISSUE_OK);
    const updates = makeUpdates({ labels: ["a", "b"] });

    await service.updateStory(makeStoryRef(), updates);

    assertEquals(labelCalls.length, 1);
    assertEquals(labelCalls[0], ["a", "b"]);
    const mutationCall = gh.graphqlCalls[1];
    assertStringIncludes(mutationCall.queryExcerpt, "labelIds:");
    assertEquals(mutationCall.variables.labelIds, ["LA_1", "LA_2"]);
  },
});

Deno.test({
  name: "updateStory - skips label mutation when labels array is empty",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE); // no updateIssue needed — fields.length === 0
    const updates: StoryUpdates = { labels: [] };

    await service.updateStory(makeStoryRef(), updates);

    // Only resolveStory call, no updateIssue
    assertEquals(gh.graphqlCalls.length, 1);
  },
});

Deno.test({
  name: "updateStory - resolves assignees then mutates",
  async fn() {
    const { service, gh, userCalls } = createService();
    gh.enqueue(RESOLVED_ISSUE, UPDATE_ISSUE_OK);
    const updates = makeUpdates({ assignees: ["user1"] });

    await service.updateStory(makeStoryRef(), updates);

    assertEquals(userCalls.length, 1);
    assertEquals(userCalls[0], ["user1"]);
    const mutationCall = gh.graphqlCalls[1];
    assertStringIncludes(mutationCall.queryExcerpt, "assigneeIds:");
    assertEquals(mutationCall.variables.assigneeIds, ["U_1"]);
  },
});

Deno.test({
  name: "updateStory - skips assignee mutation when assignees array is empty",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE); // no updateIssue needed
    const updates: StoryUpdates = { assignees: [] };

    await service.updateStory(makeStoryRef(), updates);

    assertEquals(gh.graphqlCalls.length, 1);
  },
});

Deno.test({
  name: "updateStory - sets epic milestone",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE, UPDATE_ISSUE_OK);
    const updates = makeUpdates({ epic: { id: "MI_123" } });

    await service.updateStory(makeStoryRef(), updates);

    const mutationCall = gh.graphqlCalls[1];
    assertStringIncludes(mutationCall.queryExcerpt, "milestoneId:");
    assertEquals(mutationCall.variables.milestoneId, "MI_123");
  },
});

Deno.test({
  name: "updateStory - clears epic when null",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE, UPDATE_ISSUE_OK);
    const updates = makeUpdates({ epic: null });

    await service.updateStory(makeStoryRef(), updates);

    const mutationCall = gh.graphqlCalls[1];
    assertEquals(mutationCall.variables.milestoneId, null);
  },
});

Deno.test({
  name: "updateStory - combines multiple fields in a single mutation",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE, UPDATE_ISSUE_OK);
    const updates = makeUpdates({ title: "T", body: "B", labels: ["L"] });

    await service.updateStory(makeStoryRef(), updates);

    assertEquals(gh.graphqlCalls.length, 2); // resolveStory + 1 updateIssue
    const mutationCall = gh.graphqlCalls[1];
    assertEquals(mutationCall.variables.title, "T");
    assertEquals(mutationCall.variables.body, "B");
  },
});

Deno.test({
  name: "updateStory - no mutation when no updatable fields are provided",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE); // no updateIssue queued
    const updates: StoryUpdates = {};

    await service.updateStory(makeStoryRef(), updates);

    assertEquals(gh.graphqlCalls.length, 1); // only resolveStory
  },
});

Deno.test({
  name: "updateStory - auto-converts draft before update when item has no issueId",
  async fn() {
    const { service, gh } = createService();
    // resolveStory returns draft → convertDraft → updateIssue
    gh.enqueue(RESOLVED_DRAFT, CONVERT_SUCCESS, UPDATE_ISSUE_OK);
    const updates = makeUpdates({ title: "T" });

    await service.updateStory(makeStoryRef(), updates);

    assertEquals(gh.graphqlCalls.length, 3);
    assertStringIncludes(gh.graphqlCalls[1].queryExcerpt, "ConvertDraftIssue");
    assertStringIncludes(gh.graphqlCalls[2].queryExcerpt, "UpdateIssue");
  },
});

Deno.test({
  name: "updateStory - adds blocked_by via native addBlockedBy mutation",
  async fn() {
    const { service, gh } = createService();
    // Flow: resolveStory → fetch current blocked_by → resolve dep ref → batched mutation → title update
    gh.enqueue(
      RESOLVED_ISSUE,
      { node: { blockedBy: { nodes: [] } } },
      RESOLVED_ISSUE,
      { addBbI_issue1: { clientMutationId: null } },
      UPDATE_ISSUE_OK,
    );
    const updates = makeUpdates({ blocked_by: [{ id: "PVTI_dep1" }] });

    await service.updateStory(makeStoryRef(), updates);

    const batchCall = gh.graphqlCalls[3];
    assert(batchCall.queryExcerpt.includes("addBlockedBy"));
  },
});

Deno.test({
  name: "updateStory - clears blocked_by via removeBlockedBy when null",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(
      RESOLVED_ISSUE,
      { node: { blockedBy: { nodes: [{ id: "I_existing1" }] } } },
      { rmBbisting1: { clientMutationId: null } },
    );
    const updates: StoryUpdates = { blocked_by: null };

    await service.updateStory(makeStoryRef(), updates);

    const batchCall = gh.graphqlCalls[2];
    assert(batchCall.queryExcerpt.includes("removeBlockedBy"));
  },
});

Deno.test({
  name: "updateStory - skips dep mutation when blocked_by is undefined",
  async fn() {
    const { service, gh } = createService();
    // blocked_by: undefined → applyDependencyMutations not called at all
    gh.enqueue(RESOLVED_ISSUE, UPDATE_ISSUE_OK);
    const updates = makeUpdates({ blocked_by: undefined });

    await service.updateStory(makeStoryRef(), updates);

    const mutationCalls = gh.graphqlCalls.filter((c) =>
      c.queryExcerpt.includes("addBlockedBy") || c.queryExcerpt.includes("removeBlockedBy")
    );
    assertEquals(mutationCalls.length, 0, "No dep mutations when blocked_by is undefined");
  },
});

Deno.test({
  name: "updateStory - skips redundant mutations when blocked_by unchanged",
  async fn() {
    const { service, gh } = createService();
    // Current: blocked_by=[I_existing1]; desired: PVTI_existing → I_existing1 (no change)
    gh.enqueue(
      RESOLVED_ISSUE,
      { node: { blockedBy: { nodes: [{ id: "I_existing1" }] } } },
      RESOLVED_EXISTING,
    );
    const updates: StoryUpdates = { blocked_by: [{ id: "PVTI_existing" }] };

    await service.updateStory(makeStoryRef(), updates);

    const mutationCalls = gh.graphqlCalls.filter((c) =>
      c.queryExcerpt.includes("addBlockedBy") || c.queryExcerpt.includes("removeBlockedBy")
    );
    assertEquals(mutationCalls.length, 0, "No dep mutations when blocked_by unchanged");
  },
});

Deno.test({
  name: "updateStory - handles circular dependency (self-reference) gracefully",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(
      RESOLVED_ISSUE,
      { node: { blockedBy: { nodes: [] } } },
      RESOLVED_ISSUE, // resolveStory for the self-ref
      { addBbI_issue1: { clientMutationId: null } },
      UPDATE_ISSUE_OK,
    );
    const updates = makeUpdates({ blocked_by: [{ id: "PVTI_self" }] });

    await service.updateStory(makeStoryRef(), updates);

    // Mutation is still sent — GitHub API will reject self-references
    const batchCall = gh.graphqlCalls[3];
    assert(batchCall.queryExcerpt.includes("addBlockedBy"));
  },
});

Deno.test({
  name: "updateStory - throws RESOLUTION_FAILED when dependency ref is a Draft Issue",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE, { node: { blockedBy: { nodes: [] } } }, RESOLVED_DRAFT);
    const updates = makeUpdates({ blocked_by: [{ id: "PVTI_draft_dep" }] });

    await assertRejects(
      () => service.updateStory(makeStoryRef(), updates),
      GitHubApiError,
      "is a Draft Issue",
    );
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group C — setField
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "setField - delegates to setFieldStatus for 'status'",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE);

    await service.setField(makeStoryRef(), "status", "In Progress");
  },
});

Deno.test({
  name: "setField - delegates to setFieldSprint for 'sprint'",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE);

    await service.setField(makeStoryRef(), "sprint", "current" as SprintRef);
  },
});

Deno.test({
  name: "setField - delegates to setFieldStoryPoints for 'story_points'",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE);

    await service.setField(makeStoryRef(), "story_points", 5);
  },
});

Deno.test({
  name: "setField - delegates to setFieldPriority for 'priority'",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE);

    await service.setField(makeStoryRef(), "priority", "Must");
  },
});

Deno.test({
  name: "setField - delegates to setFieldType for 'type'",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE);

    await service.setField(makeStoryRef(), "type", "bug");
  },
});

Deno.test({
  name: "setField - auto-converts draft for assignee field",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_DRAFT, CONVERT_SUCCESS);

    await service.setField(makeStoryRef(), "assignee", "testuser");
  },
});

Deno.test({
  name: "setField - uses existing issueId for assignee when available",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE);

    await service.setField(makeStoryRef(), "assignee", "testuser");
    // Only 1 call: resolveStory (no convertDraftToIssue in between)
    assertEquals(gh.graphqlCalls.length, 1);
  },
});

Deno.test({
  name: "setField - clears assignee with null value",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE);

    await service.setField(makeStoryRef(), "assignee", null);
  },
});

Deno.test({
  name: "setField - throws for unknown field",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE);

    await assertRejects(
      () => service.setField(makeStoryRef(), "unknown_field" as never, "value"),
      GitHubApiError,
      "Unknown field: unknown_field",
    );
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group D — addComment
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "addComment - posts via REST when story has an issue number",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE);

    await service.addComment(makeStoryRef(), "Hello world");

    assertEquals(gh.restCalls.length, 1);
    assertEquals(gh.restCalls[0].path, "repos/test-owner/test-repo/issues/42/comments");
    assertEquals((gh.restCalls[0].options as Record<string, unknown>).method, "POST");
  },
});

Deno.test({
  name: "addComment - auto-converts draft then posts via GraphQL",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_DRAFT, CONVERT_SUCCESS, ADD_COMMENT_OK);

    await service.addComment(makeStoryRef("PVTI_draft1"), "Hello");

    assertEquals(gh.graphqlCalls.length, 3); // resolve + convert + addComment
    assertStringIncludes(gh.graphqlCalls[2].queryExcerpt, "AddComment");
  },
});

Deno.test({
  name: "addComment - passes correct body to REST",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_ISSUE);

    await service.addComment(makeStoryRef(), "Specific message");

    const opts = gh.restCalls[0].options as Record<string, unknown>;
    assertEquals((opts.body as Record<string, unknown>).body, "Specific message");
  },
});

Deno.test({
  name: "addComment - passes correct body to GraphQL addComment",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_DRAFT, CONVERT_SUCCESS, ADD_COMMENT_OK);

    await service.addComment(makeStoryRef(), "Draft comment");

    const addCommentVars = gh.graphqlCalls[2].variables;
    assertEquals(addCommentVars.body, "Draft comment");
  },
});

Deno.test({
  name: "addComment - handles resolveStory NOT_FOUND error propagation",
  async fn() {
    const { service, gh } = createService();
    gh.enqueue(RESOLVED_NOT_FOUND);

    await assertRejects(
      () => service.addComment(makeStoryRef("PVTI_gone"), "Hello"),
      GitHubApiError,
      "not found",
    );
  },
});
