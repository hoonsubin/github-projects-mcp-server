import { assertStringIncludes } from "@std/assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerProjectTools } from "./projects.ts";
import type { ProjectV2 } from "../types.ts";

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
  registerProjectTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
};

Deno.test(
  "github_list_projects - user: returns formatted project list",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      user: {
        projectsV2: {
          totalCount: 1,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "PVT_1",
              title: "My Project",
              number: 1,
              url: "https://github.com/users/hoonsubin/projects/4",
              closed: false,
              public: true,
              shortDescription: null,
              createdAt: "2025-01-01T00:00:00Z",
              updatedAt: "2025-01-01T00:00:00Z",
              readme: null,
              owner: { __typename: "User", login: "hoonsubin" },
              items: { totalCount: 3 },
              fields: { nodes: [] },
            },
          ],
        },
      },
    });

    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_list_projects",
        arguments: {
          owner: "hoonsubin",
          owner_type: "user",
          first: 20,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "My Project");
      assertStringIncludes(text, "Projects for user: hoonsubin");
    } finally {
      restore();
    }
  },
);

Deno.test(
  "github_list_projects - user not found: returns error message",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({ user: null });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_list_projects",
        arguments: {
          owner: "ghost",
          owner_type: "user",
          first: 20,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "User 'ghost' not found");
    } finally {
      restore();
    }
  },
);

// ---------------------------------------------------------------------------
// Helpers for expanded tests
// ---------------------------------------------------------------------------

const makeProject = (overrides: Partial<ProjectV2> = {}): ProjectV2 =>
  ({
    id: "PVT_1",
    number: 1,
    title: "My Project",
    shortDescription: null,
    url: "https://github.com/users/hoonsubin/projects/1",
    public: true,
    closed: false,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    readme: null,
    owner: { __typename: "User", login: "hoonsubin" },
    items: { totalCount: 3 },
    fields: { nodes: [] },
    ...overrides,
  }) as ProjectV2;

// ---------------------------------------------------------------------------
// github_list_projects — additional cases
// ---------------------------------------------------------------------------

Deno.test(
  "github_list_projects - org: returns formatted project list with org header",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      organization: {
        projectsV2: {
          totalCount: 1,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            makeProject({
              title: "Org Project",
              owner: { __typename: "Organization", login: "myorg" },
            }),
          ],
        },
      },
    });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_list_projects",
        arguments: {
          owner: "myorg",
          owner_type: "org",
          first: 20,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "Projects for org: myorg");
      assertStringIncludes(text, "Org Project");
    } finally {
      restore();
    }
  },
);

Deno.test(
  "github_list_projects - org not found: returns organization error message",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({ organization: null });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_list_projects",
        arguments: {
          owner: "nonexistent-org",
          owner_type: "org",
          first: 20,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "not found");
      assertStringIncludes(text, "nonexistent-org");
    } finally {
      restore();
    }
  },
);

Deno.test(
  "github_list_projects - user: pagination cursor shown when hasNextPage",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      user: {
        projectsV2: {
          totalCount: 10,
          pageInfo: { hasNextPage: true, endCursor: "cursor_abc" },
          nodes: [makeProject()],
        },
      },
    });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_list_projects",
        arguments: {
          owner: "hoonsubin",
          owner_type: "user",
          first: 1,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "cursor_abc");
    } finally {
      restore();
    }
  },
);

// ---------------------------------------------------------------------------
// github_get_project
// ---------------------------------------------------------------------------

Deno.test(
  "github_get_project - user: success returns project details with node ID",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      user: { projectV2: makeProject() },
    });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_get_project",
        arguments: {
          owner: "hoonsubin",
          owner_type: "user",
          project_number: 1,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "My Project");
      assertStringIncludes(text, "PVT_1");
      assertStringIncludes(text, "Node ID");
    } finally {
      restore();
    }
  },
);

Deno.test(
  "github_get_project - user with readme: includes README section",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      user: { projectV2: makeProject({ readme: "## My README\nsome content" }) },
    });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_get_project",
        arguments: {
          owner: "hoonsubin",
          owner_type: "user",
          project_number: 1,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "README");
      assertStringIncludes(text, "some content");
    } finally {
      restore();
    }
  },
);

Deno.test(
  "github_get_project - user: project not found returns specific message",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({ user: { projectV2: null } });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_get_project",
        arguments: {
          owner: "hoonsubin",
          owner_type: "user",
          project_number: 99,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "not found");
      assertStringIncludes(text, "99");
    } finally {
      restore();
    }
  },
);

Deno.test(
  "github_get_project - org: success resolves via organization key",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      organization: {
        projectV2: makeProject({
          title: "Org Board",
          owner: { __typename: "Organization", login: "myorg" },
        }),
      },
    });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_get_project",
        arguments: {
          owner: "myorg",
          owner_type: "org",
          project_number: 1,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "Org Board");
    } finally {
      restore();
    }
  },
);

// ---------------------------------------------------------------------------
// github_get_project_fields
// ---------------------------------------------------------------------------

Deno.test(
  "github_get_project_fields - returns all fields without filter",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      user: {
        projectV2: {
          title: "My Project",
          number: 1,
          fields: {
            nodes: [
              { id: "F_TEXT", name: "Notes", dataType: "TEXT" },
              {
                id: "F_STATUS",
                name: "Status",
                dataType: "SINGLE_SELECT",
                options: [{ id: "OPT_1", name: "Open", color: "GREEN", description: "" }],
              },
            ],
          },
        },
      },
    });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_get_project_fields",
        arguments: {
          owner: "hoonsubin",
          owner_type: "user",
          project_number: 1,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "Notes");
      assertStringIncludes(text, "F_TEXT");
      assertStringIncludes(text, "Status");
      assertStringIncludes(text, "OPT_1");
    } finally {
      restore();
    }
  },
);

Deno.test(
  "github_get_project_fields - filtered by TEXT: only text field shown",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      user: {
        projectV2: {
          title: "My Project",
          number: 1,
          fields: {
            nodes: [
              { id: "F_TEXT", name: "Notes", dataType: "TEXT" },
              { id: "F_NUM", name: "Story Points", dataType: "NUMBER" },
            ],
          },
        },
      },
    });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_get_project_fields",
        arguments: {
          owner: "hoonsubin",
          owner_type: "user",
          project_number: 1,
          field_type: "TEXT",
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "Notes");
      assertStringIncludes(text, "filtered: TEXT");
    } finally {
      restore();
    }
  },
);

Deno.test(
  "github_get_project_fields - no fields match filter: returns no fields message",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      user: {
        projectV2: {
          title: "My Project",
          number: 1,
          fields: {
            nodes: [
              { id: "F_TEXT", name: "Notes", dataType: "TEXT" },
            ],
          },
        },
      },
    });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_get_project_fields",
        arguments: {
          owner: "hoonsubin",
          owner_type: "user",
          project_number: 1,
          field_type: "ITERATION",
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "No fields");
      assertStringIncludes(text, "ITERATION");
    } finally {
      restore();
    }
  },
);

Deno.test(
  "github_get_project_fields - project not found: returns error message",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({ user: { projectV2: null } });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_get_project_fields",
        arguments: {
          owner: "hoonsubin",
          owner_type: "user",
          project_number: 99,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "not found");
    } finally {
      restore();
    }
  },
);

// ---------------------------------------------------------------------------
// github_update_project
// ---------------------------------------------------------------------------

Deno.test(
  "github_update_project - success: returns confirmation with updated title",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      updateProjectV2: {
        projectV2: {
          id: "PVT_1",
          title: "New Title",
          shortDescription: null,
          public: true,
          closed: false,
        },
      },
    });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_update_project",
        arguments: {
          project_id: "PVT_1",
          title: "New Title",
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "✅");
      assertStringIncludes(text, "New Title");
    } finally {
      restore();
    }
  },
);

Deno.test(
  "github_update_project - with shortDescription: shows description in output",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      updateProjectV2: {
        projectV2: {
          id: "PVT_1",
          title: "My Project",
          shortDescription: "sprint tracker",
          public: true,
          closed: false,
        },
      },
    });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_update_project",
        arguments: {
          project_id: "PVT_1",
          short_description: "sprint tracker",
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "sprint tracker");
    } finally {
      restore();
    }
  },
);

Deno.test(
  "github_update_project - closed project: status shows Closed",
  async () => {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const restore = mockFetch({
      updateProjectV2: {
        projectV2: {
          id: "PVT_1",
          title: "My Project",
          shortDescription: null,
          public: false,
          closed: true,
        },
      },
    });
    try {
      const client = await makeTestClient();
      const result = await client.callTool({
        name: "github_update_project",
        arguments: {
          project_id: "PVT_1",
          closed: true,
        },
      });
      const text = (result.content[0] as { text: string }).text;
      assertStringIncludes(text, "Closed");
    } finally {
      restore();
    }
  },
);
