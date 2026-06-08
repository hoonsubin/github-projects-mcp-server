// =============================================================================
// src/scrum/template-resource.test.ts - Unit tests for templateResourceUseCase()
//
// Tests inline templates (no I/O) and MIME resolution branches for file-kind
// and url-kind ContentLocation inputs. Config-resolved integration tests live
// in template-pipeline.test.ts.
// =============================================================================

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { templateResourceUseCase } from "./template-resource.ts";
import { realFileReader, stubFileReader } from "../test/support/scrum-test-utils.ts";
import type { ContentLocation, SupportedMimeType } from "../domain/content-location.ts";
import {
  FILE_JSON_LOCATION,
  FILE_MD_LOCATION,
  FILE_YML_LOCATION,
  INLINE_JSON_LOCATION,
  INLINE_LOCATION,
  INLINE_YAML_LOCATION,
  URL_JSON_LOCATION,
  URL_MD_LOCATION,
  URL_YML_LOCATION,
} from "@test/fixtures/scrum/index.ts";

// ── Inline template (no file I/O) ─────────────────────────────────────────────

Deno.test("templateResourceUseCase - resolves inline template with text/markdown MIME", async () => {
  const typeTemplatePaths: Record<string, ContentLocation> = {
    custom_type: INLINE_LOCATION,
  };
  const result = await templateResourceUseCase("custom_type", realFileReader, typeTemplatePaths);
  assertStringIncludes(result.content, "# Custom Template");
  // Inline templates default to text/markdown regardless of content.
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});

Deno.test("templateResourceUseCase - resolves inline YAML template content", async () => {
  const typeTemplatePaths: Record<string, ContentLocation> = {
    yml_type: INLINE_YAML_LOCATION,
  };
  const result = await templateResourceUseCase("yml_type", realFileReader, typeTemplatePaths);
  assertEquals(result.content, INLINE_YAML_LOCATION.content);
  // Inline has no file extension to infer from; always text/markdown.
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});

Deno.test("templateResourceUseCase - resolves inline JSON template content", async () => {
  const typeTemplatePaths: Record<string, ContentLocation> = {
    json_type: INLINE_JSON_LOCATION,
  };
  const result = await templateResourceUseCase("json_type", realFileReader, typeTemplatePaths);
  assertEquals(result.content, INLINE_JSON_LOCATION.content);
  // Inline has no file extension to infer from; always text/markdown.
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});

// ── Error paths ───────────────────────────────────────────────────────────────

Deno.test("templateResourceUseCase - throws when type not in typeTemplatePaths", async () => {
  const typeTemplatePaths: Record<string, ContentLocation> = {
    user_story: { kind: "inline", content: "..." },
  };
  await assertRejects(
    () => templateResourceUseCase("nonexistent", stubFileReader, typeTemplatePaths),
    Error,
    `No template declared for type "nonexistent"`,
  );
});

Deno.test("templateResourceUseCase - throws when typeTemplatePaths is empty", async () => {
  const typeTemplatePaths: Record<string, ContentLocation> = {};
  await assertRejects(
    () => templateResourceUseCase("user_story", stubFileReader, typeTemplatePaths),
    Error,
    `No template declared for type "user_story"`,
  );
});

// ── file-kind MIME resolution ─────────────────────────────────────────────────

Deno.test("templateResourceUseCase - file-kind .yml → application/x-yaml MIME", async () => {
  const paths: Record<string, ContentLocation> = { my_type: FILE_YML_LOCATION };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
});

Deno.test("templateResourceUseCase - file-kind .json → application/json MIME", async () => {
  const paths: Record<string, ContentLocation> = { my_type: FILE_JSON_LOCATION };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/json" as SupportedMimeType);
});

Deno.test("templateResourceUseCase - file-kind .md → text/markdown MIME", async () => {
  const paths: Record<string, ContentLocation> = { my_type: FILE_MD_LOCATION };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});

// ── url-kind MIME resolution ──────────────────────────────────────────────────

Deno.test("templateResourceUseCase - url-kind .yml → application/x-yaml MIME", async () => {
  const paths: Record<string, ContentLocation> = { my_type: URL_YML_LOCATION };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
});

Deno.test("templateResourceUseCase - url-kind .json → application/json MIME", async () => {
  const paths: Record<string, ContentLocation> = { my_type: URL_JSON_LOCATION };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/json" as SupportedMimeType);
});

Deno.test("templateResourceUseCase - url-kind .md → text/markdown MIME", async () => {
  const paths: Record<string, ContentLocation> = { my_type: URL_MD_LOCATION };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});
