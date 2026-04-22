import { assertEquals, assertStringIncludes } from "@std/assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerProjectTools } from "./projects.ts";

function mockFetch(data: unknown, status = 200): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ data }), {
        status,
        headers: { "content-type": "application/json" },
      })
    );
  return () => { globalThis.fetch = original; };
}

async function makeTestClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerProjectTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

Deno.test("github_list_projects - user: returns formatted project list", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({
    user: {
      projectsV2: {
        totalCount: 1,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{
          id: "PVT_1", title: "My Project", number: 1,
          url: "https://github.com/users/hoonsubin/projects/4",
          closed: false, public: true, shortDescription: null,
          updatedAt: "2025-01-01T00:00:00Z",
          items: { totalCount: 3 },
          fields: { nodes: [] },
        }],
      },
    },
  });

  try {
    const client = await makeTestClient();
    const result = await client.callTool("github_list_projects", {
      owner: "hoonsubin",
      owner_type: "user",
      first: 20,
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "My Project");
    assertStringIncludes(text, "Projects for user: hoonsubin");
  } finally {
    restore();
  }
});

Deno.test("github_list_projects - user not found: returns error message", async () => {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const restore = mockFetch({ user: null });
  try {
    const client = await makeTestClient();
    const result = await client.callTool("github_list_projects", {
      owner: "ghost", owner_type: "user", first: 20,
    });
    const text = (result.content[0] as { text: string }).text;
    assertStringIncludes(text, "User 'ghost' not found");
  } finally {
    restore();
  }
});
