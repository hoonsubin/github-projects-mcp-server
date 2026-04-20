#!/usr/bin/env -S deno run --allow-env --allow-net
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerProjectTools } from "./tools/projects.ts";
import { registerItemTools } from "./tools/items.ts";

// ── Server factory ───────────────────────────────────────────────────────────

const createMcpServer= (): McpServer => {
  const server = new McpServer({
    name: "github-projects-mcp-server",
    version: "1.0.0",
  });

  registerProjectTools(server);
  registerItemTools(server);

  return server;
}

// ── Stdio transport (default — used by Claude Desktop, Claude Code, etc.) ────

const runStdio = async (): Promise<void> => {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("github-projects-mcp-server running on stdio");
}

// ── Streamable HTTP transport (for remote/multi-client scenarios) ─────────────

const runHttp = async (): Promise<void> => {
  const port = parseInt(Deno.env.get("PORT") ?? "3000", 10);

  const server = Deno.serve(
    {
      port,
      onListen({ hostname, port: p }) {
        console.error(`github-projects-mcp-server listening on http://${hostname}:${p}/mcp`);
      },
    },
    async (req: Request): Promise<Response> => {
      const { pathname } = new URL(req.url);

      if (req.method === "GET" && pathname === "/health") {
        return Response.json({ status: "ok", server: "github-projects-mcp-server" });
      }

      if (pathname !== "/mcp") {
        return new Response("Not found", { status: 404 });
      }

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      return transport.handleRequest(req);
    },
  );

  await server.finished;
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
