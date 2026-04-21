#!/usr/bin/env -S deno run --allow-env --allow-net
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { type Response, type Request } from "express";
import { registerProjectTools } from "./tools/projects.ts";
import { registerItemTools } from "./tools/items.ts";
import type { Socket } from "node:net";

// ── Server factory ───────────────────────────────────────────────────────────

const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: "github-projects-mcp-server",
    version: "1.0.0",
  });

  registerProjectTools(server);
  registerItemTools(server);

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
  let isShuttingDown = false;

  const app = express();
  app.use(express.json());

  // Middleware: reject new requests while shutting down
  app.use((_req: Request, res: Response, next) => {
    if (isShuttingDown) {
      res.setHeader("Connection", "close");
      res.status(503).json({ error: "Server is shutting down" });
      return; // ← fix: was missing, caused fall-through to next()
    }
    next();
  });

  app.get("/health", (_req: Request, res: Response) => {
    console.log("Received health check");
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

  const port = parseInt(Deno.env.get("PORT") ?? "3000", 10);
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

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[shutdown] ${signal} received — draining connections...`);
    // 1. Close all active MCP sessions cleanly
    await Promise.allSettled(Object.values(transports).map((t) => t.close()));
    console.log("[shutdown] MCP sessions closed");

    // 2. Stop accepting new HTTP connections; wait for in-flight requests
    httpServer.close((err) => {
      if (err) {
        console.error("[shutdown] server.close error:", err);
        Deno.exit(1);
      }
      console.log("[shutdown] HTTP server closed — bye!");
      Deno.exit(0);
    });

    // 3. Destroy idle keep-alive sockets (they'd block server.close indefinitely)
    for (const socket of sockets) {
      socket.destroy();
    }

    // 4. Hard-kill safety net — force exit if something hangs after 10s
    setTimeout(() => {
      console.error("[shutdown] timeout — forcing exit");
      Deno.exit(1);
    }, 10_000);
  };

  Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM")); // Docker / k8s
  Deno.addSignalListener("SIGINT", () => shutdown("SIGINT")); // Ctrl+C
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
