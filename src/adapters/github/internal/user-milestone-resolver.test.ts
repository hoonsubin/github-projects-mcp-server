// =============================================================================
// src/adapters/github/internal/user-milestone-resolver.test.ts
//
// Unit tests for UserMilestoneResolver: resolveUserNodeId and resolveUserNodeIds.
// Mocks all injected dependencies via a queue-based GitHubClient spy.
// =============================================================================

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { UserMilestoneResolver } from "./user-milestone-resolver.ts";
import { createGhSpy, type GitHubClientSpy } from "./_test_utils.ts";
import type { RepoNodeIdProvider } from "./label-resolver.ts";
import { GitHubApiError } from "../errors.ts";

// =============================================================================
// GraphQL response fixtures
// =============================================================================

/** User found - { user: { id: "MDQ6VXNlcjE=" } } */
const USER_FOUND = { user: { id: "MDQ6VXNlcjE=" } };

/** User null - { user: null } (triggers NOT_FOUND) */
const USER_NULL = { user: null };

/** User undefined - {} (no user key at all) */
const USER_UNDEF = {};

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
// Test-specification helpers - express intent, not wiring
// =============================================================================

const givenUserExists = (spy: GitHubClientSpy): void => {
  spy.enqueue(USER_FOUND);
};

const givenUserNotFound = (spy: GitHubClientSpy): void => {
  spy.enqueue(USER_NULL);
};

// ═══════════════════════════════════════════════════════════════════════════════
// Group A - resolveUserNodeId
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
// Group B - resolveUserNodeIds
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
