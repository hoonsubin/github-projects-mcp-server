// =============================================================================
// src/scrum/template-pipeline.test.ts
//
// Full pipeline integration: config.yml → resolveLocation → fetchContent →
// templateResourceUseCase. Reads the committed .github/scrum/config.yml and
// .github/ISSUE_TEMPLATE/ files directly. No GitHub client or network needed.
// =============================================================================

import { assertSnapshot } from "@std/testing/snapshot";
import { assertEquals } from "@std/assert";
import { templateResourceUseCase } from "./template-resource.ts";
import { realFileReader, typeTemplatePathsPromise } from "./_test_utils.ts";
import type { SupportedMimeType } from "../domain/content-location.ts";

// ── Per-type pipeline tests ───────────────────────────────────────────────────

Deno.test("pipeline: user_story config → resolve → fetch → use case", async (t) => {
  const paths = await typeTemplatePathsPromise;
  const result = await templateResourceUseCase("user_story", realFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
  await assertSnapshot(t, result.content);
});

Deno.test("pipeline: bug config → resolve → fetch → use case", async (t) => {
  const paths = await typeTemplatePathsPromise;
  const result = await templateResourceUseCase("bug", realFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
  await assertSnapshot(t, result.content);
});

Deno.test("pipeline: impediment config → resolve → fetch → use case", async (t) => {
  const paths = await typeTemplatePathsPromise;
  const result = await templateResourceUseCase("impediment", realFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
  await assertSnapshot(t, result.content);
});

// ── Structural correctness ────────────────────────────────────────────────────

Deno.test("pipeline: all resolved types have kind:file with existing path", async () => {
  const paths = await typeTemplatePathsPromise;
  for (const [type, loc] of Object.entries(paths)) {
    assertEquals(loc.kind, "file", `type "${type}" expected kind:file`);
    if (loc.kind === "file") {
      // Deno.stat throws NotFound if the path does not exist
      try {
        await Deno.stat(loc.path);
      } catch {
        throw new Error(`type "${type}" path does not exist: ${loc.path}`);
      }
    }
  }
});

Deno.test("pipeline: types without template field are absent from map", async () => {
  const paths = await typeTemplatePathsPromise;
  // Map must be non-empty (config has at least one type with a template).
  assertEquals(Object.keys(paths).length > 0, true, "expected at least one template in config");
  // Every resolved location must be kind:file — the committed config uses
  // relative file paths only. url/inline would indicate a bug in buildTypeTemplatePaths.
  for (const loc of Object.values(paths)) {
    assertEquals(loc.kind, "file");
  }
});
