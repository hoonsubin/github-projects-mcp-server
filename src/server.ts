import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerScrumReadTools } from "./tools/scrum-read.ts";
import { registerScrumWriteTools } from "./tools/scrum-write.ts";
import { templateResourceUseCase } from "./scrum/template-resource.ts";
import { type AdapterFactory, createBackend } from "./adapters/factory.ts";
import { loadScrumConfig } from "./scrum/config-boot.ts";
import { GitHubAdapterFactory } from "./adapters/github/factory.ts";
import { AdapterError, ConfigError } from "./domain/errors.ts";
import {
  bindMcpServer,
  initLogger,
  log,
  patchToolLogging,
  type TransportMode,
  wrapTransportLogging,
} from "./services/logger.ts";
import { parseArgs } from "@std/cli/parse-args";
import { resolve as resolvePath } from "@std/path";
import { resolveLocation } from "./scrum/utils/resolve-location.ts";
import { SCRUM_READ_TOOL_NAMES } from "./tools/scrum-read.ts";
import { SCRUM_WRITE_TOOL_NAMES } from "./tools/scrum-write.ts";
import type { ScrumConfig } from "./domain/config.ts";
import type { EnvGetter } from "./domain/env.ts";
import { createRateLimiter } from "./services/rate-limiter.ts";

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
  string: ["config"],
  alias: { h: "help", c: "config" },
});

if (_cliArgs.help) {
  log.info(`
scrum-master-toolkit-server

Usage:
  mcp-server [options]

Options:
  --help, -h           Show this help message
  --config, -c <path>  Path or URL to the scrum config YAML (required).
                       Accepts a local path (relative or absolute) or an
                       https:// URL to a remote config file.
                       The project root is declared in the config file itself
                       via project.projRoot (relative to the config file's
                       directory). When absent, defaults to the config
                       file's directory.

Environment variables:
  GITHUB_TOKEN         GitHub personal access token (required; referenced as
                       $GITHUB_TOKEN in config backends.github.auth.token)
  MCP_TRANSPORT        Transport mode: stdio (default) | http
  PORT                 HTTP port when MCP_TRANSPORT=http (default: 3000)
  SCRUM_PLATFORM       Platform adapter to use (default: github)
  DEBUG                Set to 1 for API-level tracing
  TRACE                Set to 1 for raw JSON-RPC wire tracing
  MCP_HOST             Listen address for HTTP transport (default: 127.0.0.1;
                       set to 0.0.0.0 in Docker/container environments)
  ALLOWED_ORIGINS      Comma-separated allowed Origins for CORS validation
                       (empty = permissive, suitable for local dev)
  SESSION_IDLE_TIMEOUT_MS
                       Idle session expiry in ms for HTTP transport
                       (default: 600000 = 10 minutes)

Examples:
  # Run with default config (must be invoked from the project root):
  mcp-server

  # Run from anywhere, pointing at a specific project:
  mcp-server --config /home/user/myproject/.github/scrum/config.yml

  # Run with a remote config file:
  mcp-server --config https://example.com/configs/scrum.yml

  # Run as HTTP server:
  MCP_TRANSPORT=http PORT=3000 mcp-server --config ./scrum.yml
`);
  Deno.exit(0);
}

// ── Environment (single gateway - all Deno.env reads live here) ─────────────
//
// Every env var the server needs is read once here. Downstream code receives
// values through function parameters - never by reaching out to Deno.env.

const env: EnvGetter = (name: string) => Deno.env.get(name);
const platform = env("SCRUM_PLATFORM") ?? "github";
const debug = !!env("DEBUG");
const trace = !!env("TRACE");

const _rawConfigPath: string | undefined = _cliArgs.config || env("SCRUM_CONFIG_PATH");

if (!_rawConfigPath) {
  log.error(
    "No config file specified.\n" +
      "Pass --config <path-or-url> when starting the server, " +
      "or set the SCRUM_CONFIG_PATH environment variable.\n" +
      "Example: mcp-server --config .github/scrum/config.yml",
  );
  Deno.exit(1);
}

try {
  Deno.env.get("MCP_TRANSPORT"); // canary: throws PermissionDenied without --allow-env
} catch (err) {
  if (err instanceof Deno.errors.PermissionDenied) {
    log.error(
      "Missing required Deno permissions.\n" +
        "Run with: deno run --allow-env --allow-net --allow-read src/server.ts\n" +
        "Or use the compiled binary which has permissions baked in.",
    );
    Deno.exit(1);
  }
  throw err;
}

const ALL_SCRUM_TOOL_NAMES = [...SCRUM_READ_TOOL_NAMES, ...SCRUM_WRITE_TOOL_NAMES];

// Register stub implementations of all Scrum tools that return a client-safe
// error message. Used when backend initialization fails — the server starts in
// degraded mode rather than crashing. Stub tools accept any input (empty schema)
// because the server cannot validate tool inputs without a functional backend.
const registerStubTools = (server: McpServer, errorMessage: string): void => {
  for (const name of ALL_SCRUM_TOOL_NAMES) {
    server.tool(name, {}, () => ({
      content: [{ type: "text" as const, text: errorMessage }],
    }));
  }
};

// ── Server factory ───────────────────────────────────────────────────────────

const createMcpServer = async (): Promise<McpServer> => {
  const configLocation = resolveLocation(
    _rawConfigPath as string,
    resolvePath(Deno.cwd()),
  );

  const server = new McpServer(
    {
      name: "scrum-master-toolkit-server",
      version: env("RELEASE_VERSION") ?? "dev",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  // Bind the MCP server so log.* calls in http mode also emit
  // structured MCP logging notifications to the connected client.
  bindMcpServer(server);

  patchToolLogging(server);

  const factories: AdapterFactory[] = [new GitHubAdapterFactory()];

  let scrumConfig: ScrumConfig;
  let projectRoot: string;
  let backendResult: Awaited<ReturnType<typeof createBackend>>;
  try {
    ({ scrumConfig, projectRoot } = await loadScrumConfig(configLocation, env));
    backendResult = await createBackend(factories, {
      configLocation,
      scrumConfig,
      projectRoot,
      env,
      platform,
    });
  } catch (err) {
    // Log full details for operators — never surfaced on the MCP wire.
    log.error("Server initialization failed", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    let clientMessage: string;
    if (err instanceof AdapterError) {
      clientMessage = err.recovery;
    } else if (err instanceof ConfigError) {
      clientMessage = err.recovery;
    } else {
      clientMessage = "Server initialization failed. Check server logs for details.";
    }
    registerStubTools(server, clientMessage);
    log.warn("Server started in degraded mode.");
    return server;
  }

  const { backend, fileReader, typeTemplatePaths } = backendResult;

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

const emitJsonRpcError = (_message: string): void => {
  const response = JSON.stringify({
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32000,
      message: "Server initialization failed. Check server logs for details.",
    },
  });
  const encoder = new TextEncoder();
  Deno.stdout.writeSync(encoder.encode(response + "\n"));
};

const runStdio = async (): Promise<void> => {
  try {
    const server = await createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    if (trace) wrapTransportLogging(transport, "stdio");
    log.info("scrum-master-toolkit-server running on stdio");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Stdio server failed to start.", { error: message });
    emitJsonRpcError(message);
    Deno.exit(1);
  }
};

const runHttp = (): void => {
  const transports: Record<string, WebStandardStreamableHTTPServerTransport> = {};
  const sessionActivity: Map<string, number> = new Map();

  const port = (() => {
    const raw = env("PORT") || "3000";
    const p = parseInt(raw, 10);
    if (isNaN(p) || p < 1 || p > 65535) {
      log.error(`Invalid PORT="${raw}". Must be an integer between 1 and 65535.`);
      Deno.exit(1);
    }
    return p;
  })();
  const SESSION_IDLE_TIMEOUT_MS = (() => {
    const raw = env("SESSION_IDLE_TIMEOUT_MS");
    if (!raw) return 10 * 60_000;
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? 10 * 60_000 : parsed;
  })();

  const allowedOrigins: Set<string> = (() => {
    const raw = env("ALLOWED_ORIGINS");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  })();

  const corsHeaders = (origin: string | null): HeadersInit =>
    origin && (allowedOrigins.size === 0 || allowedOrigins.has(origin))
      ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, MCP-Session-Id, MCP-Protocol-Version, Accept",
      }
      : {};

  // Merges CORS headers onto a Response returned by the SDK transport, which
  // constructs its own Response objects that we cannot intercept at creation.
  const withCors = (res: Response, origin: string | null): Response => {
    const hdrs = corsHeaders(origin);
    if (!Object.keys(hdrs).length) return res;
    const merged = new Headers(res.headers);
    for (const [k, v] of Object.entries(hdrs)) merged.set(k, v as string);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: merged,
    });
  };

  const hostname = (() => {
    const raw = env("MCP_HOST");
    if (!raw) return "127.0.0.1";
    if (raw.includes("/") || raw.includes("\\") || raw.includes("..")) {
      log.error(`Invalid MCP_HOST="${raw}". Must be a valid hostname or IP address.`);
      Deno.exit(1);
    }
    return raw;
  })();

  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, lastActive] of sessionActivity) {
      if (now - lastActive > SESSION_IDLE_TIMEOUT_MS) {
        delete transports[id];
        sessionActivity.delete(id);
        log.info(`session expired: ${id}`);
      }
    }
  }, 60_000);

  if (allowedOrigins.size === 0) {
    log.warn(
      "ALLOWED_ORIGINS is not set — all origins are permitted. " +
        "Set ALLOWED_ORIGINS to a comma-separated list of allowed origins " +
        "to restrict cross-origin access in production.",
    );
  }

  // Rate limiters — MCP spec §Security requires server-side rate limiting.
  const MAX_SESSIONS = 100;
  const initLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });
  const toolLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 300 });

  const clearSweep = () => {
    clearInterval(sweepInterval);
    initLimiter.dispose();
    toolLimiter.dispose();
  };
  Deno.addSignalListener("SIGTERM", clearSweep);
  Deno.addSignalListener("SIGINT", clearSweep);

  // Use Deno.ServeHandlerInfo for the real remote address. Fall back to
  // X-Forwarded-For only when explicitly operating behind a trusted proxy
  // (TRUSTED_PROXY=1), since X-Forwarded-For can be spoofed by clients.
  const trustedProxy = !!env("TRUSTED_PROXY");
  const clientIp = (req: Request, info: Deno.ServeHandlerInfo): string => {
    if (trustedProxy) {
      const forwarded = req.headers.get("x-forwarded-for");
      if (forwarded) return forwarded.split(",")[0].trim();
    }
    return (info.remoteAddr as Deno.NetAddr).hostname;
  };

  Deno.serve(
    { hostname, port },
    async (req: Request, info: Deno.ServeHandlerInfo): Promise<Response> => {
      const { pathname } = new URL(req.url);
      const origin = req.headers.get("Origin");

      // ── CORS preflight ────────────────────────────────────────────────────────
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders(origin),
            "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, MCP-Session-Id, MCP-Protocol-Version, Accept",
          },
        });
      }

      // ── Origin validation (strict mode when ALLOWED_ORIGINS is set) ───────────
      if (origin && allowedOrigins.size > 0 && !allowedOrigins.has(origin)) {
        return Response.json(
          {
            jsonrpc: "2.0",
            error: { code: -32000, message: "Forbidden: invalid Origin" },
            id: null,
          },
          { status: 403, headers: corsHeaders(origin) },
        );
      }

      // ── Health check ──────────────────────────────────────────────────────────
      if (pathname === "/health" && req.method === "GET") {
        log.debug("health check", { method: req.method, url: req.url });
        return Response.json(
          { jsonrpc: "2.0", server: "scrum-master-toolkit-server" },
          { headers: corsHeaders(origin) },
        );
      }

      // ── MCP endpoint ──────────────────────────────────────────────────────────
      if (pathname === "/mcp") {
        const sessionId = req.headers.get("mcp-session-id") ?? undefined;

        if (req.method === "POST") {
          const MAX_BODY_BYTES = 1_048_576; // 1 MiB
          const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
          if (contentLength > MAX_BODY_BYTES) {
            return new Response(null, { status: 413, headers: corsHeaders(origin) });
          }

          if (!sessionId) {
            // Rate-limit new session creation per client IP.
            const ip = clientIp(req, info);
            if (!initLimiter.allow(ip)) {
              return new Response(null, { status: 429, headers: corsHeaders(origin) });
            }
            if (Object.keys(transports).length >= MAX_SESSIONS) {
              return new Response(null, { status: 503, headers: corsHeaders(origin) });
            }

            // No session yet - must be an initialization request.
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
                { status: 400, headers: corsHeaders(origin) },
              );
            }

            if (!isInitializeRequest(body)) {
              return Response.json(
                {
                  jsonrpc: "2.0",
                  error: { code: -32600, message: "Bad Request: first request must be initialize" },
                  id: null,
                },
                { status: 400, headers: corsHeaders(origin) },
              );
            }

            const transport = new WebStandardStreamableHTTPServerTransport({
              sessionIdGenerator: () => crypto.randomUUID(),
              onsessioninitialized: (id: string) => {
                transports[id] = transport;
                sessionActivity.set(id, Date.now());
              },
            });

            // SSE stream closure must NOT evict the session — the session is a
            // logical scope that survives stream reconnections. Only the TTL
            // sweep or an explicit DELETE /mcp should remove a session.
            transport.onclose = () => {
              if (transport.sessionId) {
                log.info(`SSE stream closed for session: ${transport.sessionId}`);
              }
            };

            const server = await createMcpServer();
            await server.connect(transport);
            if (trace) wrapTransportLogging(transport, `http:${transport.sessionId}`);

            return withCors(await transport.handleRequest(req, { parsedBody: body }), origin);
          }

          // Existing session.
          const transport = transports[sessionId];
          if (!transport) {
            return Response.json(
              { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null },
              { status: 404, headers: corsHeaders(origin) },
            );
          }
          if (!toolLimiter.allow(clientIp(req, info))) {
            return Response.json(
              { jsonrpc: "2.0", error: { code: -32000, message: "Rate limit exceeded" }, id: null },
              { status: 429, headers: corsHeaders(origin) },
            );
          }
          sessionActivity.set(sessionId, Date.now());
          return withCors(await transport.handleRequest(req), origin);
        }

        if (req.method === "GET") {
          if (!sessionId) {
            return new Response(null, {
              status: 405,
              headers: { Allow: "POST", ...corsHeaders(origin) },
            });
          }
          if (!transports[sessionId]) {
            return Response.json(
              { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null },
              { status: 404, headers: corsHeaders(origin) },
            );
          }
          return withCors(await transports[sessionId].handleRequest(req), origin);
        }

        if (req.method === "DELETE") {
          if (!sessionId) {
            return Response.json(
              {
                jsonrpc: "2.0",
                error: { code: -32000, message: "Bad Request: missing session ID" },
                id: null,
              },
              { status: 400, headers: corsHeaders(origin) },
            );
          }
          if (!transports[sessionId]) {
            return Response.json(
              { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null },
              { status: 404, headers: corsHeaders(origin) },
            );
          }
          try {
            return withCors(await transports[sessionId].handleRequest(req), origin);
          } finally {
            delete transports[sessionId];
            sessionActivity.delete(sessionId);
            log.info(`session terminated by client: ${sessionId}`);
          }
        }
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders(origin) });
    },
  );

  log.info(`scrum-master-toolkit-server listening → http://${hostname}:${port}/mcp`);
};

// ── Entry point ──────────────────────────────────────────────────────────────

const transportType: TransportMode = (env("MCP_TRANSPORT") ?? "stdio") as TransportMode;
initLogger({ transport: transportType, debug });

if (transportType === "http") {
  runHttp();
} else {
  runStdio().catch((err: unknown) => {
    log.error("fatal", err);
    Deno.exit(1);
  });
}
