import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import express, { type Request, type Response } from "express";
import { registerProjectTools } from "./tools/projects.ts";
import { registerItemTools } from "./tools/items.ts";
import { registerSprintTools } from "./tools/sprints.ts";
import { registerScrumResources } from "./resources/index.ts";
import { registerSprintPrompts } from "./prompts/index.ts";
import { log } from "./services/logger.ts";
import type { Socket } from "node:net";

// ── Debug: tool-call interceptor ─────────────────────────────────────────────
//
// Patches server.registerTool before any tools are registered so every call
// gets before/after/error logging with timing. Only active when DEBUG=1.
//
// The cast through `unknown` is intentional: registerTool has many typed
// overloads but at runtime they all resolve to (name, config, handler).

const patchToolLogging = (server: McpServer): void => {
  // deno-lint-ignore no-explicit-any
  const s = server as unknown as Record<string, any>;
  const original = s["registerTool"].bind(server) as (
    name: string,
    config: unknown,
    handler: (params: unknown, extra: unknown) => Promise<unknown>,
  ) => unknown;

  s["registerTool"] = (
    name: string,
    config: unknown,
    handler: (params: unknown, extra: unknown) => Promise<unknown>,
  ): unknown => {
    return original(name, config, async (params: unknown, extra: unknown) => {
      log.debug(`→ tool:${name}`, params);
      const t0 = performance.now();
      try {
        const result = await handler(params, extra);
        log.debug(
          `← tool:${name} OK (${Math.round(performance.now() - t0)}ms)`,
        );
        return result;
      } catch (err: unknown) {
        log.error(
          `✗ tool:${name} threw (${Math.round(performance.now() - t0)}ms)`,
          err,
        );
        throw err;
      }
    });
  };
};

// ── Debug: transport-level request/response logger ───────────────────────────
//
// Wraps transport.onmessage and transport.send AFTER server.connect() so we
// see the raw JSON-RPC wire payload before the SDK touches it. This is the
// only place where pre-validation failures (e.g. "params requires property X")
// become visible, because the tool-call wrapper above fires *after* Zod passes.
//
// NOTE: DEBUG=1 must be in the environment of the MCP server *process*, not
// just the terminal. For Claude Desktop / Claude Code, add it to the "env"
// block in your MCP client config:
//
//   { "env": { "GITHUB_TOKEN": "...", "DEBUG": "1" } }
//
// All output goes to stderr, which MCP clients display in their server logs.

const wrapTransportLogging = (transport: Transport, label: string): void => {
  // ── Incoming (client → server) ───────────────────────────────────────────
  const origOnMessage = transport.onmessage?.bind(transport);
  transport.onmessage = <T extends JSONRPCMessage>(
    msg: T,
    extra?: MessageExtraInfo,
  ): void => {
    log.debug(`[${label}] ← recv`, msg);
    origOnMessage?.(msg, extra);
  };

  // ── Outgoing (server → client) ───────────────────────────────────────────
  const origSend = transport.send.bind(transport);
  transport.send = (msg: JSONRPCMessage, options?: TransportSendOptions) => {
    log.debug(`[${label}] → send`, msg);
    return origSend(msg, options);
  };
};

// ── Server factory ───────────────────────────────────────────────────────────

const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: "github-projects-mcp-server",
    version: "1.0.0",
  });

  if (log.isDebug()) {
    patchToolLogging(server);
    log.debug("tool-call logging enabled");
  }

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
  // Wrap AFTER connect — the SDK sets transport.onmessage during connect.
  if (log.isDebug()) wrapTransportLogging(transport, "stdio");
  log.info("github-projects-mcp-server running on stdio");
};

// ── Streamable HTTP transport (for remote/multi-client scenarios) ─────────────

const runHttp = () => {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    log.debug("health check", { method: _req.method, url: _req.url });
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
        log.info(`session closed: ${transport.sessionId}`);
      };

      const server = createMcpServer();
      await server.connect(transport);
      // Wrap AFTER connect — the SDK sets transport.onmessage during connect.
      if (log.isDebug()) {
        wrapTransportLogging(transport, `http:${transport.sessionId}`);
      }
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
    log.info(
      `github-projects-mcp-server listening → http://0.0.0.0:${port}/mcp`,
    );
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
    log.error("fatal", err);
    Deno.exit(1);
  });
}
