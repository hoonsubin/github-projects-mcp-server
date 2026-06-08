// =============================================================================
// src/domain/content-location.test.ts - Unit tests for mimeTypeForPath()
//
// Pure function - no file I/O, no network. permissions: "none" on every test
// makes the constraint machine-enforced.
// =============================================================================

import { assertEquals } from "@std/assert";
import { mimeTypeForPath } from "./content-location.ts";

const opts = { permissions: "none" } as const;

Deno.test({
  name: ".json → application/json",
  ...opts,
  fn() {
    assertEquals(mimeTypeForPath("template.json"), "application/json");
  },
});

Deno.test({
  name: ".yml → application/x-yaml",
  ...opts,
  fn() {
    assertEquals(mimeTypeForPath("template.yml"), "application/x-yaml");
  },
});

Deno.test({
  name: ".yaml → application/x-yaml",
  ...opts,
  fn() {
    assertEquals(mimeTypeForPath("template.yaml"), "application/x-yaml");
  },
});

Deno.test({
  name: ".md → text/markdown",
  ...opts,
  fn() {
    assertEquals(mimeTypeForPath("README.md"), "text/markdown");
  },
});

Deno.test({
  name: "unrecognized ext → text/markdown fallback",
  ...opts,
  fn() {
    assertEquals(mimeTypeForPath("foo.txt"), "text/markdown");
  },
});

Deno.test({
  name: "no extension → text/markdown fallback",
  ...opts,
  fn() {
    assertEquals(mimeTypeForPath("Makefile"), "text/markdown");
  },
});

Deno.test({
  name: "absolute path with .json",
  ...opts,
  fn() {
    assertEquals(mimeTypeForPath("/abs/path/file.json"), "application/json");
  },
});

Deno.test({
  name: "URL pathname with .yml",
  ...opts,
  fn() {
    assertEquals(mimeTypeForPath("/owner/repo/main/.github/template.yml"), "application/x-yaml");
  },
});
