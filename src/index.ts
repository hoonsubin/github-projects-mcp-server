import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { type Response, type Request } from "express";
import { registerProjectTools } from "./tools/projects.ts";
import { registerItemTools } from "./tools/items.ts";
import { registerSprintTools } from "./tools/sprints.ts";
import { registerScrumResources } from "./resources/index.ts";
import { registerSprintPrompts } from "./prompts/index.ts";
import type { Socket } from "node:net";

// ── Server factory ───────────────────────────────────────────────────────────

const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: "github-projects-mcp-server",
    version: "1.0.0",
  });

  registerProjectTools(server);
  registerItemTools(server);
  registerSprintTools(server);
  registerScrumResources(server);
  registerSprintPrompts(server);

  return server;
};

// ── Stdio transport (default — used by Claude Desktop, Claude Code, etc.) ────

const runStdio = async (): Promise<void> => {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("github-projects-mcp-server running on stdio");
};

// ── Streamable HTTP transport (for remote/multi-client scenarios) ─────────────

const runHttp = () => {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    console.log("Received health check", _req);
    res.status(200).json({
      jsonrpc: "2.0",
      server: "github-projects-mcp-server",
    });
    return;
  });

  // Session store
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // POST /mcp — handle all client-to-server JSON-RPC messages
  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;
    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id: string) => {
          transports[id] = transport;
        },
        // Enable when running locally to prevent DNS-rebinding attacks:
        // enableDnsRebindingProtection: true,
        // allowedHosts: ["127.0.0.1"],
      });

      transport.onclose = () => {
        delete transports[transport.sessionId];
        console.log(`Session closed: ${transport.sessionId}`);
      };

      const server = createMcpServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp - server-to-client SSE notifications
  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  // DELETE /mcp - session termination
  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    await transports[sessionId].handleRequest(req, res);
  });

  const port = parseInt(Deno.env.get("PORT") || "3000", 10);
  const httpServer = app.listen(port, () => {
    console.log(`MCP server listening → http://0.0.0.0:${port}/mcp`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────

  // Track all open sockets so idle keep-alive connections can be destroyed
  const sockets = new Set<Socket>();

  httpServer.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
};

// ── Entry point ───────────────────────────────────────────────────────────────

const transportType = Deno.env.get("MCP_TRANSPORT") ?? "stdio";

if (transportType === "http") {
  runHttp();
} else {
  runStdio().catch((err: unknown) => {
    console.error(`Fatal: ${String(err)}`);
    Deno.exit(1);
  });
}
