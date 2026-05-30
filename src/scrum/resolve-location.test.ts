// =============================================================================
// src/scrum/resolve-location.test.ts - Unit tests for resolveLocation()
//
// resolveLocation() is a pure function - tested exhaustively before it is
// consumed by config-loader.ts.
// =============================================================================

import { assertEquals, assertThrows } from "@std/assert";
import { resolveLocation } from "./resolve-location.ts";
import type { ContentLocation } from "../domain/content-location.ts";

Deno.test("resolveLocation — relative path anchored to baseDir", () => {
  const result = resolveLocation(".github/scrum/config.yml", "/home/project");
  const expected: ContentLocation = {
    kind: "file",
    path: "/home/project/.github/scrum/config.yml",
  };
  assertEquals(result, expected);
});

Deno.test("resolveLocation — absolute path passes through unchanged", () => {
  const result = resolveLocation("/absolute/path/config.yml", "/home/project");
  const expected: ContentLocation = { kind: "file", path: "/absolute/path/config.yml" };
  assertEquals(result, expected);
});

Deno.test("resolveLocation — https URL returns url kind", () => {
  const result = resolveLocation("https://example.com/config.yml", "/any");
  assertEquals(result.kind, "url");
  if (result.kind === "url") {
    assertEquals(result.url.toString(), "https://example.com/config.yml");
  }
});

Deno.test("resolveLocation — http URL returns url kind", () => {
  const result = resolveLocation("http://example.com/config.yml", "/any");
  assertEquals(result.kind, "url");
  if (result.kind === "url") {
    assertEquals(result.url.toString(), "http://example.com/config.yml");
  }
});

Deno.test("resolveLocation — relative path with ./ prefix resolves correctly", () => {
  const result = resolveLocation("./config.json", "/home/project");
  const expected: ContentLocation = { kind: "file", path: "/home/project/config.json" };
  assertEquals(result, expected);
});

Deno.test("resolveLocation — nested relative template.md resolves correctly", () => {
  const result = resolveLocation("relative/template.md", "/home/project");
  const expected: ContentLocation = {
    kind: "file",
    path: "/home/project/relative/template.md",
  };
  assertEquals(result, expected);
});

Deno.test("resolveLocation — .yml extension is supported", () => {
  const result = resolveLocation("template.yml", "/base");
  assertEquals(result, { kind: "file", path: "/base/template.yml" });
});

Deno.test("resolveLocation — .yaml extension is supported", () => {
  const result = resolveLocation("template.yaml", "/base");
  assertEquals(result, { kind: "file", path: "/base/template.yaml" });
});

Deno.test("resolveLocation — .json extension is supported", () => {
  const result = resolveLocation("template.json", "/base");
  assertEquals(result, { kind: "file", path: "/base/template.json" });
});

Deno.test("resolveLocation — unsupported extension in path throws", () => {
  assertThrows(
    () => resolveLocation("template.txt", "/base"),
    Error,
    "Unsupported file extension",
  );
});

Deno.test("resolveLocation — unsupported extension in URL throws", () => {
  assertThrows(
    () => resolveLocation("https://example.com/template.txt", "/any"),
    Error,
    "Unsupported file extension",
  );
});

Deno.test("resolveLocation — URL with no extension throws (empty ext)", () => {
  assertThrows(
    () => resolveLocation("https://example.com/noextension", "/any"),
    Error,
    "Unsupported file extension",
  );
});

Deno.test("resolveLocation — baseDir is irrelevant for absolute path", () => {
  const a = resolveLocation("/abs/path/config.yml", "/base-a");
  const b = resolveLocation("/abs/path/config.yml", "/base-b");
  assertEquals(a, b);
});

Deno.test("resolveLocation — URL host is preserved exactly", () => {
  const result = resolveLocation(
    "https://raw.githubusercontent.com/owner/repo/main/.github/template.md",
    "/any",
  );
  assertEquals(result.kind, "url");
  if (result.kind === "url") {
    assertEquals(result.url.hostname, "raw.githubusercontent.com");
    assertEquals(result.url.pathname, "/owner/repo/main/.github/template.md");
  }
});
