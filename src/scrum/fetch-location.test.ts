// =============================================================================
// src/scrum/fetch-location.test.ts - Unit tests for fetchContent()
//
// Tests use a committed fixture file (testdata/sample.yml) for the file branch
// and a lightweight Deno.serve listener on an ephemeral port for the URL branch.
// No temp file writes — deno task test runs with --allow-read but not --allow-write.
// =============================================================================

import { assertEquals, assertRejects } from "@std/assert";
import { fetchContent } from "./fetch-location.ts";
import type { ContentLocation } from "../domain/content-location.ts";

// ── file branch ───────────────────────────────────────────────────────────────

Deno.test("fetchContent — file branch reads fixture file", async () => {
  const location: ContentLocation = {
    kind: "file",
    path: "src/scrum/testdata/sample.yml",
  };
  const content = await fetchContent(location);
  // The fixture file contains the project name
  assertEquals(content.includes("test-project"), true);
});

Deno.test("fetchContent — file branch throws on missing file", async () => {
  const location: ContentLocation = {
    kind: "file",
    path: "/nonexistent/path/that/does/not/exist.yml",
  };
  await assertRejects(
    () => fetchContent(location),
    Error,
  );
});

// ── inline branch ─────────────────────────────────────────────────────────────

Deno.test("fetchContent — inline branch returns content as-is", async () => {
  const location: ContentLocation = { kind: "inline", content: "raw: yaml" };
  const result = await fetchContent(location);
  assertEquals(result, "raw: yaml");
});

Deno.test("fetchContent — inline branch handles empty string", async () => {
  const location: ContentLocation = { kind: "inline", content: "" };
  const result = await fetchContent(location);
  assertEquals(result, "");
});

// ── url branch ────────────────────────────────────────────────────────────────

Deno.test("fetchContent — url branch fetches from local test server", async () => {
  const responseBody = "# fetched from server\ndata: ok\n";

  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    (_req) => new Response(responseBody, { status: 200 }),
  );

  const addr = server.addr as Deno.NetAddr;
  const url = new URL(`http://127.0.0.1:${addr.port}/test.yml`);

  try {
    const location: ContentLocation = { kind: "url", url };
    const result = await fetchContent(location);
    assertEquals(result, responseBody);
  } finally {
    await server.shutdown();
  }
});

Deno.test("fetchContent — url branch throws on 404", async () => {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    (_req) => new Response("Not Found", { status: 404 }),
  );

  const addr = server.addr as Deno.NetAddr;
  const url = new URL(`http://127.0.0.1:${addr.port}/missing.yml`);

  try {
    const location: ContentLocation = { kind: "url", url };
    await assertRejects(
      () => fetchContent(location),
      Error,
      "Cannot fetch",
    );
  } finally {
    await server.shutdown();
  }
});

Deno.test("fetchContent — url branch error message includes status code", async () => {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    (_req) => new Response("Server Error", { status: 503 }),
  );

  const addr = server.addr as Deno.NetAddr;
  const url = new URL(`http://127.0.0.1:${addr.port}/config.yml`);

  try {
    const location: ContentLocation = { kind: "url", url };
    let threw = false;
    try {
      await fetchContent(location);
    } catch (err) {
      threw = true;
      assertEquals(err instanceof Error, true);
      if (err instanceof Error) {
        assertEquals(err.message.includes("503"), true);
        assertEquals(err.message.includes("Cannot fetch"), true);
      }
    }
    assertEquals(threw, true);
  } finally {
    await server.shutdown();
  }
});
