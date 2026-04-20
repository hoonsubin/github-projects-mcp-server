#!/usr/bin/env -S deno run --allow-env --allow-net
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Buffer } from "node:buffer";
import { registerProjectTools } from "./tools/projects.ts";
import { registerItemTools } from "./tools/items.ts";

// ── Server factory ───────────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "github-projects-mcp-server",
    version: "1.0.0",
  });

  registerProjectTools(server);
  registerItemTools(server);

  return server;
}

// ── Stdio transport (default — used by Claude Desktop, Claude Code, etc.) ────

async function runStdio(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("github-projects-mcp-server running on stdio");
}

// ── Streamable HTTP transport (for remote/multi-client scenarios) ─────────────
// node:http is kept here because StreamableHTTPServerTransport requires IncomingMessage/ServerResponse.

async function runHttp() {
  const port = parseInt(Deno.env.get("PORT") ?? "3000", 10);

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            server: "github-projects-mcp-server",
          }),
        );
        return;
      }

      if (req.method !== "POST" || req.url !== "/mcp") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        void transport.close();
      });

      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    },
  );

  httpServer.listen(port, () => {
    console.error(
      `github-projects-mcp-server listening on http://0.0.0.0:${port}/mcp`,
    );
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

const transport = Deno.env.get("MCP_TRANSPORT") ?? "stdio";

if (transport === "http") {
  runHttp().catch((err: unknown) => {
    console.error(`Fatal: ${String(err)}`);
    Deno.exit(1);
  });
} else {
  runStdio().catch((err: unknown) => {
    console.error(`Fatal: ${String(err)}`);
    Deno.exit(1);
  });
}
