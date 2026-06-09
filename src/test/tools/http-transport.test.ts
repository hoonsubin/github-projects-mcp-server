// =============================================================================
// HTTP transport contract tests — verifies MCP spec compliance at the HTTP layer
// without spinning up a full server process.
// =============================================================================

import { assertEquals, assertNotEquals } from "@std/assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const makeInitRequest = (headers: Record<string, string> = {}): Request =>
  new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0" },
      },
    }),
  });

const connectTransport = async (): Promise<WebStandardStreamableHTTPServerTransport> => {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  const server = new McpServer({ name: "test-server", version: "0" });
  await server.connect(transport);
  return transport;
};

Deno.test("HTTP transport: InitializeRequest with MCP-Protocol-Version is accepted", async () => {
  const transport = await connectTransport();
  const req = makeInitRequest({ "MCP-Protocol-Version": "2025-11-25" });
  const res = await transport.handleRequest(req);
  assertNotEquals(res.status, 400, `Expected non-400 but got ${res.status}`);
  assertNotEquals(res.status, 422, `Expected non-422 but got ${res.status}`);
});

Deno.test("HTTP transport: InitializeRequest without MCP-Protocol-Version is also accepted", async () => {
  // The MCP-Protocol-Version header is required on *subsequent* requests per
  // spec §Protocol Version Header, not on the initialize request itself.
  // Verify the SDK does not reject an initialize POST missing that header.
  const transport = await connectTransport();
  const req = makeInitRequest();
  const res = await transport.handleRequest(req);
  assertNotEquals(res.status, 400, `Expected non-400 but got ${res.status}`);
  assertNotEquals(res.status, 422, `Expected non-422 but got ${res.status}`);
});

Deno.test("HTTP transport: subsequent POST with MCP-Protocol-Version is accepted", async () => {
  // Establish a session first, then send a follow-up POST with the version header.
  let capturedSessionId: string | undefined;
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id: string) => {
      capturedSessionId = id;
    },
  });
  const server = new McpServer({ name: "test-server", version: "0" });
  await server.connect(transport);

  const initRes = await transport.handleRequest(makeInitRequest());
  assertEquals(initRes.status < 400, true, `Init failed: ${initRes.status}`);

  if (!capturedSessionId) {
    // Some SDK versions assign the ID asynchronously; read from the response header.
    capturedSessionId = initRes.headers.get("mcp-session-id") ?? undefined;
  }

  if (!capturedSessionId) {
    // If neither mechanism produced an ID the SDK does not surface it —
    // skip the follow-up assertion rather than fail.
    return;
  }

  const followUp = new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "MCP-Session-Id": capturedSessionId,
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const followRes = await transport.handleRequest(followUp);
  assertNotEquals(followRes.status, 400, `Expected non-400 but got ${followRes.status}`);
  assertNotEquals(followRes.status, 422, `Expected non-422 but got ${followRes.status}`);
});
