// =============================================================================
// src/services/logger.ts
// Lightweight structured logger — all output goes to stderr so it never
// interferes with the MCP JSON-RPC stream on stdout (stdio transport).
//
// Usage:
//   DEBUG=1 deno task dev        — enable debug + info + warn + error
//   (no DEBUG env)               — info + warn + error only
//
// Levels:  debug < info < warn < error
// =============================================================================

const isDebug = (): boolean => !!Deno.env.get("DEBUG");

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

const write = (level: string, msg: string, extra?: unknown): void => {
  const line = `[${timestamp()}] [${pad(level, 5)}] ${msg}${formatExtra(extra)}`;
  console.error(line);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const log = {
  /** True when DEBUG=1 is set — useful for conditional debug work outside this module. */
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

  /** Errors — thrown exceptions, API failures, etc. Always emitted. */
  error(msg: string, extra?: unknown): void {
    write("ERROR", msg, extra);
  },
};
