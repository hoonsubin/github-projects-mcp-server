// =============================================================================
// src/adapters/github/internal/user-milestone-resolver.test.ts
//
// Unit tests for UserMilestoneResolver: resolveUserNodeId, resolveUserNodeIds,
// and resolveOrCreateMilestoneNodeId.
// Mocks all injected dependencies via a queue-based GitHubClient spy.
// =============================================================================

import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { UserMilestoneResolver } from "./user-milestone-resolver.ts";
import type { GitHubClient, RestResponse } from "./http-client.ts";
import type { RepoNodeIdProvider } from "./label-resolver.ts";
import { GitHubApiError } from "../errors.ts";

// =============================================================================
// GraphQL response fixtures
// =============================================================================

/** User found — { user: { id: "MDQ6VXNlcjE=" } } */
const USER_FOUND = { user: { id: "MDQ6VXNlcjE=" } };

/** User null — { user: null } (triggers NOT_FOUND) */
const USER_NULL = { user: null };

/** User undefined — {} (no user key at all) */
const USER_UNDEF = {};

/** Milestones found — { repository: { milestones: { nodes: [{ id: "MI_1", title: "Sprint Goal" }] } } } */
const MILESTONES_FOUND = {
  repository: {
    milestones: {
      nodes: [{ id: "MI_1", title: "Sprint Goal" }],
    },
  },
};

/** Milestones empty — { repository: { milestones: { nodes: [] } } } */
const MILESTONES_EMPTY = {
  repository: {
    milestones: {
      nodes: [],
    },
  },
};

/** Milestones null — { repository: { milestones: null } } (nodes defaults to []) */
const MILESTONES_NULL = {
  repository: {
    milestones: null,
  },
};

/** Milestones undefined repository — { repository: null } */
const MILESTONES_UNDEF = {
  repository: null,
};

/** Milestone created — { createMilestone: { milestone: { id: "MI_new" } } } */
const MILESTONE_CREATED = {
  createMilestone: {
    milestone: { id: "MI_new" },
  },
};

/** Milestone create mutation returned null — { createMilestone: null } */
const MILESTONE_CREATE_NULL = { createMilestone: null };

/** Milestone create mutation returned null milestone — { createMilestone: { milestone: null } } */
const MILESTONE_CREATE_MILESTONE_NULL = {
  createMilestone: { milestone: null },
};

// =============================================================================
// GitHubClient spy — queue-based to handle sequential graphql calls
// =============================================================================

interface GitHubClientSpy extends GitHubClient {
  graphqlCalls: Array<{
    queryExcerpt: string;
    variables: Record<string, unknown>;
  }>;
  enqueue(...responses: unknown[]): void;
  remaining(): number;
}

const createGhSpy = (): GitHubClientSpy => {
  const queue: unknown[] = [];
  const spy: GitHubClientSpy = {
    graphqlCalls: [],
    async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      spy.graphqlCalls.push({
        queryExcerpt: query.slice(0, 80).replace(/\s+/g, " "),
        variables: variables ?? {},
      });
      if (queue.length === 0) {
        throw new Error(
          `Unmocked graphql (empty queue): ${query.slice(0, 120)}`,
        );
      }
      const r = queue.shift()!;
      if (r instanceof Error) throw r;
      return await Promise.resolve(r as T);
    },
    async rest<T>(
      _path: string,
      _options?: Record<string, unknown>,
    ): Promise<RestResponse<T>> {
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
// Service factory
// =============================================================================

interface CreateResolverOptions {
  repoNodeId?: string;
}

const createResolver = (options: CreateResolverOptions = {}) => {
  const gh = createGhSpy();
  const repoNodeIdProvider: RepoNodeIdProvider = {
    fetchRepoNodeId(): Promise<string> {
      return Promise.resolve(options.repoNodeId ?? "R_repo1");
    },
  };
  const resolver = new UserMilestoneResolver(
    gh,
    "test-owner",
    "test-repo",
    repoNodeIdProvider,
  );
  return { resolver, gh, repoNodeIdProvider };
};

// =============================================================================
// Test-specification helpers — express intent, not wiring
// =============================================================================

const givenUserExists = (spy: GitHubClientSpy): void => {
  spy.enqueue(USER_FOUND);
};

const givenUserNotFound = (spy: GitHubClientSpy): void => {
  spy.enqueue(USER_NULL);
};

const givenMilestoneNotFound = (spy: GitHubClientSpy): void => {
  spy.enqueue(MILESTONES_EMPTY, MILESTONE_CREATED);
};

// ═══════════════════════════════════════════════════════════════════════════════
// Group A — resolveUserNodeId
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "resolveUserNodeId - returns user node ID when user exists",
  async fn() {
    const { resolver, gh } = createResolver();
    givenUserExists(gh);

    const nodeId = await resolver.resolveUserNodeId("testuser");

    assertEquals(nodeId, "MDQ6VXNlcjE=");
    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(gh.remaining(), 0);
  },
});

Deno.test({
  name: "resolveUserNodeId - passes correct login variable to GraphQL",
  async fn() {
    const { resolver, gh } = createResolver();
    givenUserExists(gh);

    await resolver.resolveUserNodeId("specific-user");

    assertEquals(gh.graphqlCalls[0].variables.login, "specific-user");
  },
});

Deno.test({
  name: "resolveUserNodeId - throws NOT_FOUND when user is null",
  async fn() {
    const { resolver, gh } = createResolver();
    givenUserNotFound(gh);

    const result = await assertRejects(
      () => resolver.resolveUserNodeId("ghost-user"),
      GitHubApiError,
    );

    assertEquals(result.code, "NOT_FOUND");
    assertEquals(result.statusCode, 404);
    assertStringIncludes(result.message, "not found");
    assertStringIncludes(
      result.recovery,
      "spelled correctly",
      "recovery should guide the agent to verify the username",
    );
  },
});

Deno.test({
  name: "resolveUserNodeId - throws NOT_FOUND when result has no user key",
  async fn() {
    const { resolver, gh } = createResolver();
    gh.enqueue(USER_UNDEF);

    const result = await assertRejects(
      () => resolver.resolveUserNodeId("nonexistent"),
      GitHubApiError,
    );

    assertEquals(result.code, "NOT_FOUND");
    assertEquals(result.statusCode, 404);
    assertStringIncludes(
      result.recovery,
      "spelled correctly",
      "recovery should guide the agent to verify the username",
    );
  },
});

Deno.test({
  name: "resolveUserNodeId - includes login and recovery in error",
  async fn() {
    const { resolver, gh } = createResolver();
    givenUserNotFound(gh);

    const result = await assertRejects(
      () => resolver.resolveUserNodeId("ghost-user"),
      GitHubApiError,
    );

    assertEquals(result.context?.login, "ghost-user");
    assertStringIncludes(
      result.recovery,
      "spelled correctly",
      "recovery should guide the agent to verify the username",
    );
  },
});

Deno.test({
  name: "resolveUserNodeId - propagates GraphQL transport error",
  async fn() {
    const { resolver, gh } = createResolver();
    gh.enqueue(
      new GitHubApiError("Personal access token is invalid", {
        code: "AUTH_FAILED",
        recovery: "Regenerate the token at https://github.com/settings/tokens.",
        statusCode: 401,
      }),
    );

    const result = await assertRejects(
      () => resolver.resolveUserNodeId("any-user"),
      GitHubApiError,
    );

    assertEquals(result.code, "AUTH_FAILED");
    assertEquals(result.statusCode, 401);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group B — resolveUserNodeIds
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "resolveUserNodeIds - resolves multiple logins sequentially",
  async fn() {
    const { resolver, gh } = createResolver();
    givenUserExists(gh);
    givenUserExists(gh);
    givenUserExists(gh);

    const nodeIds = await resolver.resolveUserNodeIds([
      "user1",
      "user2",
      "user3",
    ]);

    assertEquals(nodeIds, [
      "MDQ6VXNlcjE=",
      "MDQ6VXNlcjE=",
      "MDQ6VXNlcjE=",
    ]);
    assertEquals(gh.graphqlCalls.length, 3);
    assertEquals(gh.remaining(), 0);
  },
});

Deno.test({
  name: "resolveUserNodeIds - empty array returns empty array",
  async fn() {
    const { resolver, gh } = createResolver();

    const nodeIds = await resolver.resolveUserNodeIds([]);

    assertEquals(nodeIds, []);
    assertEquals(gh.graphqlCalls.length, 0);
  },
});

Deno.test({
  name: "resolveUserNodeIds - propagates error with recovery when a login fails",
  async fn() {
    const { resolver, gh } = createResolver();
    // First call succeeds, second call throws
    givenUserExists(gh);
    givenUserNotFound(gh);

    const result = await assertRejects(
      () => resolver.resolveUserNodeIds(["valid-user", "ghost-user"]),
      GitHubApiError,
    );

    assertEquals(gh.graphqlCalls.length, 2);
    assertEquals(result.code, "NOT_FOUND");
    assertStringIncludes(
      result.recovery,
      "spelled correctly",
      "recovery should propagate through resolveUserNodeIds",
    );
  },
});

Deno.test({
  name: "resolveUserNodeIds - resolves single login",
  async fn() {
    const { resolver, gh } = createResolver();
    givenUserExists(gh);

    const nodeIds = await resolver.resolveUserNodeIds(["single-user"]);

    assertEquals(nodeIds, ["MDQ6VXNlcjE="]);
    assertEquals(gh.graphqlCalls.length, 1);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group C — resolveOrCreateMilestoneNodeId
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "resolveOrCreateMilestoneNodeId - returns existing milestone ID (exact match)",
  async fn() {
    const { resolver, gh } = createResolver();
    gh.enqueue(MILESTONES_FOUND);

    const milestoneId = await resolver.resolveOrCreateMilestoneNodeId(
      "Sprint Goal",
    );

    assertEquals(milestoneId, "MI_1");
    assertEquals(gh.graphqlCalls.length, 1);
  },
});

Deno.test({
  name: "resolveOrCreateMilestoneNodeId - matches case-insensitively",
  async fn() {
    const { resolver, gh } = createResolver();
    gh.enqueue(MILESTONES_FOUND);

    const milestoneId = await resolver.resolveOrCreateMilestoneNodeId(
      "sprint goal",
    );

    assertEquals(milestoneId, "MI_1");
  },
});

Deno.test({
  name: "resolveOrCreateMilestoneNodeId - passes correct owner/repo variables",
  async fn() {
    const { resolver, gh } = createResolver();
    gh.enqueue(MILESTONES_FOUND);

    await resolver.resolveOrCreateMilestoneNodeId("Sprint Goal");

    assertEquals(gh.graphqlCalls[0].variables.owner, "test-owner");
    assertEquals(gh.graphqlCalls[0].variables.repo, "test-repo");
  },
});

Deno.test({
  name: "resolveOrCreateMilestoneNodeId - creates milestone when not found",
  async fn() {
    const { resolver, gh } = createResolver();
    givenMilestoneNotFound(gh);

    const milestoneId = await resolver.resolveOrCreateMilestoneNodeId(
      "New Milestone",
    );

    assertEquals(milestoneId, "MI_new");
    assertEquals(gh.graphqlCalls.length, 2);
  },
});

Deno.test({
  name: "resolveOrCreateMilestoneNodeId - passes correct title and repositoryId to create mutation",
  async fn() {
    const { resolver, gh } = createResolver();
    givenMilestoneNotFound(gh);

    await resolver.resolveOrCreateMilestoneNodeId("New Milestone");

    assertEquals(gh.graphqlCalls[1].variables.title, "New Milestone");
    assertEquals(
      gh.graphqlCalls[1].variables.repositoryId,
      "R_repo1",
    );
  },
});

Deno.test({
  name: "resolveOrCreateMilestoneNodeId - handles null milestones gracefully (defaults to [])",
  async fn() {
    const { resolver, gh } = createResolver();
    // MILESTONES_NULL has milestones: null → nodes defaults to [] → falls through to create
    gh.enqueue(MILESTONES_NULL, MILESTONE_CREATED);

    const milestoneId = await resolver.resolveOrCreateMilestoneNodeId(
      "New Milestone",
    );

    assertEquals(milestoneId, "MI_new");
    assertEquals(gh.graphqlCalls.length, 2);
  },
});

Deno.test({
  name: "resolveOrCreateMilestoneNodeId - handles missing repository gracefully",
  async fn() {
    const { resolver, gh } = createResolver();
    // MILESTONES_UNDEF has repository: null → nodes defaults to [] → falls through to create
    gh.enqueue(MILESTONES_UNDEF, MILESTONE_CREATED);

    const milestoneId = await resolver.resolveOrCreateMilestoneNodeId(
      "New Milestone",
    );

    assertEquals(milestoneId, "MI_new");
    assertEquals(gh.graphqlCalls.length, 2);
  },
});

Deno.test({
  name: "resolveOrCreateMilestoneNodeId - throws when createMilestone is null",
  async fn() {
    const { resolver, gh } = createResolver();
    gh.enqueue(MILESTONES_EMPTY, MILESTONE_CREATE_NULL);

    await assertRejects(
      () => resolver.resolveOrCreateMilestoneNodeId("New Milestone"),
      Error,
    );

    assertEquals(gh.graphqlCalls.length, 2);
  },
});

Deno.test({
  name: "resolveOrCreateMilestoneNodeId - throws when createMilestone.milestone is null",
  async fn() {
    const { resolver, gh } = createResolver();
    gh.enqueue(MILESTONES_EMPTY, MILESTONE_CREATE_MILESTONE_NULL);

    await assertRejects(
      () => resolver.resolveOrCreateMilestoneNodeId("New Milestone"),
      Error,
    );

    assertEquals(gh.graphqlCalls.length, 2);
  },
});

Deno.test({
  name: "resolveOrCreateMilestoneNodeId - propagates error when fetchRepoNodeId fails",
  async fn() {
    const failingProvider: RepoNodeIdProvider = {
      fetchRepoNodeId(): Promise<string> {
        return Promise.reject(
          new GitHubApiError("Repo node ID resolution failed", {
            code: "NOT_FOUND",
            recovery: "Verify the repository exists.",
            statusCode: 404,
          }),
        );
      },
    };
    const gh = createGhSpy();
    // First call (milestones query) must succeed so we reach fetchRepoNodeId
    gh.enqueue(MILESTONES_EMPTY);
    const resolver = new UserMilestoneResolver(
      gh,
      "test-owner",
      "test-repo",
      failingProvider,
    );

    await assertRejects(
      () => resolver.resolveOrCreateMilestoneNodeId("New Milestone"),
      GitHubApiError,
    );
  },
});
