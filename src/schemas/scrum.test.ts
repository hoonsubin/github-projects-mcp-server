// =============================================================================
// src/schemas/scrum.test.ts - Input schema contract checks for scrum_* tools
// =============================================================================

import { assertEquals } from "@std/assert";
import { Client, type Tool } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { normalizeObjectSchema, safeParse } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { UpdateStorySchema } from "./scrum.ts";
import {
  committedFakeBackendPromise,
  committedScrumConfigPromise,
} from "../test/support/scrum-test-utils.ts";
import { registerScrumWriteTools } from "../tools/scrum-write.ts";

Deno.test("UpdateStorySchema blocked_by - tools/list exposes type array", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;
  const server = new McpServer({ name: "schema-test", version: "0" });
  registerScrumWriteTools(server, backend, boot.scrumConfig);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "schema-test-client", version: "0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

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

Deno.test("UpdateStorySchema blocked_by - accepts array, null, and JSON string", () => {
  const shape = normalizeObjectSchema(UpdateStorySchema.shape);
  assertEquals(shape !== undefined, true);

  const arrayInput = {
    ref: { id: "PVTI_a" },
    blocked_by: [{ id: "PVTI_b" }],
  };
  assertEquals(safeParse(shape!, arrayInput).success, true);

  const nullInput = {
    ref: { id: "PVTI_a" },
    blocked_by: null,
  };
  const nullParsed = safeParse(shape!, nullInput);
  assertEquals(nullParsed.success, true);
  if (nullParsed.success) {
    assertEquals(nullParsed.data.blocked_by, []);
  }

  const stringInput = {
    ref: { id: "PVTI_a" },
    blocked_by: JSON.stringify([{ id: "PVTI_b" }]),
  };
  const stringParsed = safeParse(shape!, stringInput);
  assertEquals(stringParsed.success, true);
  if (stringParsed.success) {
    assertEquals(stringParsed.data.blocked_by, [{ id: "PVTI_b" }]);
  }
});

Deno.test("UpdateStorySchema blocked_by - z.toJSONSchema has top-level type array", () => {
  const json = z.toJSONSchema(UpdateStorySchema);
  const blockedBy = json.properties?.blocked_by as { type?: string } | undefined;
  assertEquals(blockedBy?.type, "array");
});
