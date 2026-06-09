// =============================================================================
// src/scrum/fixtures/locations.ts
//
// ContentLocation constants for template-resource.test.ts.
// =============================================================================

import type { ContentLocation } from "../../../domain/content-location.ts";

export const INLINE_LOCATION = {
  kind: "inline",
  content: "# Custom Template\n\nSome content.",
} as const satisfies ContentLocation;

export const INLINE_YAML_LOCATION = {
  kind: "inline",
  content: "name: Test Template\ndescription: A YAML inline template.\n",
} as const satisfies ContentLocation;

export const INLINE_JSON_LOCATION = {
  kind: "inline",
  content: '{"name":"Test Template","description":"A JSON inline template."}',
} as const satisfies ContentLocation;

export const FILE_YML_LOCATION = {
  kind: "file",
  path: "/some/path/template.yml",
} as const satisfies ContentLocation;

export const FILE_JSON_LOCATION = {
  kind: "file",
  path: "/some/path/template.json",
} as const satisfies ContentLocation;

export const FILE_MD_LOCATION = {
  kind: "file",
  path: "/some/path/template.md",
} as const satisfies ContentLocation;

export const URL_YML_LOCATION = {
  kind: "url",
  url: new URL("https://raw.example.com/template.yml"),
} as const satisfies ContentLocation;

export const URL_JSON_LOCATION = {
  kind: "url",
  url: new URL("https://raw.example.com/template.json"),
} as const satisfies ContentLocation;

export const URL_MD_LOCATION = {
  kind: "url",
  url: new URL("https://raw.example.com/template.md"),
} as const satisfies ContentLocation;
