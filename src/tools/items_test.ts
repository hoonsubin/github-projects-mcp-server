import { assertStringIncludes } from "@std/assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerItemTools } from "./items.ts";
import type { ProjectV2Item } from "../types.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

const makeTestClient = async () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerItemTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
};

const makeDraftItem = (
  id = "PVTI_1",
  title = "My Draft Issue",
): ProjectV2Item =>
  ({
    id,
    type: "DraftIssue",
    isArchived: false,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    content: {
      __typename: "DraftIssue",
      id: "DI_1",
      title,
      body: "",
      assignees: { nodes: [] },
    },
    fieldValues: { nodes: [] },
  }) as ProjectV2Item;

const makeIssueItem = (
  id = "PVTI_2",
  number = 42,
  title = "Bug fix",
): ProjectV2Item =>
  ({
    id,
    type: "Issue",
    isArchived: false,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    content: {
      __typename: "Issue",
      id: "I_1",
      number,
      title,
      url: `https://github.com/owner/repo/issues/${number}`,
      state: "OPEN",
      body: "",
      assignees: { nodes: [] },
      labels: { nodes: [] },
      milestone: null,
      repository: { name: "repo", nameWithOwner: "owner/repo" },
    },
    fieldValues: { nodes: [] },
  }) as ProjectV2Item;

const wrapUserItems = (
  items: ProjectV2Item[],
  totalCount = items.length,
  hasNextPage = false,
  endCursor: string | null = null,
) => ({
  user: {
    projectV2: {
      items: {
        totalCount,
        pageInfo: { hasNextPage, endCursor, hasPreviousPage: false, startCursor: null },
        nodes: items,
      },
    },
  },
});

const wrapOrgItems = (
  items: ProjectV2Item[],
  totalCount = items.length,
  hasNextPage = false,
  endCursor: string | null = null,
) => ({
  organization: {
    projectV2: {
      items: {
        totalCount,
        pageInfo: { hasNextPage, endCursor, hasPreviousPage: false, startCursor: null },
        nodes: items,
      },
    },
  },
});

// ---------------------------------------------------------------------------
// github_list_project_items
// ---------------------------------------------------------------------------

Deno.test("github_list_project_items - user: returns formatted item list", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch(wrapUserItems([makeDraftItem()]));
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_list_project_items",
      arguments: {
        owner: "hoonsubin",
        owner_type: "user",
        project_number: 1,
        first: 20,
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "Project Items");
    assertStringIncludes(text, "PVTI_1");
    assertStringIncludes(text, "My Draft Issue");
  } finally {
    restore();
  }
});

Deno.test("github_list_project_items - org: resolves via organization key", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch(wrapOrgItems([makeDraftItem("PVTI_3", "Org Task")]));
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_list_project_items",
      arguments: {
        owner: "myorg",
        owner_type: "org",
        project_number: 2,
        first: 20,
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "Org Task");
  } finally {
    restore();
  }
});

Deno.test("github_list_project_items - project not found: returns specific error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({ user: { projectV2: null } });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_list_project_items",
      arguments: {
        owner: "hoonsubin",
        owner_type: "user",
        project_number: 99,
        first: 20,
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "not found");
    assertStringIncludes(text, "99");
  } finally {
    restore();
  }
});

Deno.test("github_list_project_items - filter_type DraftIssue: only draft items shown", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const items = [makeDraftItem("PVTI_1", "Draft Task"), makeIssueItem("PVTI_2")];
  const restore = mockFetch(wrapUserItems(items, 2));
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_list_project_items",
      arguments: {
        owner: "hoonsubin",
        owner_type: "user",
        project_number: 1,
        first: 20,
        filter_type: "DraftIssue",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "showing 1");
    assertStringIncludes(text, "Draft Task");
  } finally {
    restore();
  }
});

Deno.test("github_list_project_items - status_option_id filter: only matching item shown", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const itemWithStatus: ProjectV2Item = {
    ...makeDraftItem("PVTI_1", "In Progress Task"),
    fieldValues: {
      nodes: [{
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        field: { id: "F_STATUS", name: "Status" },
        name: "In Progress",
        optionId: "OPT_IN_PROGRESS",
      }],
    },
  };
  const itemNoStatus = makeDraftItem("PVTI_2", "Backlog Task");
  const restore = mockFetch(wrapUserItems([itemWithStatus, itemNoStatus], 2));
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_list_project_items",
      arguments: {
        owner: "hoonsubin",
        owner_type: "user",
        project_number: 1,
        first: 20,
        status_option_id: "OPT_IN_PROGRESS",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "showing 1");
    assertStringIncludes(text, "In Progress Task");
  } finally {
    restore();
  }
});

Deno.test("github_list_project_items - iteration_id filter (fallback path): matches via fv.iterationId", async () => {
  // Config load fails (no --allow-read), so the fallback filter matches any
  // field value node whose iterationId === the requested ID.
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const itemInSprint: ProjectV2Item = {
    ...makeDraftItem("PVTI_1", "Sprint Task"),
    fieldValues: {
      nodes: [{
        __typename: "ProjectV2ItemFieldIterationValue",
        field: { id: "F_SPRINT", name: "Sprint" },
        title: "Sprint 1",
        iterationId: "ITER_X",
        startDate: "2026-04-14",
        duration: 14,
      }],
    },
  };
  const itemNoSprint = makeDraftItem("PVTI_2", "Backlog Task");
  const restore = mockFetch(wrapUserItems([itemInSprint, itemNoSprint], 2));
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_list_project_items",
      arguments: {
        owner: "hoonsubin",
        owner_type: "user",
        project_number: 1,
        first: 20,
        iteration_id: "ITER_X",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "showing 1");
    assertStringIncludes(text, "Sprint Task");
    assertStringIncludes(text, "Sprint 1 (starts 2026-04-14, 14d) [id: ITER_X]");
  } finally {
    restore();
  }
});

Deno.test("github_list_project_items - pagination cursor shown when hasNextPage", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch(
    wrapUserItems([makeDraftItem()], 50, true, "CURSOR_99"),
  );
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_list_project_items",
      arguments: {
        owner: "hoonsubin",
        owner_type: "user",
        project_number: 1,
        first: 1,
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "CURSOR_99");
  } finally {
    restore();
  }
});

Deno.test("github_list_project_items - empty project: shows no items message", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch(wrapUserItems([], 0));
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_list_project_items",
      arguments: {
        owner: "hoonsubin",
        owner_type: "user",
        project_number: 1,
        first: 20,
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "No items found");
  } finally {
    restore();
  }
});

Deno.test(
  "github_list_project_items - filter_type mismatch: zero results include type breakdown hint",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    // Board has 2 DRAFT_ISSUE items, but filter asks for Issue — should explain the mismatch.
    const restore = mockFetch(wrapUserItems([makeDraftItem("PVTI_1", "A"), makeDraftItem("PVTI_2", "B")], 2));
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_list_project_items",
        arguments: {
          owner: "hoonsubin",
          owner_type: "user",
          project_number: 1,
          first: 20,
          filter_type: "Issue",
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "No Issue items found");
      assertStringIncludes(text, "DraftIssue");
      assertStringIncludes(text, "Re-run without filter_type");
    } finally {
      restore();
    }
  },
);

// ---------------------------------------------------------------------------
// github_add_item_to_project
// ---------------------------------------------------------------------------

Deno.test("github_add_item_to_project - success: returns item node ID", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    addProjectV2ItemById: { item: { id: "PVTI_NEW" } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_add_item_to_project",
      arguments: {
        project_id: "PVT_1",
        content_id: "I_abc123",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "PVTI_NEW");
    assertStringIncludes(text, "✅");
  } finally {
    restore();
  }
});

Deno.test("github_add_item_to_project - API error: returns formatted error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({}, 500);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_add_item_to_project",
      arguments: {
        project_id: "PVT_1",
        content_id: "I_abc123",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "Error:");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// github_add_draft_issue
// ---------------------------------------------------------------------------

Deno.test("github_add_draft_issue - success without iteration_id: returns item ID and title", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    addProjectV2DraftIssue: { projectItem: { id: "PVTI_DRAFT" } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_add_draft_issue",
      arguments: {
        project_id: "PVT_1",
        title: "My Draft Task",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "PVTI_DRAFT");
    assertStringIncludes(text, "My Draft Task");
  } finally {
    restore();
  }
});

Deno.test("github_add_draft_issue - with body and assignees: returns item ID and title", async () => {
  // iteration_id was removed from AddDraftIssueSchema in Phase 1 refactor.
  // Sprint assignment is now done via a separate github_update_item_field call.
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    addProjectV2DraftIssue: { projectItem: { id: "PVTI_DRAFT" } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_add_draft_issue",
      arguments: {
        project_id: "PVT_1",
        title: "Sprint Task",
        body: "Detailed description",
        assignee_ids: ["U_kgDO123"],
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "PVTI_DRAFT");
    assertStringIncludes(text, "Sprint Task");
    assertStringIncludes(text, "✅");
  } finally {
    restore();
  }
});

Deno.test("github_add_draft_issue - API error: returns formatted error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({}, 500);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_add_draft_issue",
      arguments: {
        project_id: "PVT_1",
        title: "My Draft",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "Error:");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// github_update_item_field
// ---------------------------------------------------------------------------

Deno.test("github_update_item_field - text type: updates successfully", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_update_item_field",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
        field_id: "F_1",
        value: { type: "text", value: "some text" },
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "PVTI_1");
  } finally {
    restore();
  }
});

Deno.test("github_update_item_field - number type: updates successfully", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_update_item_field",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
        field_id: "F_SP",
        value: { type: "number", number_value: 5 },
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "✅");
  } finally {
    restore();
  }
});

Deno.test("github_update_item_field - date type valid: updates successfully", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_update_item_field",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
        field_id: "F_DATE",
        value: { type: "date", value: "2025-06-01" },
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "✅");
  } finally {
    restore();
  }
});

Deno.test("github_update_item_field - single_select type: updates successfully", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_update_item_field",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
        field_id: "F_STATUS",
        value: { type: "single_select", option_id: "OPT_1" },
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "✅");
  } finally {
    restore();
  }
});

Deno.test("github_update_item_field - iteration type: updates successfully", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_update_item_field",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
        field_id: "F_SPRINT",
        value: { type: "iteration", iteration_id: "ITER_1" },
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "✅");
  } finally {
    restore();
  }
});

Deno.test("github_update_item_field - clear type: calls clear mutation and returns confirmation", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    clearProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_update_item_field",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
        field_id: "F_1",
        value: { type: "clear" },
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "cleared");
    assertStringIncludes(text, "PVTI_1");
  } finally {
    restore();
  }
});

Deno.test("github_update_item_field - text missing value: returns validation error (no fetch needed)", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  // resolveFieldValue returns an error before any fetch is made
  const restore = mockFetch({});
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_update_item_field",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
        field_id: "F_1",
        value: { type: "text" },
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "Error:");
    assertStringIncludes(text, "value");
  } finally {
    restore();
  }
});

Deno.test("github_update_item_field - date invalid format: returns YYYY-MM-DD error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({});
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_update_item_field",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
        field_id: "F_DATE",
        value: { type: "date", value: "not-a-date" },
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "YYYY-MM-DD");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// github_archive_project_item
// ---------------------------------------------------------------------------

Deno.test("github_archive_project_item - archive: returns 'archived' confirmation", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    archiveProjectV2Item: { item: { id: "PVTI_1", isArchived: true } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_archive_project_item",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
        archived: true,
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "PVTI_1");
    assertStringIncludes(text, "archived");
  } finally {
    restore();
  }
});

Deno.test("github_archive_project_item - unarchive: returns 'unarchived' confirmation", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    archiveProjectV2Item: { item: { id: "PVTI_1", isArchived: false } },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_archive_project_item",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
        archived: false,
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "unarchived");
  } finally {
    restore();
  }
});

Deno.test("github_archive_project_item - API error: returns formatted error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({}, 500);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_archive_project_item",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "Error:");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// github_delete_project_item
// ---------------------------------------------------------------------------

Deno.test("github_delete_project_item - success: returns deleted item ID", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    deleteProjectV2Item: { deletedItemId: "PVTI_1" },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_delete_project_item",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "✅");
    assertStringIncludes(text, "PVTI_1");
    assertStringIncludes(text, "permanently removed");
  } finally {
    restore();
  }
});

Deno.test("github_delete_project_item - API error: returns formatted error", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({}, 500);
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_delete_project_item",
      arguments: {
        project_id: "PVT_1",
        item_id: "PVTI_1",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "Error:");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// github_get_issue_node_id
// ---------------------------------------------------------------------------

Deno.test("github_get_issue_node_id - issue found: returns node ID and details", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    repository: {
      issue: {
        id: "I_abc123",
        number: 42,
        title: "Bug fix",
        url: "https://github.com/owner/repo/issues/42",
        state: "OPEN",
      },
    },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_issue_node_id",
      arguments: {
        owner: "owner",
        repo: "repo",
        issue_number: 42,
        type: "issue",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "I_abc123");
    assertStringIncludes(text, "Bug fix");
    assertStringIncludes(text, "#42");
    assertStringIncludes(text, "OPEN");
  } finally {
    restore();
  }
});

Deno.test("github_get_issue_node_id - pull_request found: returns PR node ID", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    repository: {
      pullRequest: {
        id: "PR_xyz789",
        number: 7,
        title: "Feature branch",
        url: "https://github.com/owner/repo/pull/7",
        state: "MERGED",
      },
    },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_issue_node_id",
      arguments: {
        owner: "owner",
        repo: "repo",
        issue_number: 7,
        type: "pull_request",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "PR_xyz789");
    assertStringIncludes(text, "MERGED");
  } finally {
    restore();
  }
});

Deno.test("github_get_issue_node_id - issue not found: returns 'not found' message", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({ repository: { issue: null } });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_issue_node_id",
      arguments: {
        owner: "owner",
        repo: "repo",
        issue_number: 999,
        type: "issue",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "not found");
    assertStringIncludes(text, "#999");
  } finally {
    restore();
  }
});

Deno.test("github_get_issue_node_id - PR not found: returns 'PR not found' message", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({ repository: { pullRequest: null } });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_issue_node_id",
      arguments: {
        owner: "owner",
        repo: "repo",
        issue_number: 7,
        type: "pull_request",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "not found");
    assertStringIncludes(text, "PR");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// github_get_user_node_id
// ---------------------------------------------------------------------------

Deno.test("github_get_user_node_id - success with name: returns node ID, login, and name", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    user: {
      id: "U_kgDO123",
      login: "hoonsubin",
      name: "Hoon Kim",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
    },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_user_node_id",
      arguments: {
        login: "hoonsubin",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "U_kgDO123");
    assertStringIncludes(text, "hoonsubin");
    assertStringIncludes(text, "Hoon Kim");
  } finally {
    restore();
  }
});

Deno.test("github_get_user_node_id - success without name: omits name line", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    user: {
      id: "U_anon",
      login: "anon-user",
      name: null,
      avatarUrl: "https://avatars.githubusercontent.com/u/2",
    },
  });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_user_node_id",
      arguments: {
        login: "anon-user",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "U_anon");
    assertStringIncludes(text, "anon-user");
    // null name should not appear literally in output
    const hasNullString = text.includes("null");
    if (hasNullString) throw new Error(`Output should not contain 'null': ${text}`);
  } finally {
    restore();
  }
});

Deno.test("github_get_user_node_id - user not found: returns 'not found' message", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({ user: null });
  try {
    const client = await makeTestClient();
    const result = await client.callTool({
      name: "github_get_user_node_id",
      arguments: {
        login: "ghost",
      },
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "not found");
    assertStringIncludes(text, "ghost");
  } finally {
    restore();
  }
});
