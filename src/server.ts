// =============================================================================
// src/server.ts - Composition root and transport entry point
//
// Responsibilities:
//   - Select which backend to build via the adapter factory registry
//   - Wire the backend to tool registration
//   - Set up MCP transports (stdio and HTTP)
//   - Install cross-cutting observability (tool logging, transport tracing)
//
// This file imports no adapter internals - backend construction is delegated to
// src/adapters/factory.ts, which selects the correct AdapterFactory by platform key.
//
// Error handling strategy:
//   - All logging goes to stderr (never stdout - MCP protocol).
//   - Unhandled rejections are logged to stderr only.
//   - stdio transport wraps the entire lifecycle in a try/catch that emits
//     a valid JSON-RPC error response on stdout so the MCP client receives
//     protocol-compliant error instead of raw stack traces.
// =============================================================================

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import { registerScrumReadTools } from "./tools/scrum-read.ts";
import { registerScrumWriteTools } from "./tools/scrum-write.ts";
import { templateResourceUseCase } from "./scrum/template-resource.ts";
import { type AdapterFactory, createBackend } from "./adapters/factory.ts";
import { GitHubAdapterFactory } from "./adapters/github/factory.ts";
import { AdapterError } from "./domain/errors.ts";
import { log } from "./services/logger.ts";
import { parseArgs } from "@std/cli/parse-args";
import { resolve as resolvePath } from "@std/path";
import { SCRUM_READ_TOOL_NAMES } from "./tools/scrum-read.ts";
import { SCRUM_WRITE_TOOL_NAMES } from "./tools/scrum-write.ts";

// ── Process-level crash guard ────────────────────────────────────────────────
//
// Registered BEFORE any module-level code runs that could throw.
// Ensures unhandled rejections write only to stderr, never to stdout.
// In stdio mode, a raw stack trace on stdout breaks the MCP wire protocol
// and produces the confusing "is not valid JSON" error the client sees.

addEventListener("unhandledrejection", (event: Event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  log.error("Unhandled rejection - this is a bug.", {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  event.preventDefault();
});

// ── CLI argument parsing ─────────────────────────────────────────────────────

const _cliArgs = parseArgs(Deno.args, {
  boolean: ["help"],
  string: ["config", "root"],
  alias: { h: "help", c: "config", r: "root" },
});

if (_cliArgs.help) {
  // Use console.error so help text never contaminates the MCP stdio stream.
  console.error(`
scrum-master-toolkit-server

Usage:
  mcp-server [options]

Options:
  --help, -h           Show this help message
  --config, -c <path>  Path to scrum config YAML
                       (default: .github/scrum/config.yml)
  --root, -r <path>    Project root directory for resolving template paths
                       (default: current working directory)
                       Required when --config points outside the project root.

Environment variables:
  GITHUB_TOKEN         GitHub personal access token (required; referenced as
                       $GITHUB_TOKEN in config backends.github.auth.token)
  MCP_TRANSPORT        Transport mode: stdio (default) | http
  PORT                 HTTP port when MCP_TRANSPORT=http (default: 3000)
  SCRUM_PLATFORM       Platform adapter to use (default: github)
  DEBUG                Set to 1 for API-level tracing
  TRACE                Set to 1 for raw JSON-RPC wire tracing

Examples:
  # Run with default config (must be invoked from the project root):
  mcp-server

  # Run from anywhere, pointing at a specific project:
  mcp-server --config /home/user/myproject/.github/scrum/config.yml \\
             --root   /home/user/myproject

  # Run as HTTP server:
  MCP_TRANSPORT=http PORT=3000 mcp-server --config ./scrum.yml --root .
`);
  Deno.exit(0);
}

// Resolve config path and root. Both are optional:
//   configPath  undefined → GitHubAdapterFactory uses its own default
//   projectRoot undefined → GitHubFileReader uses Deno.cwd()
const _configPath: string | undefined = _cliArgs.config
  ? resolvePath(Deno.cwd(), _cliArgs.config)
  : undefined;

const _projectRoot: string | undefined = _cliArgs.root
  ? resolvePath(Deno.cwd(), _cliArgs.root)
  : undefined;

// ── Runtime permission guard ─────────────────────────────────────────────────
//
// `deno compile --allow-env ...` bakes permissions into the binary - this
// guard fires only when someone runs the uncompiled source via `deno run`
// without the required flags.

try {
  Deno.env.get("MCP_TRANSPORT"); // canary: throws PermissionDenied without --allow-env
} catch (err) {
  if (err instanceof Deno.errors.PermissionDenied) {
    console.error(
      "Error: missing required Deno permissions.\n" +
        "Run with: deno run --allow-env --allow-net --allow-read src/server.ts\n" +
        "Or use the compiled binary which has permissions baked in.",
    );
    Deno.exit(1);
  }
  throw err;
}

// ── Tool-call interceptor ────────────────────────────────────────────────────
//
// Three verbosity tiers:
//
//   always   - tool name, timing, and errors with input params (no env var needed)
//   DEBUG=1  - GraphQL/REST operation names and params (API-level tracing)
//   TRACE=1  - raw JSON-RPC wire messages (transport dump, very noisy)

const patchToolLogging = (server: McpServer): void => {
  // McpServer does not expose registerTool on its public type, but the
  // runtime object carries it as an own method. We patch it via a local
  // interface that declares only the shape we need.
  interface McpServerInternal {
    registerTool(
      name: string,
      config: unknown,
      handler: (params: unknown, extra: unknown) => Promise<unknown>,
    ): unknown;
  }
  const _server = server as unknown as McpServerInternal;
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
      // Always: log which tool fired (no params - keeps the line short)
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
// Logs every raw JSON-RPC message - useful for debugging MCP protocol issues
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

// ── Degraded-mode stub tool registration ─────────────────────────────────────
//
// When the config file is missing or unreadable at startup, the server registers
// stub handlers for every scrum tool. Each stub returns the human-readable
// error message rather than crashing the MCP session. This allows the MCP client
// to list tools normally and surface a clear error on every call.
//
// SCRUM_READ_TOOL_NAMES and SCRUM_WRITE_TOOL_NAMES are the single source of truth.
// Never hardcode tool names here.

const ALL_SCRUM_TOOL_NAMES = [...SCRUM_READ_TOOL_NAMES, ...SCRUM_WRITE_TOOL_NAMES];

const registerStubTools = (server: McpServer, errorMessage: string): void => {
  for (const name of ALL_SCRUM_TOOL_NAMES) {
    // server.tool() is the MCP SDK convenience method - no description or
    // annotations needed for stub handlers. It accepts an empty Zod schema {}.
    server.tool(name, {}, () => ({
      content: [{ type: "text" as const, text: errorMessage }],
    }));
  }
};

// ── Server factory ───────────────────────────────────────────────────────────

const createMcpServer = async (
  configPath?: string,
  projectRoot?: string,
): Promise<McpServer> => {
  const server = new McpServer({
    name: "scrum-master-toolkit-server",
    version: Deno.env.get("RELEASE_VERSION") ?? "dev",
  });

  patchToolLogging(server);

  // Use the adapter factory registry to construct the backend.
  // SCRUM_PLATFORM env var controls which platform is selected (default: "github").
  const factories: AdapterFactory[] = [new GitHubAdapterFactory()];

  let backendResult: Awaited<ReturnType<typeof createBackend>>;
  try {
    backendResult = await createBackend(factories, { configPath, projectRoot });
  } catch (err) {
    let hint: string;
    if (err instanceof AdapterError && err.code === "AUTH_FAILED") {
      hint =
        `Backend authentication failed - check that the platform token (e.g. GITHUB_TOKEN) is set and valid.`;
    } else if (configPath) {
      hint = `Config not found or invalid at: ${configPath}`;
    } else {
      hint = `Config not found at default path: .github/scrum/config.yml`;
    }
    const errorMessage = `${hint}\n` +
      `Pass --config <path> and --root <project-dir> when starting the server.\n` +
      `Original error: ${err instanceof Error ? err.message : String(err)}`;
    registerStubTools(server, errorMessage);
    log.warn("Server started in degraded mode.", { hint });
    return server;
  }

  const { backend, fileReader, scrumConfig, typeTemplatePaths } = backendResult;

  registerScrumReadTools(server, backend, scrumConfig);
  registerScrumWriteTools(server, backend, scrumConfig);

  if (fileReader) {
    const templateReadCallback = async (uri: URL, variables: Variables) => {
      const type = Array.isArray(variables.type) ? variables.type[0] : variables.type;
      const { content, mimeType } = await templateResourceUseCase(
        type,
        fileReader,
        typeTemplatePaths,
      );
      return {
        contents: [{ uri: uri.href, mimeType, text: content }],
      };
    };
    server.registerResource(
      "scrum-template",
      new ResourceTemplate("scrum://template/{type}", { list: undefined }),
      {
        description:
          "PBI item-type template. URI listed in scrum_orient → platform_state.template_uris.",
      },
      templateReadCallback,
    );
  }

  return server;
};

// ── Stdio transport ──────────────────────────────────────────────────────────
//
// Wraps the entire lifecycle in try/catch. If createMcpServer or server.connect
// throws - due to a module init failure, config crash, or transport error -
// a valid JSON-RPC error response is emitted on stdout so the MCP client
// receives protocol-compliant output instead of a raw stack trace.

/**
 * Emit a valid JSON-RPC 2.0 error response on stdout.
 * Used as a last-resort fallback when the server cannot even complete
 * initialization. Without this, the MCP client sees raw error text on stdout
 * and reports "is not valid JSON".
 */
const emitJsonRpcError = (message: string): void => {
  const response = JSON.stringify({
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32000,
      message: `Server initialization failed: ${message}`,
    },
  });
  // Write directly to stdout - this is the only place in the codebase that
  // does so, and only as a catastrophic-fallback.
  const encoder = new TextEncoder();
  Deno.stdout.writeSync(encoder.encode(response + "\n"));
};

const runStdio = async (
  configPath?: string,
  projectRoot?: string,
): Promise<void> => {
  try {
    const server = await createMcpServer(configPath, projectRoot);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    if (Deno.env.get("TRACE")) wrapTransportLogging(transport, "stdio");
    log.info("scrum-master-toolkit-server running on stdio");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Stdio server failed to start.", { error: message });
    emitJsonRpcError(message);
    Deno.exit(1);
  }
};

// ── Streamable HTTP transport ────────────────────────────────────────────────
//
// Uses Deno.serve() with WebStandardStreamableHTTPServerTransport — the MCP SDK's
// native Web Standards transport for Deno/Bun/Cloudflare Workers. No express needed.
//
// Body-parsing note: Request bodies can only be consumed once. For a new
// initialization POST (no session ID), we parse the body here to validate it with
// isInitializeRequest, then forward it to handleRequest via { parsedBody } so the
// transport doesn't attempt a second read on the already-consumed stream.

const runHttp = (configPath?: string, projectRoot?: string): void => {
  const transports: Record<string, WebStandardStreamableHTTPServerTransport> = {};
  const port = parseInt(Deno.env.get("PORT") || "3000", 10);

  Deno.serve({ port }, async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);

    // ── Health check ──────────────────────────────────────────────────────────
    if (pathname === "/health" && req.method === "GET") {
      log.debug("health check", { method: req.method, url: req.url });
      return Response.json({ jsonrpc: "2.0", server: "scrum-master-toolkit-server" });
    }

    // ── MCP endpoint ──────────────────────────────────────────────────────────
    if (pathname === "/mcp") {
      const sessionId = req.headers.get("mcp-session-id") ?? undefined;

      if (req.method === "POST") {
        if (!sessionId) {
          // No session yet — must be an initialization request.
          // Parse body once here so we can validate and hand it off via parsedBody.
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            return Response.json(
              {
                jsonrpc: "2.0",
                error: { code: -32700, message: "Parse error: invalid JSON" },
                id: null,
              },
              { status: 400 },
            );
          }

          if (!isInitializeRequest(body)) {
            return Response.json(
              {
                jsonrpc: "2.0",
                error: { code: -32000, message: "Bad Request: No valid session ID provided" },
                id: null,
              },
              { status: 400 },
            );
          }

          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id: string) => {
              transports[id] = transport;
            },
          });

          transport.onclose = () => {
            if (transport.sessionId) {
              delete transports[transport.sessionId];
              log.info(`session closed: ${transport.sessionId}`);
            }
          };

          const server = await createMcpServer(configPath, projectRoot);
          await server.connect(transport);
          if (Deno.env.get("TRACE")) wrapTransportLogging(transport, `http:${transport.sessionId}`);

          return await transport.handleRequest(req, { parsedBody: body });
        }

        // Existing session.
        const transport = transports[sessionId];
        if (!transport) {
          return Response.json(
            {
              jsonrpc: "2.0",
              error: { code: -32000, message: "Bad Request: No valid session ID provided" },
              id: null,
            },
            { status: 400 },
          );
        }
        return await transport.handleRequest(req);
      }

      if (req.method === "GET" || req.method === "DELETE") {
        if (!sessionId || !transports[sessionId]) {
          return new Response("Invalid or missing session ID", { status: 400 });
        }
        return await transports[sessionId].handleRequest(req);
      }
    }

    return new Response("Not Found", { status: 404 });
  });

  log.info(`scrum-master-toolkit-server listening → http://0.0.0.0:${port}/mcp`);
};

// ── Entry point ──────────────────────────────────────────────────────────────

const transportType = Deno.env.get("MCP_TRANSPORT") ?? "stdio";

if (transportType === "http") {
  runHttp(_configPath, _projectRoot);
} else {
  runStdio(_configPath, _projectRoot).catch((err: unknown) => {
    log.error("fatal", err);
    Deno.exit(1);
  });
}
