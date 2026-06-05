// =============================================================================
// src/services/logger.ts
// Structured logger with dual output: stderr (for host-app log capture) and
// MCP logging notifications (for connected MCP clients).
//
// When an McpServer is bound via setLogTransport(), every log.* call writes to
// BOTH console.error() AND the server as a structured notifications/message.
// When no transport is bound (pre-bootstrap or adapter code), output is stderr-only.
//
// Usage:
//   DEBUG=1 deno task dev        - enable debug + info + warn + error
//   (no DEBUG env)               - info + warn + error only
//
// Levels:  debug < info < warn < error
// MCP mapping: debug→debug  info→info  warn→warning  error→error
// =============================================================================

const isDebug = (): boolean => !!Deno.env.get("DEBUG");

// ── MCP Logging Transport ──────────────────────────────────────────────────
//
// Declared here (Services layer) to avoid a dependency inversion violation.
// The composition root (src/server.ts) satisfies this interface with McpServer.
// Logger never imports server code — the interface lives with the consumer.

/** Contract for sending structured log messages to the MCP client. */
export interface LogTransport {
  sendLoggingMessage(
    params: { level: "debug" | "info" | "warning" | "error"; data: string },
  ): Promise<void>;
}

let _transport: LogTransport | null = null;

/**
 * Bind the MCP server as the log transport.
 * Called once during server bootstrap inside createMcpServer().
 * Idempotent — subsequent calls overwrite the previous binding.
 */
export const setLogTransport = (transport: LogTransport): void => {
  _transport = transport;
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

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

// ── MCP level mapping ──────────────────────────────────────────────────────
//
// Maps internal log levels to MCP-compliant severity strings.
// MCP spec levels: debug, info, notice, warning, error, critical, alert, emergency.
// We only use the four that map to our internal levels.

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

const write = (level: string, msg: string, extra?: unknown): void => {
  const line = `[${timestamp()}] [${pad(level, 5)}] ${msg}${formatExtra(extra)}`;

  // Always write to stderr for host-app log capture (Claude Desktop, etc.)
  console.error(line);

  // Also send as MCP log notification when a transport is bound.
  // Fire-and-forget — MCP transport failure must never crash the logger.
  if (_transport) {
    _transport.sendLoggingMessage({ level: toMcpLevel(level), data: msg }).catch(() => {
      // Silently ignore — stderr already captured the message.
    });
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const log = {
  /** True when DEBUG=1 is set - useful for conditional debug work outside this module. */
  isDebug,

  /** Low-level tracing: tool calls, GraphQL operations, timing. Only emitted when DEBUG=1. */
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

  /** Errors - thrown exceptions, API failures, etc. Always emitted. */
  error(msg: string, extra?: unknown): void {
    write("ERROR", msg, extra);
  },
};
