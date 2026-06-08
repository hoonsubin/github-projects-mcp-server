// =============================================================================
// MCP transport integration - exercises CallTool + SDK output validation
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import { Client, type Tool } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  committedFakeBackendPromise,
  committedScrumConfigPromise,
} from "../support/scrum-test-utils.ts";
import { registerScrumReadTools } from "../../tools/scrum-read.ts";
import { registerScrumWriteTools } from "../../tools/scrum-write.ts";

const connectMcpPair = async (
  server: McpServer,
): Promise<Client> => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "contract-test-client", version: "0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

Deno.test("MCP CallTool: scrum_orient passes server output validation", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const server = new McpServer({ name: "scrum-test-server", version: "0" });
  registerScrumReadTools(server, backend, boot.scrumConfig);

  const client = await connectMcpPair(server);
  try {
    const result = await client.callTool({ name: "scrum_orient", arguments: {} });
    assertEquals(result.isError, undefined);
    assertExists(result.structuredContent);
    assertEquals(typeof result.structuredContent!.platform_state, "object");
    assertEquals(result.content.length > 0, true);
  } finally {
    await client.close();
  }
});

Deno.test("MCP listTools: scrum_update_story blocked_by exposes type array", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const server = new McpServer({ name: "scrum-test-server", version: "0" });
  registerScrumWriteTools(server, backend, boot.scrumConfig);

  const client = await connectMcpPair(server);
  try {
    const { tools } = await client.listTools();
    const tool = tools.find((entry: Tool) => entry.name === "scrum_update_story");
    const blockedBy = tool?.inputSchema?.properties?.blocked_by as
      | { type?: string; items?: unknown }
      | undefined;
    assertEquals(blockedBy?.type, "array");
    assertEquals(typeof blockedBy?.items, "object");
  } finally {
    await client.close();
  }
});

Deno.test("MCP CallTool: scrum_update_story accepts stringified blocked_by", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const server = new McpServer({ name: "scrum-test-server", version: "0" });
  registerScrumWriteTools(server, backend, boot.scrumConfig);

  const client = await connectMcpPair(server);
  try {
    const result = await client.callTool({
      name: "scrum_update_story",
      arguments: {
        ref: { id: "PVTI_fake_1" },
        blocked_by: JSON.stringify([{ id: "PVTI_fake_2" }]),
      },
    });
    assertEquals(result.isError, undefined);
    assertExists(result.structuredContent);
  } finally {
    await client.close();
  }
});

Deno.test("MCP CallTool: scrum_find_items passes server output validation", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const server = new McpServer({ name: "scrum-test-server", version: "0" });
  registerScrumReadTools(server, backend, boot.scrumConfig);

  const client = await connectMcpPair(server);
  try {
    const result = await client.callTool({
      name: "scrum_find_items",
      arguments: { scope: "all", include_dependencies: false, limit: 5 },
    });
    assertEquals(result.isError, undefined);
    assertExists(result.structuredContent);
    assertEquals(Array.isArray(result.structuredContent!.items), true);
  } finally {
    await client.close();
  }
});

Deno.test("MCP CallTool: scrum_get_sprint_data passes server output validation", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const server = new McpServer({ name: "scrum-test-server", version: "0" });
  registerScrumReadTools(server, backend, boot.scrumConfig);

  const client = await connectMcpPair(server);
  try {
    const result = await client.callTool({
      name: "scrum_get_sprint_data",
      arguments: { sprint_ref: "current" },
    });
    assertEquals(result.isError, undefined);
    assertExists(result.structuredContent);
    assertEquals(typeof result.structuredContent!.sprint, "object");
    assertEquals(Array.isArray(result.structuredContent!.items), true);
    assertEquals(result.content.length > 0, true);
  } finally {
    await client.close();
  }
});
