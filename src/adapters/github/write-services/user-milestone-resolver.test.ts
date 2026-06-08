// =============================================================================
// src/adapters/github/user-milestone-resolver.test.ts
//
// Unit tests for UserMilestoneResolver: resolveUserNodeId and resolveUserNodeIds.
// Uses real GraphQL response fixtures captured via scripts/api-capture/github-capturer.ts.
// The fixture data flows through the same spy.enqueue() → graphql() → production
// code path that the real adapter uses.
// =============================================================================

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { UserMilestoneResolver } from "./user-milestone-resolver.ts";
import { createGhSpy, type GitHubClientSpy, makeCtx } from "@test/support/github-client.ts";
import { GitHubApiError } from "../errors.ts";
import { FIXTURE_USER_ID, USERNODE_IDS } from "@test/fixtures/github/index.ts";

// =============================================================================
// Fixture-derived constants
// =============================================================================

/** The real owner login from the captured fixture - matches the config owner. */
const REAL_LOGIN = "hoonsubin";

/** Real API response for a valid assignee user. */
const USER_FOUND = USERNODE_IDS[REAL_LOGIN];

/** Synthesized NOT_FOUND response - API returns { user: null } for unknown logins. */
const USER_NULL = USERNODE_IDS["_not_found_"];

/** Malformed response - no user key at all (edge case). */
const USER_UNDEF = {};

// Assert fixture integrity at module-load time
assertEquals(typeof USER_FOUND, "object", "USER_FOUND fixture must be an object");
assertEquals(typeof USER_FOUND.user, "object", "USER_FOUND.user must be an object");
assertEquals(typeof FIXTURE_USER_ID, "string", "FIXTURE_USER_ID must be a string");
assert(
  FIXTURE_USER_ID.startsWith("U_") || FIXTURE_USER_ID.startsWith("MDQ6VXNlcj"),
  `GitHub user node ID should start with "U_" or "MDQ6VXNlcj", got: ${FIXTURE_USER_ID}`,
);
assertEquals(USER_NULL.user, null, "USER_NULL fixture must have user: null");

// =============================================================================
// Service factory
// =============================================================================

const createResolver = () => {
  const gh = createGhSpy();
  const ctx = makeCtx(gh);
  const resolver = new UserMilestoneResolver(ctx);
  return { resolver, gh };
};

// =============================================================================
// Test-specification helpers - express intent, not wiring
// =============================================================================

const givenUserExists = (spy: GitHubClientSpy): void => {
  spy.enqueue(USER_FOUND);
};

const SUGGESTED_ACTORS_EMPTY = {
  repository: { suggestedActors: { nodes: [] as Array<null> } },
};

const givenUserNotFound = (spy: GitHubClientSpy): void => {
  spy.enqueue(USER_NULL);
  spy.enqueue(SUGGESTED_ACTORS_EMPTY);
};

// ═══════════════════════════════════════════════════════════════════════════════
// Group A - resolveUserNodeId
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "resolveUserNodeId - returns user node ID from real fixture when user exists",
  async fn() {
    const { resolver, gh } = createResolver();
    givenUserExists(gh);

    const nodeId = await resolver.resolveUserNodeId(REAL_LOGIN);

    assertEquals(nodeId, FIXTURE_USER_ID);
    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(gh.remaining(), 0);
  },
});

Deno.test({
  name: "resolveUserNodeId - passes correct login variable to GraphQL",
  async fn() {
    const { resolver, gh } = createResolver();
    givenUserExists(gh);

    await resolver.resolveUserNodeId(REAL_LOGIN);

    assertEquals(gh.graphqlCalls[0].variables.login, REAL_LOGIN);
  },
});

Deno.test({
  name: "resolveUserNodeId - throws NOT_FOUND when user is null (fixture-driven)",
  async fn() {
    const { resolver, gh } = createResolver();
    givenUserNotFound(gh);

    const result = await assertRejects(
      () => resolver.resolveUserNodeId("nonexistent-user"),
      GitHubApiError,
    );

    assertEquals(result.code, "NOT_FOUND");
    assertEquals(result.statusCode, 404);
    assertStringIncludes(result.message, "not found");
    assertStringIncludes(result.message, "Actor");
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
    gh.enqueue(SUGGESTED_ACTORS_EMPTY);

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
  name: "resolveUserNodeIds - resolves multiple logins sequentially using real fixture",
  async fn() {
    const { resolver, gh } = createResolver();
    givenUserExists(gh);

    const nodeIds = await resolver.resolveUserNodeIds([
      REAL_LOGIN,
      REAL_LOGIN,
      REAL_LOGIN,
    ]);

    assertEquals(nodeIds, [
      FIXTURE_USER_ID,
      FIXTURE_USER_ID,
      FIXTURE_USER_ID,
    ]);
    assertEquals(gh.graphqlCalls.length, 1);
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

    assertEquals(gh.graphqlCalls.length, 3);
    assertEquals(result.code, "NOT_FOUND");
    assertStringIncludes(
      result.recovery,
      "spelled correctly",
      "recovery should propagate through resolveUserNodeIds",
    );
  },
});

Deno.test({
  name: "resolveUserNodeId - resolves organization login via organization() root",
  async fn() {
    const { resolver, gh } = createResolver();
    gh.enqueue({ user: null, organization: { id: "O_org1" } });

    const nodeId = await resolver.resolveUserNodeId("my-org");

    assertEquals(nodeId, "O_org1");
    assertStringIncludes(gh.graphqlCalls[0].queryExcerpt, "ResolveActorNodeId");
  },
});

Deno.test({
  name: "resolveUserNodeId - resolves bot login via suggestedActors fallback",
  async fn() {
    const { resolver, gh } = createResolver();
    gh.enqueue({ user: null, organization: null });
    gh.enqueue({
      repository: {
        suggestedActors: {
          nodes: [
            { login: "dependabot[bot]", id: "B_bot1" },
          ],
        },
      },
    });

    const nodeId = await resolver.resolveUserNodeId("dependabot[bot]");

    assertEquals(nodeId, "B_bot1");
    assertEquals(gh.graphqlCalls.length, 2);
    assertStringIncludes(gh.graphqlCalls[1].queryExcerpt, "ResolveAssignableActor");
  },
});

Deno.test({
  name: "resolveUserNodeIds - resolves single login using real fixture",
  async fn() {
    const { resolver, gh } = createResolver();
    givenUserExists(gh);

    const nodeIds = await resolver.resolveUserNodeIds([REAL_LOGIN]);

    assertEquals(nodeIds, [FIXTURE_USER_ID]);
    assertEquals(gh.graphqlCalls.length, 1);
  },
});
