// =============================================================================
// src/scrum/fetch-location.test.ts - Unit tests for fetchContent()
//
// Tests use a committed fixture file (testdata/sample.yml) for the file branch
// and a lightweight Deno.serve listener on an ephemeral port for the URL branch.
// No temp file writes - deno task test runs with --allow-read but not --allow-write.
// =============================================================================

import { resolve } from "@std/path";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fetchContent } from "./fetch-location.ts";
import { withTestServer } from "../test/support/scrum-test-utils.ts";
import type { ContentLocation } from "../domain/content-location.ts";

// ── file branch ───────────────────────────────────────────────────────────────

Deno.test("fetchContent - file branch throws on missing file", async () => {
  const location: ContentLocation = {
    kind: "file",
    path: "/nonexistent/path/that/does/not/exist.yml",
  };
  await assertRejects(
    () => fetchContent(location),
    Error,
  );
});

Deno.test({
  name: "fetchContent - file branch throws on permission denied",
  ignore: Deno.build.os !== "linux",
  async fn() {
    const location: ContentLocation = {
      kind: "file",
      // /etc/shadow exists on Linux but is unreadable by non-root users.
      // Tests that Deno.readTextFile errors propagate as-is, not wrapped.
      // Deno includes the OS error string: "Permission denied (os error 13)".
      path: "/etc/shadow",
    };
    await assertRejects(
      () => fetchContent(location),
      Error,
      "Permission denied",
    );
  },
});

// ── inline branch ─────────────────────────────────────────────────────────────

Deno.test("fetchContent - inline branch returns content as-is", async () => {
  const location: ContentLocation = { kind: "inline", content: "raw: yaml" };
  const result = await fetchContent(location);
  assertEquals(result, "raw: yaml");
});

Deno.test("fetchContent - inline branch handles empty string", async () => {
  const location: ContentLocation = { kind: "inline", content: "" };
  const result = await fetchContent(location);
  assertEquals(result, "");
});

// ── config files (real committed paths) ───────────────────────────────────────

Deno.test("fetchContent - reads .github/scrum/config.yml via relative path", async () => {
  const location: ContentLocation = {
    kind: "file",
    path: ".github/scrum/config.yml",
  };
  const content = await fetchContent(location);
  assertStringIncludes(content, "backends:");
});

Deno.test("fetchContent - reads .github/scrum/config.yml via absolute path", async () => {
  const location: ContentLocation = {
    kind: "file",
    path: resolve(Deno.cwd(), ".github/scrum/config.yml"),
  };
  const content = await fetchContent(location);
  assertStringIncludes(content, "project:");
});

Deno.test("fetchContent - reads config from inline YAML string", async () => {
  const inline = [
    "project:",
    "  name: inline-test",
    "scrum:",
    "  status:",
    "    done:",
    "      terminal: true",
    "      blocking: false",
    "  priority: []",
    "backends:",
    "  github:",
    "    owner: test",
    "",
  ].join("\n");
  const location: ContentLocation = { kind: "inline", content: inline };
  const result = await fetchContent(location);
  assertEquals(result, inline);
});

Deno.test("fetchContent - returns inline template content as-is", async () => {
  const tmpl = "## User Story Template\n\nAs a ...\n";
  const location: ContentLocation = { kind: "inline", content: tmpl };
  const result = await fetchContent(location);
  assertEquals(result, tmpl);
});

// ── supported file types ──────────────────────────────────────────────────────
//
// fetchContent() itself does not validate file extensions - it delegates to
// Deno.readTextFile. Extension validation is the responsibility of
// resolveLocation() at the call site. These tests document that all committed
// file types (and even "unsupported" ones) are readable through the file branch.

Deno.test("fetchContent - reads Markdown file (README.md)", async () => {
  const location: ContentLocation = {
    kind: "file",
    path: "README.md",
  };
  const content = await fetchContent(location);
  assertStringIncludes(content, "Scrum");
});

Deno.test("fetchContent - reads JSON file (deno.json)", async () => {
  const location: ContentLocation = {
    kind: "file",
    path: "deno.json",
  };
  const content = await fetchContent(location);
  assertStringIncludes(content, "tasks");
});

Deno.test("fetchContent - reads .ts even though resolveLocation rejects it", async () => {
  const location: ContentLocation = {
    kind: "file",
    path: "src/scrum/fetch-location.ts",
  };
  // fetchContent does NOT validate extensions - it just calls Deno.readTextFile.
  // resolveLocation() is the gate; this test proves they're independent.
  const content = await fetchContent(location);
  assertStringIncludes(content, "export const fetchContent");
});

// ── url branch ────────────────────────────────────────────────────────────────

Deno.test("fetchContent - url branch fetches from local test server", async () => {
  const responseBody = "# fetched from server\ndata: ok\n";
  await withTestServer(
    () => new Response(responseBody, { status: 200 }),
    async (base) => {
      const location: ContentLocation = { kind: "url", url: new URL("/test.yml", base) };
      assertEquals(await fetchContent(location), responseBody);
    },
  );
});

Deno.test("fetchContent - url branch returns empty string on empty 200 response", async () => {
  await withTestServer(
    () => new Response("", { status: 200 }),
    async (base) => {
      const location: ContentLocation = { kind: "url", url: new URL("/empty.yml", base) };
      assertEquals(await fetchContent(location), "");
    },
  );
});

Deno.test("fetchContent - url branch throws on connection refused", async () => {
  // Port 1 is reserved - fetch() rejects with a TypeError (ECONNREFUSED).
  // This tests the path where fetch() itself throws, not where res.ok is false.
  const location: ContentLocation = {
    kind: "url",
    url: new URL("http://127.0.0.1:1/nope.yml"),
  };
  // Error message is platform-specific (e.g. "Connection refused"), so we
  // only assert that an Error is thrown - not the exact shape.
  await assertRejects(
    () => fetchContent(location),
    Error,
  );
});

Deno.test("fetchContent - url branch throws on 404", async () => {
  await withTestServer(
    () => new Response("Not Found", { status: 404 }),
    async (base) => {
      const location: ContentLocation = { kind: "url", url: new URL("/missing.yml", base) };
      await assertRejects(() => fetchContent(location), Error, "Cannot fetch");
    },
  );
});

Deno.test("fetchContent - url branch error message includes status code", async () => {
  await withTestServer(
    (_req) => new Response("Server Error", { status: 503 }),
    async (base) => {
      const location: ContentLocation = { kind: "url", url: new URL("/config.yml", base) };
      const err = await assertRejects(
        () => fetchContent(location),
        Error,
        "Cannot fetch",
      );
      assertStringIncludes(err.message, "503");
    },
  );
});

// ── HTML content detection (loadScrumConfig integration) ────────────────────────
//
// When a URL returns HTML instead of YAML, loadScrumConfig() detects it
// before parsing and throws a ConfigError with a platform-specific recovery hint.

import { loadScrumConfig } from "./config-boot.ts";
import { ConfigError } from "../domain/errors.ts";

Deno.test("loadScrumConfig - throws ConfigError when URL returns HTML", async () => {
  await withTestServer(
    () =>
      new Response("<!DOCTYPE html><html><head></head><body>GitHub page</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    async (base) => {
      const location: ContentLocation = {
        kind: "url",
        url: new URL("/owner/repo/blob/main/config.yml", base),
      };
      const err = await assertRejects(
        () => loadScrumConfig(location),
        ConfigError,
      );
      assertEquals(err.code, "HTML_CONTENT");
    },
  );
});

Deno.test("loadScrumConfig - loads valid YAML from URL without error", async () => {
  await withTestServer(
    () =>
      new Response(
        "project:\n  name: test\nscrum:\n  priority: []\n  status: {}\nbackends:\n  github: {}\n",
        { status: 200, headers: { "Content-Type": "application/x-yaml" } },
      ),
    async (base) => {
      const location: ContentLocation = { kind: "url", url: new URL("/config.yml", base) };
      const result = await loadScrumConfig(location);
      assertEquals(result.scrumConfig.project.name, "test");
    },
  );
});
