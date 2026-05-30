// =============================================================================
// src/scrum/template-resource.test.ts - Unit tests for templateResourceUseCase()
//
// Tests inline templates (no I/O) and MIME resolution branches for file-kind
// and url-kind ContentLocation inputs. Config-resolved integration tests live
// in template-pipeline.test.ts.
// =============================================================================

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { templateResourceUseCase } from "./template-resource.ts";
import { realFileReader, stubFileReader } from "./_test_utils.ts";
import type { ContentLocation, SupportedMimeType } from "../domain/content-location.ts";

// ── Inline template (no file I/O) ─────────────────────────────────────────────

Deno.test("templateResourceUseCase — resolves inline template with text/markdown MIME", async () => {
  const typeTemplatePaths: Record<string, ContentLocation> = {
    custom_type: { kind: "inline", content: "# Custom Template\n\nSome content." },
  };
  const result = await templateResourceUseCase("custom_type", realFileReader, typeTemplatePaths);
  assertStringIncludes(result.content, "# Custom Template");
  // Inline templates default to text/markdown regardless of content.
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — resolves inline YAML template content", async () => {
  const ymlContent = "name: Test Template\ndescription: A YAML inline template.\n";
  const typeTemplatePaths: Record<string, ContentLocation> = {
    yml_type: { kind: "inline", content: ymlContent },
  };
  const result = await templateResourceUseCase("yml_type", realFileReader, typeTemplatePaths);
  assertEquals(result.content, ymlContent);
  // Inline has no file extension to infer from; always text/markdown.
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — resolves inline JSON template content", async () => {
  const jsonContent = '{"name":"Test Template","description":"A JSON inline template."}';
  const typeTemplatePaths: Record<string, ContentLocation> = {
    json_type: { kind: "inline", content: jsonContent },
  };
  const result = await templateResourceUseCase("json_type", realFileReader, typeTemplatePaths);
  assertEquals(result.content, jsonContent);
  // Inline has no file extension to infer from; always text/markdown.
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});

// ── Error paths ───────────────────────────────────────────────────────────────

Deno.test("templateResourceUseCase — throws when type not in typeTemplatePaths", async () => {
  const typeTemplatePaths: Record<string, ContentLocation> = {
    user_story: { kind: "inline", content: "..." },
  };
  await assertRejects(
    () => templateResourceUseCase("nonexistent", stubFileReader, typeTemplatePaths),
    Error,
    `No template declared for type "nonexistent"`,
  );
});

Deno.test("templateResourceUseCase — throws when typeTemplatePaths is empty", async () => {
  const typeTemplatePaths: Record<string, ContentLocation> = {};
  await assertRejects(
    () => templateResourceUseCase("user_story", stubFileReader, typeTemplatePaths),
    Error,
    `No template declared for type "user_story"`,
  );
});

// ── file-kind MIME resolution ─────────────────────────────────────────────────

Deno.test("templateResourceUseCase — file-kind .yml → application/x-yaml MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "file", path: "/some/path/template.yml" },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — file-kind .json → application/json MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "file", path: "/some/path/template.json" },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/json" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — file-kind .md → text/markdown MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "file", path: "/some/path/template.md" },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});

// ── url-kind MIME resolution ──────────────────────────────────────────────────

Deno.test("templateResourceUseCase — url-kind .yml → application/x-yaml MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "url", url: new URL("https://raw.example.com/template.yml") },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — url-kind .json → application/json MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "url", url: new URL("https://raw.example.com/template.json") },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/json" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — url-kind .md → text/markdown MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "url", url: new URL("https://raw.example.com/template.md") },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});
