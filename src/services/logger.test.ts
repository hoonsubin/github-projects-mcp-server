// ── src/services/logger.test.ts ─────────────────────────────────────────────
// Unit tests for the dual-output logger:
//   - Transport binding / unbinding
//   - stderr output (console.error) always happens
//   - MCP notifications fire when transport is bound
//   - MCP level mapping (WARN→warning, ERROR→error, INFO→info)
//   - Transport failure is silently caught
//   - DEBUG gate

import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { log, type LogTransport, setLogTransport } from "./logger.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

interface CapturedCall {
  level: string;
  data: string;
}

/** A minimal LogTransport that captures calls into an array. */
const capturingTransport = (): { transport: LogTransport; calls: CapturedCall[] } => {
  const calls: CapturedCall[] = [];
  const transport: LogTransport = {
    sendLoggingMessage(params: { level: string; data: string }): Promise<void> {
      calls.push({ level: params.level, data: params.data });
      return Promise.resolve();
    },
  };
  return { transport, calls };
};

// ── Spies for console.error ────────────────────────────────────────────────

// Re-spy in each test that needs it to avoid carry-over counts.
const spyStderr = () => spy(console, "error");

// ── Tests ──────────────────────────────────────────────────────────────────

Deno.test("setLogTransport binds transport — MCP notification is sent", () => {
  const { transport, calls } = capturingTransport();
  setLogTransport(transport);

  log.info("hello");
  assertEquals(calls.length, 1);
  assertEquals(calls[0], { level: "info", data: "hello" });

  // Unbind for subsequent tests
  setLogTransport(null as unknown as LogTransport);
});

Deno.test("without transport, log.info writes to stderr only", () => {
  using stderrSpy = spyStderr();
  log.info("stderr test");
  assertSpyCalls(stderrSpy, 1);
});

Deno.test("without transport, log.warn writes to stderr only", () => {
  using stderrSpy = spyStderr();
  log.warn("warn test");
  assertSpyCalls(stderrSpy, 1);
});

Deno.test("without transport, log.error writes to stderr only", () => {
  using stderrSpy = spyStderr();
  log.error("error test");
  assertSpyCalls(stderrSpy, 1);
});

Deno.test("log.debug is silent when DEBUG is not set", () => {
  using stderrSpy = spyStderr();
  log.debug("should be silent");
  assertSpyCalls(stderrSpy, 0);
});

Deno.test("log.isDebug is false when DEBUG is not set", () => {
  assertEquals(log.isDebug(), false);
});

// ── Level mapping ──────────────────────────────────────────────────────────

Deno.test("WARN maps to MCP level 'warning'", () => {
  const { transport, calls } = capturingTransport();
  setLogTransport(transport);

  log.warn("a warning");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].level, "warning");

  setLogTransport(null as unknown as LogTransport);
});

Deno.test("ERROR maps to MCP level 'error'", () => {
  const { transport, calls } = capturingTransport();
  setLogTransport(transport);

  log.error("an error");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].level, "error");

  setLogTransport(null as unknown as LogTransport);
});

Deno.test("INFO maps to MCP level 'info'", () => {
  const { transport, calls } = capturingTransport();
  setLogTransport(transport);

  log.info("info level check");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].level, "info");

  setLogTransport(null as unknown as LogTransport);
});

// ── Transport failure is silent ─────────────────────────────────────────────

Deno.test("transport failure does not throw and does not block stderr", () => {
  using stderrSpy = spyStderr();

  const failingTransport: LogTransport = {
    sendLoggingMessage: () => Promise.reject(new Error("transport down")),
  };
  setLogTransport(failingTransport);

  // Should not throw
  log.info("fire and forget");

  // stderr should still have fired
  assertSpyCalls(stderrSpy, 1);

  setLogTransport(null as unknown as LogTransport);
});

// ── Dual output ────────────────────────────────────────────────────────────

Deno.test("when transport is bound, both stderr and MCP notification fire", () => {
  using stderrSpy = spyStderr();
  const { transport, calls } = capturingTransport();
  setLogTransport(transport);

  log.warn("dual test");

  assertSpyCalls(stderrSpy, 1);
  assertEquals(calls.length, 1);

  setLogTransport(null as unknown as LogTransport);
});

// ── MCP data is the raw message ────────────────────────────────────────────

Deno.test("MCP notification data is the raw message string, not the formatted line", () => {
  const { transport, calls } = capturingTransport();
  setLogTransport(transport);

  log.info("raw message", { extra: "data" });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].data, "raw message");

  setLogTransport(null as unknown as LogTransport);
});

// ── Unbinding ──────────────────────────────────────────────────────────────

Deno.test("unbinding transport stops MCP notifications", () => {
  const { transport, calls } = capturingTransport();
  setLogTransport(transport);

  // First call should go through
  log.info("first");
  assertEquals(calls.length, 1);

  // Unbind
  setLogTransport(null as unknown as LogTransport);

  // Second call should NOT go to transport
  log.info("second");
  assertEquals(calls.length, 1); // still 1

  // Re-bind
  setLogTransport(transport);
  log.info("third");
  assertEquals(calls.length, 2); // now 2
});
