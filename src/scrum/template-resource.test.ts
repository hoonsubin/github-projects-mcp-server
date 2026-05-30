// =============================================================================
// src/scrum/template-resource.test.ts - Unit tests for templateResourceUseCase()
//
// Tests the full config → template resolution pipeline:
//   .github/scrum/config.yml → resolveLocation() → templateResourceUseCase()
//
// Uses a stub FileReaderPort that delegates to the real fetchContent() so
// template files are read from the committed .github/ISSUE_TEMPLATE/ directory.
// No temp file writes — deno task test runs with --allow-read but not --allow-write.
// =============================================================================

import { parse } from "@std/yaml";
import { dirname, resolve } from "@std/path";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { templateResourceUseCase } from "./template-resource.ts";
import { resolveLocation } from "./resolve-location.ts";
import { fetchContent } from "./fetch-location.ts";
import type { FileReaderPort } from "./ports.ts";
import type { ContentLocation, SupportedMimeType } from "../domain/content-location.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build typeTemplatePaths from the real .github/scrum/config.yml, matching the
 * resolution logic in loadConfig() from src/adapters/github/config-loader.ts.
 *
 * 1. Reads and parses the config file.
 * 2. Extracts backends.github.type_mapping entries that have a `template` field.
 * 3. Calls resolveLocation(entry.template, projectRoot) for each, where
 *    projectRoot = config file's directory (since projRoot is not set).
 */
const buildTypeTemplatePaths = async (): Promise<Record<string, ContentLocation>> => {
  const configPath = ".github/scrum/config.yml";
  const rawYml = await Deno.readTextFile(configPath);
  // parse() returns unknown; the shape is validated by loadConfig but for tests
  // we trust the committed fixture is well-formed.
  const config = parse(rawYml) as Record<string, unknown>;
  const backends = config.backends as Record<string, unknown>;
  const github = backends.github as Record<string, Record<string, unknown>>;
  const typeMapping = github.type_mapping as Record<string, { template?: string }>;

  const projectRoot = dirname(resolve(Deno.cwd(), configPath));

  const paths: Record<string, ContentLocation> = {};
  for (const [key, entry] of Object.entries(typeMapping)) {
    if (entry.template) {
      paths[key] = resolveLocation(entry.template, projectRoot);
    }
  }
  return paths;
};

/** Stub FileReaderPort — delegates to the real fetchContent(). */
const stubFileReader: FileReaderPort = {
  fetchContent: (loc: ContentLocation) => fetchContent(loc),
};

// ── Config-resolved template tests ────────────────────────────────────────────

Deno.test("templateResourceUseCase — resolves user_story template from real config", async () => {
  const typeTemplatePaths = await buildTypeTemplatePaths();
  const result = await templateResourceUseCase("user_story", stubFileReader, typeTemplatePaths);
  assertStringIncludes(result.content, "name:");
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — resolves bug template from real config", async () => {
  const typeTemplatePaths = await buildTypeTemplatePaths();
  const result = await templateResourceUseCase("bug", stubFileReader, typeTemplatePaths);
  assertStringIncludes(result.content, "name:");
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — resolves impediment template from real config", async () => {
  const typeTemplatePaths = await buildTypeTemplatePaths();
  const result = await templateResourceUseCase("impediment", stubFileReader, typeTemplatePaths);
  assertStringIncludes(result.content, "name:");
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
});

// ── Inline template (no file I/O) ─────────────────────────────────────────────

Deno.test("templateResourceUseCase — resolves inline template with text/markdown MIME", async () => {
  const typeTemplatePaths: Record<string, ContentLocation> = {
    custom_type: { kind: "inline", content: "# Custom Template\n\nSome content." },
  };
  const result = await templateResourceUseCase("custom_type", stubFileReader, typeTemplatePaths);
  assertStringIncludes(result.content, "# Custom Template");
  // Inline templates default to text/markdown regardless of content.
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — resolves inline YAML template content", async () => {
  const ymlContent = "name: Test Template\ndescription: A YAML inline template.\n";
  const typeTemplatePaths: Record<string, ContentLocation> = {
    yml_type: { kind: "inline", content: ymlContent },
  };
  const result = await templateResourceUseCase("yml_type", stubFileReader, typeTemplatePaths);
  assertEquals(result.content, ymlContent);
  // Inline has no file extension to infer from; always text/markdown.
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — resolves inline JSON template content", async () => {
  const jsonContent = '{"name":"Test Template","description":"A JSON inline template."}';
  const typeTemplatePaths: Record<string, ContentLocation> = {
    json_type: { kind: "inline", content: jsonContent },
  };
  const result = await templateResourceUseCase("json_type", stubFileReader, typeTemplatePaths);
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
