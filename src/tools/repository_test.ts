import { assertStringIncludes } from "@std/assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerRepositoryTools } from "./repository.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Replace fetch with a single fixed response and return a restore callback. */
const mockFetch = (data: unknown, status = 200): () => void => {
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ data }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  return () => {
    globalThis.fetch = original;
  };
};

/**
 * Replace fetch with a sequence of responses (consumed in order).
 * Useful for tools that make two GraphQL calls (e.g. create_issue, write_repo_file).
 * Falls back to the last entry if more calls arrive than responses provided.
 */
const mockFetchSequence = (
  responses: Array<{ data: unknown; status?: number }>,
): () => void => {
  const original = globalThis.fetch;
  let index = 0;
  globalThis.fetch = () => {
    const entry = responses[index] ?? responses[responses.length - 1];
    index++;
    return Promise.resolve(
      new Response(JSON.stringify({ data: entry.data }), {
        status: entry.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return () => {
    globalThis.fetch = original;
  };
};

const makeTestClient = async () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRepositoryTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
};

const getText = (result: Awaited<ReturnType<Client["callTool"]>>): string =>
  (result.content[0] as { text: string }).text;

// ---------------------------------------------------------------------------
// github_graphql
// ---------------------------------------------------------------------------

Deno.test("github_graphql - valid query: returns formatted JSON response", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({ repository: { id: "R_kgDO123", name: "my-repo" } });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_graphql",
      arguments: {
        query: `query { repository(owner: "owner", name: "my-repo") { id name } }`,
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "R_kgDO123");
    assertStringIncludes(text, "my-repo");
  } finally {
    restore();
  }
});

Deno.test("github_graphql - all-null response: appends permission warning", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  // GitHub returns HTTP 200 with null fields when the token lacks read access
  const restore = mockFetch({ repository: null, user: null });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_graphql",
      arguments: {
        query: `query { repository(owner: "owner", name: "private-repo") { id } }`,
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "null");
    assertStringIncludes(text, "⚠️");
    assertStringIncludes(text, "fine-grained token");
  } finally {
    restore();
  }
});

Deno.test("github_graphql - mutation keyword blocked: returns read-only error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({});
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_graphql",
      arguments: {
        query: `mutation { createIssue(input: {}) { issue { id } } }`,
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "read-only");
    assertStringIncludes(text, "Error:");
  } finally {
    restore();
  }
});

Deno.test("github_graphql - with variables: passes variables to request", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({ user: { id: "U_123", login: "alice" } });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_graphql",
      arguments: {
        query: `query GetUser($login: String!) { user(login: $login) { id login } }`,
        variables: { login: "alice" },
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "U_123");
    assertStringIncludes(text, "alice");
  } finally {
    restore();
  }
});

Deno.test("github_graphql - API error: returns formatted error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({}, 500);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_graphql",
      arguments: {
        query: `query { viewer { login } }`,
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "Error:");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// github_get_repo_file
// ---------------------------------------------------------------------------

Deno.test("github_get_repo_file - file found: returns content, OID, and ref header", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    repository: {
      object: {
        text: "project:\n  owner: hoonsubin\n",
        oid: "abc123def456",
      },
    },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_repo_file",
      arguments: {
        owner: "hoonsubin",
        repo: "my-repo",
        path: ".github/scrum/config.yml",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "hoonsubin/my-repo");
    assertStringIncludes(text, ".github/scrum/config.yml");
    assertStringIncludes(text, "abc123def456");
    assertStringIncludes(text, "project:");
  } finally {
    restore();
  }
});

Deno.test("github_get_repo_file - custom ref: includes ref in header", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    repository: { object: { text: "v1 content", oid: "oid_v1" } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_repo_file",
      arguments: {
        owner: "owner",
        repo: "repo",
        path: "README.md",
        ref: "v1.0.0",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "v1.0.0");
    assertStringIncludes(text, "oid_v1");
    assertStringIncludes(text, "v1 content");
  } finally {
    restore();
  }
});

Deno.test("github_get_repo_file - path not found (blob null): returns path error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({ repository: { object: null } });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_repo_file",
      arguments: {
        owner: "owner",
        repo: "repo",
        path: "nonexistent/file.txt",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "Error:");
    assertStringIncludes(text, "nonexistent/file.txt");
    assertStringIncludes(text, "not found");
  } finally {
    restore();
  }
});

Deno.test("github_get_repo_file - repo not found: returns repo error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({ repository: null });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_repo_file",
      arguments: {
        owner: "owner",
        repo: "ghost-repo",
        path: "README.md",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "Error:");
    assertStringIncludes(text, "ghost-repo");
    assertStringIncludes(text, "not found");
  } finally {
    restore();
  }
});

Deno.test("github_get_repo_file - API error: returns formatted error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({}, 401);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_repo_file",
      arguments: {
        owner: "owner",
        repo: "repo",
        path: "README.md",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "Error:");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// github_create_issue
// ---------------------------------------------------------------------------

Deno.test("github_create_issue - success: returns issue number, node ID, and URL", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetchSequence([
    // Step 1: repo ID lookup
    { data: { repository: { id: "R_kgDO123" } } },
    // Step 2: createIssue mutation
    {
      data: {
        createIssue: {
          issue: {
            id: "I_kwDO456",
            number: 7,
            title: "New feature request",
            url: "https://github.com/owner/repo/issues/7",
          },
        },
      },
    },
  ]);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_create_issue",
      arguments: {
        owner: "owner",
        repo: "repo",
        title: "New feature request",
        body: "Please add this feature.",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "New feature request");
    assertStringIncludes(text, "#7");
    assertStringIncludes(text, "I_kwDO456");
    assertStringIncludes(text, "https://github.com/owner/repo/issues/7");
  } finally {
    restore();
  }
});

Deno.test("github_create_issue - with assignees and labels: succeeds", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetchSequence([
    { data: { repository: { id: "R_kgDO123" } } },
    {
      data: {
        createIssue: {
          issue: {
            id: "I_kwDO999",
            number: 10,
            title: "Assigned issue",
            url: "https://github.com/owner/repo/issues/10",
          },
        },
      },
    },
  ]);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_create_issue",
      arguments: {
        owner: "owner",
        repo: "repo",
        title: "Assigned issue",
        assignee_ids: ["U_kgDO123"],
        label_ids: ["LA_001"],
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "Assigned issue");
    assertStringIncludes(text, "#10");
  } finally {
    restore();
  }
});

Deno.test("github_create_issue - repo not found: returns repo error before mutation", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({ repository: null });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_create_issue",
      arguments: {
        owner: "owner",
        repo: "ghost-repo",
        title: "Should fail",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "Error:");
    assertStringIncludes(text, "ghost-repo");
    assertStringIncludes(text, "not found");
  } finally {
    restore();
  }
});

Deno.test("github_create_issue - API error on mutation: returns formatted error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetchSequence([
    { data: { repository: { id: "R_kgDO123" } } },
    { data: {}, status: 500 },
  ]);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_create_issue",
      arguments: {
        owner: "owner",
        repo: "repo",
        title: "Will error",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "Error:");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// github_update_issue
// ---------------------------------------------------------------------------

Deno.test("github_update_issue - close issue: returns CLOSED state", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    updateIssue: {
      issue: {
        id: "I_kwDO456",
        number: 7,
        title: "Fixed bug",
        state: "CLOSED",
        url: "https://github.com/owner/repo/issues/7",
      },
    },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_update_issue",
      arguments: {
        issue_node_id: "I_kwDO456",
        state: "CLOSED",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "CLOSED");
    assertStringIncludes(text, "I_kwDO456");
  } finally {
    restore();
  }
});

Deno.test("github_update_issue - title and body update: returns updated title", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    updateIssue: {
      issue: {
        id: "I_kwDO456",
        number: 7,
        title: "Updated title",
        state: "OPEN",
        url: "https://github.com/owner/repo/issues/7",
      },
    },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_update_issue",
      arguments: {
        issue_node_id: "I_kwDO456",
        title: "Updated title",
        body: "New body content",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "Updated title");
    assertStringIncludes(text, "#7");
  } finally {
    restore();
  }
});

Deno.test("github_update_issue - API error: returns formatted error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({}, 500);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_update_issue",
      arguments: {
        issue_node_id: "I_kwDO456",
        state: "CLOSED",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "Error:");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// github_create_comment
// ---------------------------------------------------------------------------

Deno.test("github_create_comment - issue type: uses addComment mutation, returns URL", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    addComment: {
      commentEdge: {
        node: {
          id: "IC_kwDO123",
          url: "https://github.com/owner/repo/issues/7#issuecomment-1",
        },
      },
    },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_create_comment",
      arguments: {
        subject_id: "I_kwDO456",
        body: "This is a comment.",
        type: "issue",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "IC_kwDO123");
    assertStringIncludes(text, "issuecomment-1");
  } finally {
    restore();
  }
});

Deno.test("github_create_comment - pr type: uses addComment mutation (same path as issue)", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    addComment: {
      commentEdge: {
        node: {
          id: "IC_kwPR789",
          url: "https://github.com/owner/repo/pull/3#issuecomment-2",
        },
      },
    },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_create_comment",
      arguments: {
        subject_id: "PR_kwDO789",
        body: "LGTM 🚀",
        type: "pr",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "IC_kwPR789");
  } finally {
    restore();
  }
});

Deno.test("github_create_comment - discussion type: uses addDiscussionComment mutation", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    addDiscussionComment: {
      comment: {
        id: "DC_kwDO_abc",
        url: "https://github.com/owner/repo/discussions/1#discussioncomment-1",
      },
    },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_create_comment",
      arguments: {
        subject_id: "D_kwDO123",
        body: "Great discussion!",
        type: "discussion",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "DC_kwDO_abc");
    assertStringIncludes(text, "Discussion comment");
  } finally {
    restore();
  }
});

Deno.test("github_create_comment - API error: returns formatted error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({}, 403);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_create_comment",
      arguments: {
        subject_id: "I_kwDO456",
        body: "Should fail",
        type: "issue",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "Error:");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// github_write_repo_file
// ---------------------------------------------------------------------------

Deno.test("github_write_repo_file - success: returns commit OID and URL", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetchSequence([
    // Step 1: HEAD OID lookup
    {
      data: {
        repository: {
          ref: { target: { oid: "deadbeef00000000000000000000000000000001" } },
        },
      },
    },
    // Step 2: createCommitOnBranch mutation
    {
      data: {
        createCommitOnBranch: {
          commit: {
            oid: "cafebabe00000000000000000000000000000002",
            url: "https://github.com/owner/repo/commit/cafebabe00000000000000000000000000000002",
          },
        },
      },
    },
  ]);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_write_repo_file",
      arguments: {
        owner: "owner",
        repo: "repo",
        branch: "main",
        path: ".github/scrum/config.yml",
        content: "project:\n  owner: owner\n",
        commit_message: "chore: update scrum config",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, ".github/scrum/config.yml");
    assertStringIncludes(text, "main");
    assertStringIncludes(text, "cafebabe");
  } finally {
    restore();
  }
});

Deno.test("github_write_repo_file - branch not found: returns branch error before commit", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    repository: { ref: null },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_write_repo_file",
      arguments: {
        owner: "owner",
        repo: "repo",
        branch: "nonexistent-branch",
        path: "file.txt",
        content: "hello",
        commit_message: "test",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "Error:");
    assertStringIncludes(text, "nonexistent-branch");
    assertStringIncludes(text, "not found");
  } finally {
    restore();
  }
});

Deno.test("github_write_repo_file - repo not found: returns repo error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({ repository: null });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_write_repo_file",
      arguments: {
        owner: "owner",
        repo: "ghost-repo",
        branch: "main",
        path: "file.txt",
        content: "hello",
        commit_message: "test",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "Error:");
    assertStringIncludes(text, "ghost-repo");
    assertStringIncludes(text, "not found");
  } finally {
    restore();
  }
});

Deno.test("github_write_repo_file - API error on commit: returns formatted error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetchSequence([
    {
      data: {
        repository: {
          ref: { target: { oid: "deadbeef00000000000000000000000000000001" } },
        },
      },
    },
    { data: {}, status: 500 },
  ]);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_write_repo_file",
      arguments: {
        owner: "owner",
        repo: "repo",
        branch: "main",
        path: "file.txt",
        content: "hello",
        commit_message: "will fail",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "Error:");
  } finally {
    restore();
  }
});

Deno.test("github_write_repo_file - utf8 content: file with unicode characters commits successfully", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetchSequence([
    {
      data: {
        repository: {
          ref: { target: { oid: "deadbeef00000000000000000000000000000001" } },
        },
      },
    },
    {
      data: {
        createCommitOnBranch: {
          commit: {
            oid: "unicode00000000000000000000000000000003",
            url: "https://github.com/owner/repo/commit/unicode00000000000000000000000000000003",
          },
        },
      },
    },
  ]);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_write_repo_file",
      arguments: {
        owner: "owner",
        repo: "repo",
        branch: "main",
        path: "unicode.md",
        content: "# 日本語テスト\n\nHello 世界 🌍",
        commit_message: "feat: add unicode content",
      },
    });
    const text = getText(result);
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "unicode.md");
    assertStringIncludes(text, "unicode000");
  } finally {
    restore();
  }
});
