// =============================================================================
// src/index.ts — Entry point
//
// After Story B (Phase 5): constructs GitHubProjectBackend and wires it to
// tool registration. The backend is the only concretion index.ts knows about.
// =============================================================================

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
import { registerScrumReadTools } from "./tools/scrum-read.ts";
import { registerScrumWriteTools } from "./tools/scrum-write.ts";
import { loadConfig } from "./adapters/github/config-loader.ts";
import { GitHubProjectBackend } from "./adapters/github/backend.ts";
import { graphql, rest } from "./services/github.ts";
import { log } from "./services/logger.ts";
import type { Socket } from "node:net";
import type { ProjectBackend } from "./scrum/ports.ts";
import type { GitHubBackendConfig } from "./adapters/github/types.ts";
import type { ScrumConfig } from "./domain/config.ts";

// ── Tool-call interceptor ────────────────────────────────────────────────────
//
// Three verbosity tiers:
//
//   always   — tool name, timing, and errors with input params (no env var needed)
//   DEBUG=1  — GraphQL/REST operation names and params (API-level tracing)
//   TRACE=1  — raw JSON-RPC wire messages (transport dump, very noisy)

const patchToolLogging = (server: McpServer): void => {
  // deno-lint-ignore no-explicit-any
  const _server = server as unknown as Record<string, any>;
  const original = _server["registerTool"].bind(server) as (
    name: string,
    config: unknown,
    handler: (params: unknown, extra: unknown) => Promise<unknown>,
  ) => unknown;

  _server["registerTool"] = (
    name: string,
    config: unknown,
    handler: (params: unknown, extra: unknown) => Promise<unknown>,
  ): unknown => {
    return original(name, config, async (params: unknown, extra: unknown) => {
      // Always: log which tool fired (no params — keeps the line short)
      log.info(`→ ${name}`);
      // DEBUG: also log the full input so you can see what the agent passed
      log.debug(`  params`, params);

      const t0 = performance.now();
      try {
        const result = await handler(params, extra);
        log.info(`← ${name} OK (${Math.round(performance.now() - t0)}ms)`);
        return result;
      } catch (err: unknown) {
        const ms = Math.round(performance.now() - t0);
        // Always: log the tool that failed, elapsed time, error message, AND
        // the input params so you can reproduce or diagnose the call.
        log.error(`✗ ${name} FAILED (${ms}ms)`, {
          error: err instanceof Error ? err.message : String(err),
          params,
        });
        throw err;
      }
    });
  };
};

// ── Transport-level request/response logger (TRACE=1 only) ───────────────────
//
// Logs every raw JSON-RPC message — useful for debugging MCP protocol issues
// but extremely noisy during normal use. Enable with TRACE=1 (not DEBUG=1).

const wrapTransportLogging = (transport: Transport, label: string): void => {
  const origOnMessage = transport.onmessage?.bind(transport);
  transport.onmessage = <T extends JSONRPCMessage>(
    msg: T,
    extra?: MessageExtraInfo,
  ): void => {
    log.debug(`[${label}] ← recv`, msg);
    origOnMessage?.(msg, extra);
  };

  const origSend = transport.send.bind(transport);
  transport.send = (msg: JSONRPCMessage, options?: TransportSendOptions) => {
    log.debug(`[${label}] → send`, msg);
    return origSend(msg, options);
  };
};

// ── Backend factory ──────────────────────────────────────────────────────────

const createBackend = async (): Promise<{ backend: ProjectBackend; scrumConfig: ScrumConfig }> => {
  const config = await loadConfig({ github: { graphql } });
  const gh = config.scrumConfig.backends.github as GitHubBackendConfig;
  const backend = new GitHubProjectBackend(
    config,
    { graphql, rest },
    gh.owner,
    gh.owner_type,
    gh.tracked_repos[0], // primary repo for issue operations; multi-repo support is future work
  );
  return { backend, scrumConfig: config.scrumConfig };
};

// ── Server factory ───────────────────────────────────────────────────────────

const createMcpServer = async (): Promise<McpServer> => {
  const server = new McpServer({
    name: "github-projects-mcp-server",
    version: "1.0.0",
  });

  patchToolLogging(server);

  const { backend, scrumConfig } = await createBackend();
  registerScrumReadTools(server, backend, scrumConfig);
  registerScrumWriteTools(server, backend, scrumConfig);

  return server;
};

// ── Stdio transport ──────────────────────────────────────────────────────────

const runStdio = async (): Promise<void> => {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (Deno.env.get("TRACE")) wrapTransportLogging(transport, "stdio");
  log.info("github-projects-mcp-server running on stdio");
};

// ── Streamable HTTP transport ────────────────────────────────────────────────

const runHttp = () => {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    log.debug("health check", { method: _req.method, url: _req.url });
    res.status(200).json({ jsonrpc: "2.0", server: "github-projects-mcp-server" });
    return;
  });

  const transports: Record<string, StreamableHTTPServerTransport> = {};

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
      });

      transport.onclose = () => {
        delete transports[transport.sessionId];
        log.info(`session closed: ${transport.sessionId}`);
      };

      const server = await createMcpServer();
      await server.connect(transport);
      if (Deno.env.get("TRACE")) wrapTransportLogging(transport, `http:${transport.sessionId}`);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

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
    log.info(`github-projects-mcp-server listening → http://0.0.0.0:${port}/mcp`);
  });

  const sockets = new Set<Socket>();
  httpServer.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
};

// ── Entry point ──────────────────────────────────────────────────────────────

const transportType = Deno.env.get("MCP_TRANSPORT") ?? "stdio";

if (transportType === "http") {
  runHttp();
} else {
  runStdio().catch((err: unknown) => {
    log.error("fatal", err);
    Deno.exit(1);
  });
}
