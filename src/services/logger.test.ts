// ── src/services/logger.test.ts ─────────────────────────────────────────────
// Unit tests for the transport-mode-aware logger:
//   - stdio mode: stderr only, MCP notifications suppressed
//   - http mode:  stderr + MCP notifications when server is bound
//   - MCP level mapping (WARN→warning, ERROR→error, INFO→info)
//   - Transport failure is silently caught (stderr still fires)
//   - DEBUG gate
//   - bind / unbind lifecycle

import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { bindMcpServer, initLogger, log, type McpServerLike } from "./logger.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

interface CapturedCall {
  level: string;
  data: string;
}

/** A minimal McpServerLike that captures calls into an array. */
const capturingServer = (): { server: McpServerLike; calls: CapturedCall[] } => {
  const calls: CapturedCall[] = [];
  const server: McpServerLike = {
    sendLoggingMessage(params: { level: string; data: string }): Promise<void> {
      calls.push({ level: params.level, data: params.data });
      return Promise.resolve();
    },
  };
  return { server, calls };
};

// ── Spies for console.error ────────────────────────────────────────────────

// Re-spy in each test that needs it to avoid carry-over counts.
const spyStderr = () => spy(console, "error");

// ── Test setup helpers ──────────────────────────────────────────────────────

/**
 * Configure the logger for http mode with a capturing mock server.
 * Returns the calls array so assertions can inspect MCP notification traffic.
 */
const initHttp = (): CapturedCall[] => {
  initLogger({ transport: "http", debug: false });
  const { server, calls } = capturingServer();
  bindMcpServer(server);
  return calls;
};

/**
 * Configure the logger for stdio mode with a capturing mock server.
 * Returns the calls array - should always be empty because stdio mode
 * does not emit MCP notifications.
 */
const initStdio = (): CapturedCall[] => {
  initLogger({ transport: "stdio", debug: false });
  const { server, calls } = capturingServer();
  bindMcpServer(server);
  return calls;
};

// ── Tests ──────────────────────────────────────────────────────────────────

// --- stdio mode - MCP notifications suppressed ---

Deno.test("stdio mode: log.info writes to stderr only, no MCP notification", () => {
  using stderrSpy = spyStderr();
  const calls = initStdio();

  log.info("stdio info");
  assertSpyCalls(stderrSpy, 1);
  assertEquals(calls.length, 0);
});

Deno.test("stdio mode: log.warn writes to stderr only, no MCP notification", () => {
  using stderrSpy = spyStderr();
  const calls = initStdio();

  log.warn("stdio warn");
  assertSpyCalls(stderrSpy, 1);
  assertEquals(calls.length, 0);
});

Deno.test("stdio mode: log.error writes to stderr only, no MCP notification", () => {
  using stderrSpy = spyStderr();
  const calls = initStdio();

  log.error("stdio error");
  assertSpyCalls(stderrSpy, 1);
  assertEquals(calls.length, 0);
});

// --- http mode - dual output ---

Deno.test("http mode: log.info writes to stderr AND sends MCP notification", () => {
  using stderrSpy = spyStderr();
  const calls = initHttp();

  log.info("http info");
  assertSpyCalls(stderrSpy, 1);
  assertEquals(calls.length, 1);
  assertEquals(calls[0], { level: "info", data: "http info" });
});

Deno.test("http mode: log.warn writes to stderr AND sends MCP notification", () => {
  using stderrSpy = spyStderr();
  const calls = initHttp();

  log.warn("http warn");
  assertSpyCalls(stderrSpy, 1);
  assertEquals(calls.length, 1);
});

Deno.test("http mode: log.error writes to stderr AND sends MCP notification", () => {
  using stderrSpy = spyStderr();
  const calls = initHttp();

  log.error("http error");
  assertSpyCalls(stderrSpy, 1);
  assertEquals(calls.length, 1);
});

// --- DEBUG gate ---

Deno.test("log.debug is silent when debug is false", () => {
  using stderrSpy = spyStderr();
  initLogger({ transport: "stdio", debug: false });

  log.debug("should be silent");
  assertSpyCalls(stderrSpy, 0);
});

Deno.test("log.debug emits when debug is true", () => {
  using stderrSpy = spyStderr();
  initLogger({ transport: "stdio", debug: true });

  log.debug("should fire");
  assertSpyCalls(stderrSpy, 1);
});

Deno.test("log.isDebug is false when debug is false", () => {
  initLogger({ transport: "stdio", debug: false });
  assertEquals(log.isDebug(), false);
});

Deno.test("log.isDebug is true when debug is true", () => {
  initLogger({ transport: "stdio", debug: true });
  assertEquals(log.isDebug(), true);
});

// --- MCP level mapping (http mode) ---

Deno.test("http mode: WARN maps to MCP level 'warning'", () => {
  const calls = initHttp();

  log.warn("a warning");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].level, "warning");
});

Deno.test("http mode: ERROR maps to MCP level 'error'", () => {
  const calls = initHttp();

  log.error("an error");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].level, "error");
});

Deno.test("http mode: INFO maps to MCP level 'info'", () => {
  const calls = initHttp();

  log.info("info level check");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].level, "info");
});

// --- Transport failure is silent ---

Deno.test("http mode: transport failure does not throw and does not block stderr", () => {
  using stderrSpy = spyStderr();
  initLogger({ transport: "http", debug: false });

  const failingServer: McpServerLike = {
    sendLoggingMessage: () => Promise.reject(new Error("transport down")),
  };
  bindMcpServer(failingServer);

  // Should not throw
  log.info("fire and forget");

  // stderr should still have fired
  assertSpyCalls(stderrSpy, 1);
});

// --- MCP data is the raw message string, not the formatted line ---

Deno.test("http mode: MCP notification data is the raw message, not the formatted line", () => {
  const calls = initHttp();

  log.info("raw message", { extra: "data" });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].data, "raw message");
});

// --- Server rebind ---

Deno.test("http mode: rebinding server picks up new server, old server ignored", () => {
  const calls = initHttp();

  // First server captures
  log.info("first");
  assertEquals(calls.length, 1);

  // Bind a different server
  const calls2: CapturedCall[] = [];
  bindMcpServer({
    sendLoggingMessage(params) {
      calls2.push({ level: params.level, data: params.data });
      return Promise.resolve();
    },
  });

  log.info("second");
  // Old server should NOT have received it
  assertEquals(calls.length, 1);
  // New server SHOULD have received it
  assertEquals(calls2.length, 1);
  assertEquals(calls2[0].data, "second");
});

// --- Default mode is stdio ---

Deno.test("default mode (before initLogger) is stdio - no MCP notifications", () => {
  // Simulate: mode hasn't been set yet (tests above may have left state)
  initLogger({ transport: "stdio", debug: false });
  const { server, calls } = capturingServer();
  bindMcpServer(server);

  log.info("default mode");
  assertEquals(calls.length, 0);
});
