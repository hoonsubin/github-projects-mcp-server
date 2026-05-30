// =============================================================================
// src/adapters/github/internal/field-value-mutator.test.ts
//
// Unit tests for FieldValueMutator: clearField and all setField* methods.
// Uses real GraphQL response fixtures loaded via direct JSON import for the
// UserMilestoneResolver dependency (setFieldAssignee path). The fixture data
// flows through the same spy.enqueue() → graphql() → production code path.
// =============================================================================

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { FieldValueMutator } from "./field-value-mutator.ts";
import { UserMilestoneResolver } from "./user-milestone-resolver.ts";
import { createGhSpy, makeConfig } from "./_test_utils.ts";
import type { GitHubClientSpy } from "./_test_utils.ts";
import type { RepoNodeIdProvider } from "./label-resolver.ts";
import type { GitHubBootState } from "../bootstrap.ts";
import { GitHubApiError } from "../errors.ts";
import type { SprintRef } from "../../../domain/types.ts";
import userNodeIds from "./__fixtures__/user-node-ids.json" with { type: "json" };

// =============================================================================
// Fixture-derived constants
// =============================================================================

const REAL_LOGIN = "hoonsubin";
const USER_FOUND_RESPONSE = userNodeIds[REAL_LOGIN] as { user: { id: string } };
const USER_NULL_RESPONSE = userNodeIds["_not_found_"] as { user: null };

const REAL_USER_ID = USER_FOUND_RESPONSE.user.id;

// =============================================================================
// Type-safe variable access helper
// =============================================================================

interface MutationInput {
  itemId?: string;
  fieldId?: string;
  projectId?: string;
  value?: Record<string, unknown>;
}

interface MutationVars {
  input: MutationInput;
  issueId?: string;
  userId?: string;
  login?: string;
}

/** Extract typed variables from a graphql spy call. */
const vars = (spy: GitHubClientSpy, callIndex: number): MutationVars =>
  spy.graphqlCalls[callIndex].variables as unknown as MutationVars;

// =============================================================================
// Mutation response fixtures
// =============================================================================

const CLEAR_FIELD_OK = {
  clearProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_test" } },
};

const UPDATE_FIELD_OK = {
  updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_test" } },
};

const CLEAR_ASSIGNEES_OK = {
  updateIssue: { issue: { id: "I_test" } },
};

const SET_ASSIGNEE_OK = {
  updateIssue: { issue: { id: "I_test" } },
};

// =============================================================================
// Service factory
// =============================================================================

interface CreateMutatorOptions {
  configOverrides?: Partial<GitHubBootState>;
}

/**
 * Creates a FieldValueMutator with a real UserMilestoneResolver backed
 * by the same spy so setFieldAssignee exercises the full production path.
 */
const createMutator = (options: CreateMutatorOptions = {}) => {
  const gh = createGhSpy();
  const config = makeConfig(options.configOverrides ?? {});

  const repoNodeIdProvider: RepoNodeIdProvider = {
    fetchRepoNodeId(): Promise<string> {
      return Promise.resolve("R_repo1");
    },
  };

  const userResolver = new UserMilestoneResolver(
    gh,
    "test-owner",
    "test-repo",
    repoNodeIdProvider,
  );

  const mutator = new FieldValueMutator(config, gh, userResolver);

  return { mutator, gh, config, userResolver };
};

const TEST_ITEM_ID = "PVTI_item1";
const TEST_ISSUE_ID = "I_issue1";

// =============================================================================
// Group A - clearField
// =============================================================================

Deno.test({
  name: "clearField - calls ClearItemField mutation and succeeds",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(CLEAR_FIELD_OK);

    await mutator.clearField(TEST_ITEM_ID, "PVTF_status");

    assertEquals(gh.graphqlCalls.length, 1);
    assertStringIncludes(gh.graphqlCalls[0].queryExcerpt, "ClearItemField");
    assertEquals(vars(gh, 0).input.itemId, TEST_ITEM_ID);
    assertEquals(vars(gh, 0).input.fieldId, "PVTF_status");
  },
});

Deno.test({
  name: "clearField - propagates GraphQL transport error",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(
      new GitHubApiError("GraphQL error", {
        code: "GRAPHQL_ERROR",
        recovery: "Retry the request.",
      }),
    );

    const result = await assertRejects(
      () => mutator.clearField(TEST_ITEM_ID, "PVTF_field"),
      GitHubApiError,
    );
    assertEquals(result.code, "GRAPHQL_ERROR");
  },
});

// =============================================================================
// Group B - setFieldStatus
// =============================================================================

Deno.test({
  name: "setFieldStatus - updates status when option is valid",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(UPDATE_FIELD_OK);

    await mutator.setFieldStatus(TEST_ITEM_ID, "In Progress");

    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(vars(gh, 0).input.itemId, TEST_ITEM_ID);
    assertEquals(vars(gh, 0).input.value?.singleSelectOptionId, "opt_ip");
  },
});

Deno.test({
  name: "setFieldStatus - throws OPTION_NOT_FOUND when status is not in vocabulary",
  async fn() {
    const { mutator } = createMutator();

    const err = await assertRejects(
      () => mutator.setFieldStatus(TEST_ITEM_ID, "UnknownStatus"),
      GitHubApiError,
    );

    assertEquals(err.code, "OPTION_NOT_FOUND");
    assertStringIncludes(err.message, "UnknownStatus");
    assertStringIncludes(err.recovery, "scrum_add_vocabulary");
  },
});

Deno.test({
  name: "setFieldStatus - throws FIELD_NOT_CONFIGURED when status field is missing",
  async fn() {
    const baseConfig = makeConfig();
    const { mutator } = createMutator({
      configOverrides: {
        live: { ...baseConfig.live, fields: { ...baseConfig.live.fields, statusFieldId: "" } },
      },
    });

    const err = await assertRejects(
      () => mutator.setFieldStatus(TEST_ITEM_ID, "In Progress"),
      GitHubApiError,
    );

    assertEquals(err.code, "FIELD_NOT_CONFIGURED");
    assertStringIncludes(err.message, "not configured");
  },
});

// =============================================================================
// Group C - setFieldSprint
// =============================================================================

Deno.test({
  name: "setFieldSprint - sets sprint when valid sprint ref is provided",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(UPDATE_FIELD_OK);

    await mutator.setFieldSprint(TEST_ITEM_ID, "current" as SprintRef);

    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(vars(gh, 0).input.value?.iterationId, "IT_active");
  },
});

Deno.test({
  name: "setFieldSprint - clears field when sprint ref is null",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(CLEAR_FIELD_OK);

    await mutator.setFieldSprint(TEST_ITEM_ID, null);

    assertEquals(gh.graphqlCalls.length, 1);
    assertStringIncludes(gh.graphqlCalls[0].queryExcerpt, "ClearItemField");
  },
});

Deno.test({
  name: "setFieldSprint - throws FIELD_NOT_CONFIGURED when sprint field is missing",
  async fn() {
    const baseConfig = makeConfig();
    const { mutator } = createMutator({
      configOverrides: {
        live: { ...baseConfig.live, fields: { ...baseConfig.live.fields, sprintFieldId: "" } },
      },
    });

    const err = await assertRejects(
      () => mutator.setFieldSprint(TEST_ITEM_ID, "current" as SprintRef),
      GitHubApiError,
    );

    assertEquals(err.code, "FIELD_NOT_CONFIGURED");
  },
});

// =============================================================================
// Group D - setFieldStoryPoints
// =============================================================================

Deno.test({
  name: "setFieldStoryPoints - sets points when value is provided",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(UPDATE_FIELD_OK);

    await mutator.setFieldStoryPoints(TEST_ITEM_ID, 5);

    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(vars(gh, 0).input.value?.number, 5);
  },
});

Deno.test({
  name: "setFieldStoryPoints - clears field when value is null",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(CLEAR_FIELD_OK);

    await mutator.setFieldStoryPoints(TEST_ITEM_ID, null);

    assertEquals(gh.graphqlCalls.length, 1);
    assertStringIncludes(gh.graphqlCalls[0].queryExcerpt, "ClearItemField");
  },
});

Deno.test({
  name: "setFieldStoryPoints - throws FIELD_NOT_CONFIGURED when field is missing",
  async fn() {
    const baseConfig = makeConfig();
    const { mutator } = createMutator({
      configOverrides: {
        live: { ...baseConfig.live, fields: { ...baseConfig.live.fields, storyPointsFieldId: "" } },
      },
    });

    const err = await assertRejects(
      () => mutator.setFieldStoryPoints(TEST_ITEM_ID, 3),
      GitHubApiError,
    );

    assertEquals(err.code, "FIELD_NOT_CONFIGURED");
  },
});

// =============================================================================
// Group E - setFieldPriority
// =============================================================================

Deno.test({
  name: "setFieldPriority - sets priority when option is valid",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(UPDATE_FIELD_OK);

    await mutator.setFieldPriority(TEST_ITEM_ID, "Must");

    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(vars(gh, 0).input.value?.singleSelectOptionId, "opt_must");
  },
});

Deno.test({
  name: "setFieldPriority - clears field when value is null",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(CLEAR_FIELD_OK);

    await mutator.setFieldPriority(TEST_ITEM_ID, null);

    assertStringIncludes(gh.graphqlCalls[0].queryExcerpt, "ClearItemField");
  },
});

Deno.test({
  name: "setFieldPriority - throws OPTION_NOT_FOUND when priority is not in vocabulary",
  async fn() {
    const { mutator } = createMutator();

    const err = await assertRejects(
      () => mutator.setFieldPriority(TEST_ITEM_ID, "Critical"),
      GitHubApiError,
    );

    assertEquals(err.code, "OPTION_NOT_FOUND");
    assertStringIncludes(err.message, "Critical");
  },
});

Deno.test({
  name: "setFieldPriority - throws FIELD_NOT_CONFIGURED when field is missing",
  async fn() {
    const baseConfig = makeConfig();
    const { mutator } = createMutator({
      configOverrides: {
        live: { ...baseConfig.live, fields: { ...baseConfig.live.fields, priorityFieldId: "" } },
      },
    });

    const err = await assertRejects(
      () => mutator.setFieldPriority(TEST_ITEM_ID, "Must"),
      GitHubApiError,
    );

    assertEquals(err.code, "FIELD_NOT_CONFIGURED");
  },
});

// =============================================================================
// Group F - setFieldType
// =============================================================================

Deno.test({
  name: "setFieldType - sets type when option is valid",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(UPDATE_FIELD_OK);

    await mutator.setFieldType(TEST_ITEM_ID, "feature");

    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(vars(gh, 0).input.value?.singleSelectOptionId, "opt_feature");
  },
});

Deno.test({
  name: "setFieldType - clears field when value is null",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(CLEAR_FIELD_OK);

    await mutator.setFieldType(TEST_ITEM_ID, null);

    assertStringIncludes(gh.graphqlCalls[0].queryExcerpt, "ClearItemField");
  },
});

Deno.test({
  name: "setFieldType - throws OPTION_NOT_FOUND when type is not in vocabulary",
  async fn() {
    const { mutator } = createMutator();

    const err = await assertRejects(
      () => mutator.setFieldType(TEST_ITEM_ID, "epic"),
      GitHubApiError,
    );

    assertEquals(err.code, "OPTION_NOT_FOUND");
    assertStringIncludes(err.message, "epic");
  },
});

Deno.test({
  name: "setFieldType - throws FIELD_NOT_CONFIGURED when type field is missing",
  async fn() {
    const baseConfig = makeConfig();
    const { mutator } = createMutator({
      configOverrides: {
        live: { ...baseConfig.live, fields: { ...baseConfig.live.fields, typeFieldId: "" } },
      },
    });

    const err = await assertRejects(
      () => mutator.setFieldType(TEST_ITEM_ID, "feature"),
      GitHubApiError,
    );

    assertEquals(err.code, "FIELD_NOT_CONFIGURED");
  },
});

// =============================================================================
// Group G - setFieldAssignee (calls through UserMilestoneResolver with fixtures)
// =============================================================================

Deno.test({
  name: "setFieldAssignee - clears all assignees when value is null",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(CLEAR_ASSIGNEES_OK);

    await mutator.setFieldAssignee(TEST_ISSUE_ID, null);

    assertEquals(gh.graphqlCalls.length, 1);
    assertStringIncludes(gh.graphqlCalls[0].queryExcerpt, "ClearAssignees");
    assertEquals(vars(gh, 0).issueId, TEST_ISSUE_ID);
  },
});

Deno.test({
  name:
    "setFieldAssignee - resolves user via UserMilestoneResolver then sets assignee using real fixture",
  async fn() {
    const { mutator, gh } = createMutator();
    // First graphql call: real fixture response for GetUserNodeId
    gh.enqueue(USER_FOUND_RESPONSE);
    // Second graphql call: SetAssignee mutation response
    gh.enqueue(SET_ASSIGNEE_OK);

    await mutator.setFieldAssignee(TEST_ISSUE_ID, REAL_LOGIN);

    assertEquals(gh.graphqlCalls.length, 2);

    // First call should be GetUserNodeId via the resolver
    assertStringIncludes(gh.graphqlCalls[0].queryExcerpt, "GetUserNodeId");
    assertEquals(vars(gh, 0).login, REAL_LOGIN);

    // Second call should be SetAssignee mutation
    assertStringIncludes(gh.graphqlCalls[1].queryExcerpt, "SetAssignee");
    assertEquals(vars(gh, 1).issueId, TEST_ISSUE_ID);
    assertEquals(vars(gh, 1).userId, REAL_USER_ID);
  },
});

Deno.test({
  name: "setFieldAssignee - propagates NOT_FOUND when user is not found via real fixture",
  async fn() {
    const { mutator, gh } = createMutator();
    gh.enqueue(USER_NULL_RESPONSE);

    const err = await assertRejects(
      () => mutator.setFieldAssignee(TEST_ISSUE_ID, "nonexistent-user"),
      GitHubApiError,
    );

    assertEquals(err.code, "NOT_FOUND");
    assertStringIncludes(err.message, "not found");
    assertEquals(gh.graphqlCalls.length, 1);
    assertStringIncludes(gh.graphqlCalls[0].queryExcerpt, "GetUserNodeId");
  },
});
