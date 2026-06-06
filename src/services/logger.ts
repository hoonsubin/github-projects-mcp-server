// =============================================================================
// src/services/logger.ts
// Structured logger with transport-mode-aware dual output:
//   stderr     — always used (host-app log capture), safe for both stdio & HTTP
//   MCP notifications/message — only used in HTTP mode (SSE transport)
//
// In stdio mode, stdout carries the JSON-RPC wire protocol and MUST NOT contain
// anything else. Logging goes to stderr only. Per the MCP spec (2024-11-05):
//   "The server MAY write UTF-8 strings to stderr for logging purposes."
//   "The server MUST NOT write anything to stdout that is not a valid MCP message."
//
// In HTTP/SSE mode, the structured MCP Logging utility is the contract:
//   Server declares "logging" capability → client sets level via logging/setLevel
//   → server emits notifications/message over the SSE channel.
//   We additionally write to stderr so host-app logs (Docker, journald) capture output.
//
// Usage:
//   // server.ts calls once at startup:
//   initLogger({ transport: "stdio", debug: false });
//   // after McpServer is created:
//   bindMcpServer(server);
//
//   // every other module simply imports { log }:
//   log.debug("trace details", { some: "context" });   // only when debug=true
//   log.info("milestone");
//   log.warn("non-fatal issue", err);
//   log.error("fatal condition", { error: err.message });
//
// Levels:  debug < info < warn < error
// MCP mapping: debug→debug  info→info  warn→warning  error→error
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Transport mode — determines output routing. */
export type TransportMode = "stdio" | "http";

/**
 * Minimal interface for the MCP server's logging notification method.
 * Exported so tests can supply a mock without importing McpServer.
 */
export interface McpServerLike {
  sendLoggingMessage(
    params: { level: "debug" | "info" | "warning" | "error"; data: string },
  ): Promise<void>;
}

// ── Module-level state ──────────────────────────────────────────────────────

let _mode: TransportMode = "stdio";
let _mcpServer: McpServerLike | null = null;
let _debug = false;

const isDebug = (): boolean => _debug;

// ── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialise the logger with the active transport mode and debug flag.
 * MUST be called once at server startup before any log.* calls.
 *
 * transport="stdio" → stderr only (stdout carries JSON-RPC protocol messages)
 * transport="http"  → stderr + MCP notifications/message over SSE
 * debug=true        → enables log.debug() and wire tracing output
 */
export const initLogger = (opts: { transport: TransportMode; debug: boolean }): void => {
  _mode = opts.transport;
  _debug = opts.debug;
};

/**
 * Bind an MCP server for structured log notifications.
 * Called after McpServer is created (async bootstrap path).
 * Only meaningful in http mode; a no-op in stdio mode.
 *
 * The server parameter satisfies McpServerLike so tests can pass mocks.
 */
export const bindMcpServer = (server: McpServerLike): void => {
  _mcpServer = server;
};

// ── Formatting helpers ──────────────────────────────────────────────────────

const pad = (s: string, width: number): string => s.padEnd(width);

const timestamp = (): string => new Date().toISOString();

const formatExtra = (extra: unknown): string => {
  if (extra instanceof Error) {
    const stack = extra.stack
      ? "\n" + extra.stack.split("\n").map((l) => "    " + l).join("\n")
      : "";
    return `\n  ${extra.name}: ${extra.message}${stack}`;
  }
  if (extra === undefined || extra === null) return "";
  try {
    return "\n" + JSON.stringify(extra, null, 2)
      .split("\n")
      .map((l) => "  " + l)
      .join("\n");
  } catch {
    return `\n  ${String(extra)}`;
  }
};

// ── MCP level mapping ───────────────────────────────────────────────────────

/**
 * Maps internal log levels to MCP-compliant severity strings.
 * MCP spec levels: debug, info, notice, warning, error, critical, alert, emergency.
 * We only use the four that map to our internal levels.
 */
const toMcpLevel = (level: string): "debug" | "info" | "warning" | "error" => {
  switch (level) {
    case "DEBUG":
      return "debug";
    case "WARN":
      return "warning";
    case "ERROR":
      return "error";
    case "INFO":
    default:
      return "info";
  }
};

// ── Core write ──────────────────────────────────────────────────────────────

/**
 * Central output function. All log messages flow through here.
 *
 * - stderr: ALWAYS written (safe for both transports)
 * - MCP notification: only in http mode with a bound server
 *
 * In stdio mode we deliberately skip MCP notifications:
 * per the spec, stdout carries JSON-RPC protocol messages only.
 * MCP notifications/message on stdout in stdio mode are technically
 * valid JSON-RPC but may confuse clients that don't declare logging
 * capability or consume stderr for log capture.
 */
const write = (level: string, msg: string, extra?: unknown): void => {
  const line = `[${timestamp()}] [${pad(level, 5)}] ${msg}${formatExtra(extra)}`;

  // Always write to stderr for host-app log capture (Claude Desktop, Docker, etc.)
  console.error(line);

  // In HTTP mode, also send structured MCP log notification.
  // Fire-and-forget — transport failure must never crash the logger.
  if (_mode === "http" && _mcpServer) {
    _mcpServer.sendLoggingMessage({ level: toMcpLevel(level), data: msg }).catch(() => {
      // Silently ignore — stderr already captured the message.
    });
  }
};

// ── Tool invocation logging ─────────────────────────────────────────────────

/**
 * Interface for the internal `registerTool` method not exposed on McpServer's
 * public type. Used by patchToolLogging to intercept all tool registrations.
 */
interface McpServerInternal {
  registerTool(
    name: string,
    config: unknown,
    handler: (params: unknown, extra: unknown) => Promise<unknown>,
  ): unknown;
}

/**
 * Monkey-patch McpServer.registerTool so every tool handler gets automatic
 * before/after logging with timing. The public log.* API is used internally.
 *
 * Each invocation produces:
 *   log.info(`→ toolName`)      — on entry
 *   log.debug(`  params`, ...)  — input params (debug=true only)
 *   log.info(`← toolName OK`)   — on success, with elapsed ms
 *   log.error(`✗ toolName FAILED`) — on throw, with error + params
 *
 * Errors are re-thrown so the MCP SDK can return a JSON-RPC error response.
 */
export const patchToolLogging = (server: McpServer): void => {
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

// ── Wire tracing ────────────────────────────────────────────────────────────

/**
 * Wrap a transport to log all JSON-RPC messages at debug level.
 * Only active when debug is enabled.
 *
 * Usage:
 *   if (trace) wrapTransportLogging(transport, "stdio");
 */
export const wrapTransportLogging = (transport: Transport, label: string): void => {
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

// ── Public API ──────────────────────────────────────────────────────────────

export const log = {
  /** True when debug is enabled — useful for conditional debug work outside this module. */
  isDebug,

  /** Low-level tracing: tool calls, GraphQL operations, timing. Only emitted when debug=true. */
  debug(msg: string, extra?: unknown): void {
    if (!isDebug()) return;
    write("DEBUG", msg, extra);
  },

  /** Informational milestones (server start, session lifecycle). Always emitted. */
  info(msg: string, extra?: unknown): void {
    write("INFO", msg, extra);
  },

  /** Non-fatal anomalies. Always emitted. */
  warn(msg: string, extra?: unknown): void {
    write("WARN", msg, extra);
  },

  /**
   * Errors — thrown exceptions, API failures, startup failures, etc.
   * Always emitted. This is the single output path for ALL errors in the project.
   */
  error(msg: string, extra?: unknown): void {
    write("ERROR", msg, extra);
  },
};
