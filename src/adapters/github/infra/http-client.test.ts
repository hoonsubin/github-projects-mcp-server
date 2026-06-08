// =============================================================================
// src/adapters/github/http-client.test.ts
//
// Tests for the graphql() transport: partial data+errors, errors-only, no data.
// =============================================================================

import { assertEquals, assertRejects } from "@std/assert";
import { graphql } from "./http-client.ts";
import { GitHubApiError } from "../errors.ts";
import type { ResolvedToken } from "../types.ts";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TEST_TOKEN = "ghp_test" as ResolvedToken;
const QUERY = "query TestQuery { viewer { login } }";

interface StubResponseInit {
  status?: number;
  ok?: boolean;
  jsonPayload: Record<string, unknown>;
  headers?: Record<string, string>;
}

const stubFetch = (init: StubResponseInit) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    return Promise.resolve({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: init.status === 401 ? "Unauthorized" : "OK",
      headers: new Headers(init.headers ?? {}),
      json: () => Promise.resolve(init.jsonPayload),
    } as Response);
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
};

// ── Tests ──────────────────────────────────────────────────────────────────────

Deno.test("graphql - returns data when both data and errors present (partial success)", async () => {
  const restore = stubFetch({
    jsonPayload: {
      data: { viewer: { login: "test-user" } },
      errors: [
        { message: "Warning: field X is deprecated." },
        { message: "Warning: some optional data unavailable." },
      ],
    },
  });

  try {
    const result = await graphql<{ viewer: { login: string } }>(TEST_TOKEN, QUERY, {});
    assertEquals(result.viewer.login, "test-user");
  } finally {
    restore();
  }
});

Deno.test("graphql - returns data normally when no errors", async () => {
  const restore = stubFetch({
    jsonPayload: {
      data: { viewer: { login: "test-user" } },
    },
  });

  try {
    const result = await graphql<{ viewer: { login: string } }>(TEST_TOKEN, QUERY, {});
    assertEquals(result.viewer.login, "test-user");
  } finally {
    restore();
  }
});

Deno.test("graphql - throws GitHubApiError when errors present but no data", async () => {
  const restore = stubFetch({
    jsonPayload: {
      errors: [
        { message: "Field 'foo' doesn't exist on type 'Query'" },
        { message: "Cannot query field 'bar' on type 'User'" },
      ],
    },
  });

  try {
    await assertRejects(
      () => graphql(TEST_TOKEN, QUERY, {}),
      GitHubApiError,
      "Field 'foo' doesn't exist",
    );
  } finally {
    restore();
  }
});

Deno.test("graphql - throws GitHubApiError when neither data nor errors", async () => {
  const restore = stubFetch({
    jsonPayload: {},
  });

  try {
    await assertRejects(
      () => graphql(TEST_TOKEN, QUERY, {}),
      GitHubApiError,
      "no data and no errors",
    );
  } finally {
    restore();
  }
});

Deno.test("graphql - throws GitHubApiError on HTTP 401", async () => {
  const restore = stubFetch({
    status: 401,
    ok: false,
    jsonPayload: {},
  });

  try {
    await assertRejects(
      () => graphql(TEST_TOKEN, QUERY, {}),
      GitHubApiError,
      "401",
    );
  } finally {
    restore();
  }
});

Deno.test("graphql - throws GitHubApiError when data undefined and errors empty array", async () => {
  const restore = stubFetch({
    jsonPayload: {
      data: undefined,
      errors: [],
    },
  });

  try {
    await assertRejects(
      () => graphql(TEST_TOKEN, QUERY, {}),
      GitHubApiError,
      "no data and no errors",
    );
  } finally {
    restore();
  }
});
